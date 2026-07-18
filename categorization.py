"""
Categorization engine - hybrid rule-based and ML approach
"""
import re
from typing import Tuple, Optional, List, Dict
from sqlalchemy.orm import Session
from database import CategorizationRule, UserCorrection, Transaction
from datetime import datetime


class CategorizationEngine:
    """
    Hybrid categorization engine that:
    1. Uses rule-based matching (from your Rules sheet)
    2. Learns from user corrections over time
    3. Assigns confidence scores
    """
    
    def __init__(self, db_session: Session):
        self.db = db_session
        self._load_rules()
    
    def _load_rules(self):
        """Load active rules from database, sorted by priority"""
        self.rules = self.db.query(CategorizationRule)\
            .filter_by(is_active=True)\
            .order_by(CategorizationRule.priority)\
            .all()
    
    def clean_description(self, raw_description: str) -> str:
        """
        Deterministic noise-stripper for bank transaction descriptions.

        Removes trailing identifiers, payment network codes, store numbers,
        and other bank-appended garbage that adds no display value.
        Returns an uppercased, whitespace-normalised result.
        """
        if not raw_description:
            return ""

        desc = raw_description.upper().strip()

        # ── Suffix patterns (strip everything from the keyword onwards) ──────
        suffix_patterns = [
            r'\s+PPD ID:.*',            # ACH payroll/direct-deposit IDs
            r'\s+WEB ID:.*',            # ACH web-initiated IDs
            r'\s+CCD ID:.*',            # ACH corporate credit/debit IDs
            r'\s+TEL ID:.*',
            r'\s+ORIG CO ID:.*',
            r'\s+ORIG ID:.*',
            r'\s+DIR DEP.*',            # Direct deposit suffix
            r'\s+PAYROLL.*',            # Payroll suffix
            r'\s+DIRECT DEP.*',
            r'\s+PURCHASE.*',           # "PURCHASE AUTHORIZED ON …"
            r'\s+AUTHORIZED ON.*',
            r'\s+CARD \d+.*',           # "CARD 1234 …"
            r'\s+REF#.*',               # Reference numbers
            r'\s+CONF#.*',              # Confirmation numbers
            r'\s+TRN#.*',
        ]
        for p in suffix_patterns:
            desc = re.sub(p, '', desc)

        # ── Prefix patterns (strip payment-network tag at start) ─────────────
        prefix_patterns = [
            r'^TST\*',                  # Toast POS
            r'^SQ \*',                  # Square
            r'^SQU\*',
            r'^PP\*',                   # PayPal
            r'^PAYPAL \*',
            r'^VENMO \*',
            r'^CKE\*',                  # Various POS prefixes
            r'^SP ',                    # Shopify "SP MerchantName"
        ]
        for p in prefix_patterns:
            desc = re.sub(p, '', desc)

        # ── Inline noise (remove in-place) ───────────────────────────────────
        inline_patterns = [
            r'\d{15,}',                 # Very long numbers (card/account IDs)
            r'#\d{4,}',                 # Store/transaction codes like #1234
            r'\b\d{4,}\b(?!\s*%)',      # Standalone 4+ digit numbers (not percentages)
            r'\s{2,}',                  # Collapsed multiple spaces
        ]
        for p in inline_patterns:
            desc = re.sub(p, ' ', desc)

        return desc.strip()
    
    def extract_merchant(self, description: str) -> Optional[str]:
        """
        Extract merchant name from description
        """
        # Simple extraction - can be improved
        desc = description.upper()
        
        # Common patterns
        patterns = [
            r'^([A-Z0-9\s&\-\']+?)(?:\s+\d{3,}|\s+[A-Z]{2}$|\s+#)',
            r'^([A-Z0-9\s&\-\']{3,40})',
        ]
        
        for pattern in patterns:
            match = re.match(pattern, desc)
            if match:
                merchant = match.group(1).strip()
                if len(merchant) >= 3:
                    return merchant
        
        return None
    
    def match_rule(self, description: str, amount: float) -> Optional[CategorizationRule]:
        """
        Find first matching rule based on description and amount.
        Tests against BOTH the raw description and the cleaned description so that
        patterns like "PRUDENTIAL DIR" match "PRUDENTIAL DIR DEP PPD ID: …" even
        after clean_description() strips "DIR DEP".
        """
        desc_clean = self.clean_description(description)
        desc_raw   = description.upper()

        def _matches(pattern: str, match_type: str) -> bool:
            if match_type == 'contains':
                return pattern in desc_raw or pattern in desc_clean
            if match_type == 'contains_any':
                parts = [p.strip() for p in pattern.split(';')]
                return any(p in desc_raw or p in desc_clean for p in parts)
            if match_type == 'contains_all':
                parts = [p.strip() for p in pattern.split(';')]
                return all(p in desc_raw or p in desc_clean for p in parts)
            if match_type == 'equals':
                return desc_raw == pattern or desc_clean == pattern
            if match_type == 'starts_with':
                return desc_raw.startswith(pattern) or desc_clean.startswith(pattern)
            if match_type == 'regex':
                return bool(re.search(pattern, desc_raw, re.IGNORECASE)) or \
                       bool(re.search(pattern, desc_clean, re.IGNORECASE))
            return False

        for rule in self.rules:
            pattern = rule.pattern.upper()
            if _matches(pattern, rule.match_type):
                return rule

        return None
    
    def learn_from_corrections(self, merchant: str) -> Optional[Dict]:
        """
        Check if user has corrected similar transactions before
        Returns most common correction for this merchant
        """
        if not merchant:
            return None

        # Find recent corrections for this merchant
        corrections = self.db.query(UserCorrection)\
            .filter(UserCorrection.merchant_name.ilike(f"%{merchant}%"))\
            .order_by(UserCorrection.created_at.desc())\
            .limit(10)\
            .all()

        if not corrections:
            return None

        # Count most common category assignment
        category_counts = {}
        action_counts = {}

        for correction in corrections:
            cat = correction.new_category
            action = correction.new_action

            category_counts[cat] = category_counts.get(cat, 0) + 1
            if action:
                action_counts[action] = action_counts.get(action, 0) + 1

        # Return most common if we have confidence
        if category_counts:
            most_common_cat = max(category_counts, key=category_counts.get)
            count = category_counts[most_common_cat]

            if count >= 2:  # Need at least 2 corrections to trust it
                return {
                    'category': most_common_cat,
                    'action': max(action_counts, key=action_counts.get) if action_counts else None,
                    'confidence': min(count / 5.0, 0.95),  # Cap at 0.95
                    'source': 'user_learning'
                }

        return None

    def _check_transfer_correction(self, merchant: str, description: str = None) -> Optional[Dict]:
        """
        Check whether the user has previously corrected transactions for this
        merchant to action='Transfer' (e.g., credit-card payments that were
        misclassified as purchases).

        This is intentionally separate from learn_from_corrections() because:
        - It applies EVEN WHEN a category rule matched (overriding the rule action)
        - Its threshold is 1 correction, not 2 — Transfer is a high-conviction signal
        - It uses description word-overlap to avoid mislabelling genuine purchases
          that share the same merchant name as payments

        Returns a confidence dict if a matching Transfer correction is found,
        otherwise None.
        """
        if not merchant:
            return None

        corrections = (
            self.db.query(UserCorrection)
            .filter(
                UserCorrection.merchant_name.ilike(f"%{merchant}%"),
                UserCorrection.new_action == 'Transfer',
            )
            .order_by(UserCorrection.created_at.desc())
            .limit(10)
            .all()
        )
        if not corrections:
            return None

        if description:
            # Require at least one meaningful word (>3 chars) to appear in both
            # the new transaction description and a stored correction description,
            # EXCLUDING words that are part of the merchant name itself. Every
            # transaction from a merchant contains the merchant name, so counting
            # merchant-name overlap made this guard a no-op whenever the stored
            # correction's description was just the merchant name (confirmed live:
            # a single Best Buy correction with description "BEST BUY" blanket-matched
            # every subsequent Best Buy purchase). Only overlap in the *non-merchant*
            # words distinguishes a payment-like description from a genuine purchase.
            merchant_words = {w for w in merchant.upper().split() if len(w) > 3}
            desc_words = {w for w in description.upper().split() if len(w) > 3} - merchant_words
            matched = [
                c for c in corrections
                if c.description and (
                    ({w for w in c.description.upper().split() if len(w) > 3} - merchant_words) & desc_words
                )
            ]
            if not matched:
                return None
            count = len(matched)
        else:
            count = len(corrections)

        return {
            'action': 'Transfer',
            'confidence': min(0.70 + count * 0.10, 0.95),
            'source': 'user_correction_transfer',
        }
    
    def determine_action(self, amount: float, description: str, account_type: str = '') -> str:
        """
        Determine transaction action (Income, Expense, Transfer).

        Key rule: positive amounts on credit-card accounts are credits / refunds —
        they are negative Expenses, NOT Income.  Positive amounts on bank accounts
        are true deposits and default to Income.
        """
        desc_upper = description.upper()

        # Transfers (checked first — overrides everything else)
        transfer_keywords = ['TRANSFER', 'AUTOPAY', 'PAYMENT', 'PMT', 'PYMT', 'ATM']
        if any(kw in desc_upper for kw in transfer_keywords):
            return 'Transfer'

        # Known income patterns
        income_keywords = ['PAYROLL', 'DIR DEP', 'DEPOSIT', 'DIRECT DEP', 'PRUDENTIAL', 'RAD DATA']
        if any(kw in desc_upper for kw in income_keywords) and amount > 0:
            return 'Income'

        # Depreciation
        if 'DEPRECIATION' in desc_upper:
            return 'Depreciation'

        # Credit-card credits: positive amount on a CC account = refund / statement credit.
        # Treat as Expense with positive amount so it nets against charges in budget totals.
        is_cc = account_type.lower().strip() in ('credit', 'credit card')
        if is_cc and amount > 0:
            return 'Expense'

        # Default based on sign
        return 'Income' if amount > 0 else 'Expense'
    
    def categorize(self, description: str, amount: float, merchant_name: Optional[str] = None,
                    account_type: str = '', apply_corrections: bool = True) -> Tuple[str, str, float, Optional[str]]:
        """
        Two-pass categorization:
        Pass 1 — Match raw description against action/description rules (Groups 1 & 2)
                 to get action + normalized description
        Pass 2 — Match normalized description against category rules (Group 3)
                 to get category

        apply_corrections: when False, skips learn_from_corrections() and
            _check_transfer_correction() entirely — only explicit CategorizationRule
            matches are applied. Used by force-unlock reapply, where the caller has
            already gated on "a rule now matches this row" and the result should
            reflect only that rule, not a separately-triggered correction override
            (see _reapply_rules in main.py).

        Returns: (action, category, confidence, display_description)
            display_description: polished description from a matching rule's
                                 set_description field, or None if no rule matched.
        """
        desc_clean = self.clean_description(description)
        desc_raw   = description.upper()  # Raw upper for broad matching

        # ── Pass 1: action + description normalization ───────────────────────
        action = None
        normalized_desc = desc_clean
        display_description = None  # polished name from rules

        for rule in self.rules:
            if rule.set_category and not rule.set_action and not rule.set_description:
                continue  # Skip pure category rules in pass 1

            pattern = rule.pattern.upper()
            matched = False

            # Match against BOTH raw and cleaned so patterns like "PRUDENTIAL DIR"
            # still fire on "PRUDENTIAL DIR DEP PPD ID: …" after cleaning strips noise.
            if rule.match_type == 'contains':
                matched = pattern in desc_raw or pattern in desc_clean
            elif rule.match_type == 'contains_any':
                matched = any(p.strip() in desc_raw or p.strip() in desc_clean for p in pattern.split(';'))
            elif rule.match_type == 'contains_all':
                matched = all(p.strip() in desc_raw or p.strip() in desc_clean for p in pattern.split(';'))
            elif rule.match_type == 'equals':
                matched = desc_raw == pattern or desc_clean == pattern
            elif rule.match_type == 'starts_with':
                matched = desc_raw.startswith(pattern) or desc_clean.startswith(pattern)
            elif rule.match_type == 'regex':
                matched = bool(re.search(pattern, desc_raw, re.IGNORECASE)) or \
                          bool(re.search(pattern, desc_clean, re.IGNORECASE))

            if matched:
                if rule.set_action and not action:
                    action = rule.set_action
                if rule.set_description:
                    normalized_desc = rule.set_description.upper()
                    display_description = rule.set_description  # keep original casing

        # ── Pass 2: category lookup ──────────────────────────────────────────
        # Try matching against normalized_desc first (exact), then raw desc (contains)
        category = None
        for rule in self.rules:
            if not rule.set_category:
                continue

            pattern = rule.pattern.upper().strip()

            # Primary: exact match on normalized description (Description_Std)
            if normalized_desc.strip() == pattern:
                category = rule.set_category
                break

            # Secondary: pattern contained in normalized description
            if pattern in normalized_desc:
                category = rule.set_category
                break

            # Tertiary: pattern contained in original raw description
            if pattern in desc_clean:
                category = rule.set_category
                break

        # ── Learning from past corrections ───────────────────────────────────
        if not category and apply_corrections:
            merchant = merchant_name or self.extract_merchant(description)
            learned = self.learn_from_corrections(merchant)
            if learned:
                return (
                    action or self.determine_action(amount, description),
                    learned['category'],
                    learned['confidence'],
                    display_description,
                )

        action   = action or self.determine_action(amount, description, account_type)
        category = category or 'Unclassified'
        confidence = 0.85 if category != 'Unclassified' else 0.3

        # ── Action override from user corrections ─────────────────────────────
        # Even when a category rule matched (e.g. Best Buy → Electronics), the
        # user may have previously corrected this merchant's transactions to
        # Transfer (e.g. credit-card payments misidentified as purchases).
        # We apply the override AFTER rule processing so genuine purchases still
        # get their rule-based category while payments are promoted to Transfer.
        if action != 'Transfer' and apply_corrections:
            _merchant = merchant_name or self.extract_merchant(description)
            if _merchant:
                _override = self._check_transfer_correction(_merchant, desc_clean)
                if _override:
                    action     = 'Transfer'
                    category   = ''
                    confidence = _override['confidence']

        return action, category, confidence, display_description
    
    def record_correction(self, transaction: Transaction, old_category: str, new_category: str,
                         old_action: Optional[str] = None, new_action: Optional[str] = None):
        """
        Record a user correction for learning
        """
        correction = UserCorrection(
            transaction_id=transaction.id,
            old_category=old_category,
            new_category=new_category,
            old_action=old_action,
            new_action=new_action,
            description=transaction.description_clean or transaction.description_raw,
            merchant_name=transaction.merchant_name,
            amount=transaction.amount,
            created_at=datetime.utcnow()
        )
        
        self.db.add(correction)
        
        # Update rule statistics if a rule was used
        if transaction.category_auto != 'Unclassified':
            rule = self.match_rule(transaction.description_raw, transaction.amount)
            if rule:
                if new_category == transaction.category_auto:
                    rule.times_accepted += 1
                else:
                    rule.times_rejected += 1
                rule.times_matched += 1
        
        self.db.commit()


def load_rules_from_excel(excel_path: str, db_session: Session):
    """
    Load all three rule groups from the Excel Rules sheet.

    The Rules sheet has three tables laid out side-by-side:

    Group 1 — Action rules (cols 0-3): Priority, MatchType, Pattern → Action
    Group 2 — Description normalization (cols 10-13): Priority.1, MatchType.1, Pattern.1 → CleanDescription
    Group 3 — Category mapping (cols 22-23): Description_Std → DefaultCategory
              These use Description_Std (normalized name) as the pattern, not Pattern.2
              (Pattern.2 and DefaultCategory are NOT row-aligned — they are separate rule sets)
    """
    import pandas as pd

    # Map Excel category names → our 38 categories
    CAT_MAP = {
        'Children':     'Kids',
        'Reading':      'Books',
        'Housekeeping': 'Home',
        'GCB':          'Other',
        'Work':         'Work',
    }

    def norm_cat(name):
        if not isinstance(name, str):
            return None
        return CAT_MAP.get(name.strip(), name.strip())

    TRANSFER_WORDS = ['PAYMENT', 'TRANSFER', 'PMT', 'PYMT', 'AUTOPAY', 'REPAYMENT']
    INCOME_WORDS   = ['DEPOSIT', 'REFUND', 'REIMBURSEMENT']

    df = pd.read_excel(excel_path, sheet_name='Rules')

    # Clear existing imported rules
    db_session.query(CategorizationRule).filter(
        CategorizationRule.notes.like('Excel%')
    ).delete(synchronize_session=False)
    db_session.flush()

    count = 0

    # ── Group 1: explicit action rules (Priority, MatchType, Pattern, Action) ─
    g1 = df[['Priority','MatchType','Pattern','Action']].dropna(
        subset=['Priority','Pattern','Action']
    )
    for _, row in g1.iterrows():
        db_session.add(CategorizationRule(
            priority   = int(row['Priority']),
            match_type = str(row['MatchType']).strip(),
            pattern    = str(row['Pattern']).strip(),
            set_action = str(row['Action']).strip(),
            is_active  = True,
            notes      = 'Excel - action rule',
        ))
        count += 1

    # ── Group 2: description normalization rules ──────────────────────────────
    g2 = df[['Priority.1','MatchType.1','Pattern.1','CleanDescription']].dropna(
        subset=['Priority.1','Pattern.1','CleanDescription']
    )
    for _, row in g2.iterrows():
        clean = str(row['CleanDescription']).strip().upper()
        action = None
        if any(w in clean for w in TRANSFER_WORDS):
            action = 'Transfer'
        elif any(w in clean for w in INCOME_WORDS):
            action = 'Income'

        db_session.add(CategorizationRule(
            priority        = int(row['Priority.1']),
            match_type      = str(row['MatchType.1']).strip(),
            pattern         = str(row['Pattern.1']).strip(),
            set_action      = action,
            set_description = str(row['CleanDescription']).strip(),
            is_active       = True,
            notes           = 'Excel - description rule',
        ))
        count += 1

    # ── Group 3: category mapping (Description_Std → DefaultCategory) ─────────
    # Description_Std is the NORMALIZED merchant name (output of Group 2 rules)
    # We store these as contains rules with high priority offset
    g3 = df[['Description_Std','DefaultCategory']].dropna(
        subset=['Description_Std','DefaultCategory']
    )
    priority = 5000  # High number = lower priority, runs after description normalization
    for _, row in g3.iterrows():
        category = norm_cat(row['DefaultCategory'])
        if not category:
            continue
        desc_std = str(row['Description_Std']).strip()
        db_session.add(CategorizationRule(
            priority     = priority,
            match_type   = 'equals',          # Exact match on normalized description
            pattern      = desc_std,
            set_category = category,
            is_active    = True,
            notes        = 'Excel - category rule',
        ))
        priority += 1
        count += 1

    db_session.commit()
    print(f"Imported {count} rules ({len(g1)} action, {len(g2)} description, {len(g3)} category)")
    return count


if __name__ == "__main__":
    # Test the categorization engine
    from database import init_db, seed_categories
    
    engine, SessionLocal = init_db()
    session = SessionLocal()
    seed_categories(session)
    
    # Load rules from your Excel file
    # load_rules_from_excel('/mnt/user-data/uploads/i_e_v9_2_2026.xlsx', session)
    
    # Test categorization
    categorizer = CategorizationEngine(session)
    
    test_transactions = [
        ("PRUDENTIAL DIR DEP PPD ID: 1221211670", 4344.05),
        ("BESTBUYCOM807134321148 RICHFIELD MN", -127.50),
        ("WHOLE FOODS MARKET #10", -87.32),
        ("CHASE CREDIT CRD AUTOPAY", -1500.00),
    ]
    
    print("\nTest Categorizations:")
    print("="*80)
    for desc, amount in test_transactions:
        action, category, confidence = categorizer.categorize(desc, amount)
        print(f"{desc[:50]:50} | {action:12} | {category:20} | {confidence:.2f}")
    
    session.close()
