"""
Categorization engine - rule-based matching against CategorizationRule.
"""
import re
from typing import Tuple, Optional, List, Dict
from sqlalchemy.orm import Session
from database import CategorizationRule, UserCorrection, Transaction
from datetime import datetime


def compute_needs_review(action: str, category: str, confidence: float, source: Optional[str] = None) -> bool:
    """
    Single source of truth for whether a transaction needs human review.

    Transfers are never flagged — they're routing/payment mechanics, not a
    categorization call. A source of 'llm'/'fallback'/'override' always needs
    a look, since it wasn't resolved by an explicit rule. Otherwise, review
    whenever confidence is below the rule-match threshold (0.85) or the
    category is still Unclassified — the two are correlated by construction
    in categorize() (Unclassified always carries confidence 0.3), but both
    are checked explicitly for defensiveness against future callers that
    might not preserve that correlation.
    """
    if action == 'Transfer':
        return False
    if source in ('llm', 'fallback', 'override'):
        return True
    return confidence < 0.85 or category == 'Unclassified'


def find_overlapping_rules(
    db: Session,
    pattern: str,
    set_category: Optional[str] = None,
    set_action: Optional[str] = None,
    exclude_rule_id: Optional[int] = None,
) -> List[Dict]:
    """
    Find active rules whose pattern overlaps the given pattern (substring
    either direction, case-insensitive) but disagree on set_category or
    set_action. Non-blocking — used to warn at rule-creation time, and as a
    one-time read-only audit against all existing rules.

    Overlap alone isn't a problem (a specific pattern intentionally nested
    inside a more general one, both agreeing on the outcome, is normal and
    is exactly what priority ordering is for) — only a *disagreement* on
    outcome for an overlapping pattern is worth surfacing, since that's what
    produces contradictory or unpredictable classification for anyone
    matching both patterns.
    """
    pattern_upper = (pattern or '').upper().strip()
    if not pattern_upper:
        return []

    candidates = db.query(CategorizationRule).filter(CategorizationRule.is_active == True).all()
    conflicts = []
    for r in candidates:
        if exclude_rule_id and r.id == exclude_rule_id:
            continue
        r_pattern = (r.pattern or '').upper().strip()
        if not r_pattern:
            continue
        if not (pattern_upper in r_pattern or r_pattern in pattern_upper):
            continue

        disagrees = (
            (set_category and r.set_category and set_category != r.set_category) or
            (set_action and r.set_action and set_action != r.set_action)
        )
        if disagrees:
            conflicts.append({
                'rule_id': r.id,
                'pattern': r.pattern,
                'set_category': r.set_category,
                'set_action': r.set_action,
            })
    return conflicts


class CategorizationEngine:
    """
    Rule-based categorization engine:
    1. Matches transaction descriptions against active CategorizationRules
    2. Assigns confidence scores
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
                    account_type: str = '') -> Tuple[str, str, float, Optional[str]]:
        """
        Two-pass categorization:
        Pass 1 — Match raw description against action/description rules (Groups 1 & 2)
                 to get action + normalized description
        Pass 2 — Match normalized description against category rules (Group 3)
                 to get category

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

        action   = action or self.determine_action(amount, description, account_type)
        category = category or 'Unclassified'
        confidence = 0.85 if category != 'Unclassified' else 0.3

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
