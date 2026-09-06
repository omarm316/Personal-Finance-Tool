"""
core/import_helpers.py — CSV/OFX parsing and import-preview/dedup logic
shared by /api/transactions/import and the /api/init/* bulk-import routes.

Extracted from main.py (Phase 0 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split").
"""
from datetime import datetime

from sqlalchemy.orm import Session

from database import Transaction

def _compute_import_hash(account_id: int, date_str: str, amount: float, description: str, occurrence: int) -> str:
    """
    Stable dedup key: SHA-256 of pipe-joined key fields.
    occurrence handles true duplicate rows (same day/amount/desc within one account).
    """
    import hashlib
    raw = f"{account_id}|{date_str}|{round(amount, 2):.2f}|{description.strip().lower()}|{occurrence}"
    return hashlib.sha256(raw.encode()).hexdigest()
def _parse_csv_rows(content: bytes, account_id: int, sign_convention: str) -> list[dict]:
    """
    Parse CSV bytes into normalised row dicts.
    Tries to auto-detect common column name patterns used by major banks/cards.
    sign_convention: 'plaid' (expenses negative), 'bank' (expenses positive, income negative),
                     'auto' (detect from amount values — if most non-zero amounts are positive, flip)
    Returns list of {date, amount, description, raw_row}.
    """
    import csv, io as _io

    text = content.decode("utf-8-sig", errors="replace")  # handle BOM
    reader = csv.DictReader(_io.StringIO(text))
    headers = [h.strip().lower() for h in (reader.fieldnames or [])]

    # Column name aliases for common banks
    DATE_ALIASES   = ['date', 'transaction date', 'trans date', 'posted date', 'posting date', 'settlement date']
    AMT_ALIASES    = ['amount', 'transaction amount', 'debit/credit', 'net amount']
    DEBIT_ALIASES  = ['debit', 'debit amount', 'withdrawal', 'withdrawals']
    CREDIT_ALIASES = ['credit', 'credit amount', 'deposit', 'deposits']
    DESC_ALIASES   = ['description', 'transaction description', 'merchant', 'merchant name',
                      'name', 'memo', 'payee', 'details', 'narrative']

    def pick(aliases):
        for a in aliases:
            if a in headers:
                return reader.fieldnames[[h.strip().lower() for h in reader.fieldnames].index(a)]
        return None

    date_col   = pick(DATE_ALIASES)
    amt_col    = pick(AMT_ALIASES)
    debit_col  = pick(DEBIT_ALIASES)
    credit_col = pick(CREDIT_ALIASES)
    desc_col   = pick(DESC_ALIASES)

    if not date_col or not desc_col:
        raise ValueError(f"Cannot find date/description columns. Headers found: {reader.fieldnames}")
    if not amt_col and not (debit_col and credit_col):
        raise ValueError(f"Cannot find amount column(s). Headers found: {reader.fieldnames}")

    rows = []
    for row in reader:
        raw_date = row.get(date_col, '').strip()
        raw_desc = row.get(desc_col, '').strip()
        if not raw_date or not raw_desc:
            continue

        # Parse date — try common formats
        parsed_date = None
        for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%d/%m/%Y', '%Y/%m/%d', '%m-%d-%Y', '%d-%m-%Y'):
            try:
                parsed_date = datetime.strptime(raw_date, fmt)
                break
            except ValueError:
                continue
        if not parsed_date:
            continue  # skip unparseable dates

        # Parse amount
        def clean_num(s):
            return float(s.replace('$', '').replace(',', '').strip() or '0')

        if amt_col:
            try:
                amount = clean_num(row.get(amt_col, '0'))
            except ValueError:
                continue
        else:
            try:
                debit  = clean_num(row.get(debit_col,  '') or '0')
                credit = clean_num(row.get(credit_col, '') or '0')
                # Debit = money out (expense), credit = money in (income)
                amount = credit - debit  # result: positive = income, negative = expense
            except ValueError:
                continue

        # Apply sign convention
        if sign_convention == 'bank':
            # Bank statements: debits shown as positive → flip to our negative-expense convention
            amount = -amount
        elif sign_convention == 'auto':
            # Will be resolved after full parse; store as-is for now
            pass
        # 'plaid' → no flip needed (already negative for expenses)

        rows.append({
            'date': parsed_date,
            'date_str': parsed_date.strftime('%Y-%m-%d'),
            'amount': round(amount, 2),
            'description': raw_desc,
        })

    # Auto sign detection: if most expenses look positive, flip all
    if sign_convention == 'auto' and rows:
        positives = sum(1 for r in rows if r['amount'] > 0)
        if positives > len(rows) * 0.6:
            # Majority positive → likely bank convention, flip
            for r in rows:
                r['amount'] = -r['amount']

    return rows
def _parse_ofx_rows(content: bytes, account_id: int) -> list[dict]:
    """
    Parse OFX/QFX bytes into normalised row dicts.
    OFX uses SGML-like tags: <DTPOSTED>, <TRNAMT>, <NAME>/<MEMO>.
    OFX sign convention: negative = debit/expense, positive = credit/income — matches ours.
    """
    import re
    text = content.decode("utf-8-sig", errors="replace")

    def extract(tag, block):
        m = re.search(rf'<{tag}>(.*?)(?:<|$)', block, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else ''

    # Find all STMTTRN blocks
    blocks = re.findall(r'<STMTTRN>(.*?)</STMTTRN>', text, re.IGNORECASE | re.DOTALL)
    rows = []
    for block in blocks:
        raw_date = extract('DTPOSTED', block) or extract('DTUSER', block)
        raw_amt  = extract('TRNAMT', block)
        name     = extract('NAME', block) or extract('MEMO', block) or extract('PAYEE', block)

        if not raw_date or not raw_amt:
            continue

        # OFX date: YYYYMMDD[HHMMSS[.mmm][ZZZ]]
        date_str = raw_date[:8]
        try:
            parsed_date = datetime.strptime(date_str, '%Y%m%d')
        except ValueError:
            continue

        try:
            amount = round(float(raw_amt.replace(',', '')), 2)
        except ValueError:
            continue

        rows.append({
            'date': parsed_date,
            'date_str': parsed_date.strftime('%Y-%m-%d'),
            'amount': amount,
            'description': name or 'Unknown',
        })

    return rows
def _build_preview(rows: list[dict], account_id: int, db: Session) -> dict:
    """
    Given normalised rows, compute import hashes, check against existing transactions,
    and return a preview dict: {to_import, duplicates, rows}.
    """
    # Count occurrences of (date_str, amount, description) within this batch
    from collections import Counter
    seen_counter: Counter = Counter()
    result_rows = []

    # Pre-load existing hashes for this account for fast lookup
    existing_hashes = {
        h for (h,) in db.query(Transaction.import_hash)
        .filter(Transaction.account_id == account_id, Transaction.import_hash != None)
        .all()
    }
    # Also consider hashes we've already generated in this batch (within-batch dedup)
    batch_hashes: set[str] = set()

    for row in rows:
        key = (row['date_str'], round(row['amount'], 2), row['description'].strip().lower())
        occurrence = seen_counter[key]
        seen_counter[key] += 1

        h = _compute_import_hash(account_id, row['date_str'], row['amount'], row['description'], occurrence)

        is_duplicate = (h in existing_hashes) or (h in batch_hashes)
        batch_hashes.add(h)

        result_rows.append({
            **row,
            'import_hash': h,
            'duplicate': is_duplicate,
        })

    to_import  = [r for r in result_rows if not r['duplicate']]
    duplicates = [r for r in result_rows if r['duplicate']]

    return {
        'total_rows': len(result_rows),
        'to_import': len(to_import),
        'duplicates': len(duplicates),
        'rows': result_rows,
    }
