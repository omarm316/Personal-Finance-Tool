"""
Database models for the finance automation system
"""
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

Base = declarative_base()


def _get_cipher():
    """
    Derive an encryption key from PLAID_SECRET so tokens are encrypted at rest.
    No separate key to manage — tied to your existing credential.
    """
    secret = os.getenv('PLAID_SECRET', 'fallback-dev-secret-change-in-production')
    salt = b'finance_automation_salt_v1'  # Fixed salt is fine here; secret is the entropy
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100_000)
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    return Fernet(key)


def encrypt_token(token: str) -> str:
    """Encrypt a Plaid access token for storage"""
    return _get_cipher().encrypt(token.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    """Decrypt a stored Plaid access token"""
    return _get_cipher().decrypt(encrypted.encode()).decode()


class PlaidItem(Base):
    """
    Represents a Plaid Item (one per bank connection).
    Stores the access token encrypted so it survives server restarts.
    """
    __tablename__ = 'plaid_items'

    id = Column(Integer, primary_key=True)
    item_id = Column(String(100), unique=True, nullable=False, index=True)
    institution_name = Column(String(200))          # e.g. "Chase"
    access_token_enc = Column(Text, nullable=False) # AES-encrypted via Fernet
    cursor = Column(Text, nullable=True)            # Plaid sync cursor — persisted here
    last_synced_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def access_token(self) -> str:
        """Decrypt and return the access token"""
        return decrypt_token(self.access_token_enc)

    @access_token.setter
    def access_token(self, raw_token: str):
        """Encrypt and store the access token"""
        self.access_token_enc = encrypt_token(raw_token)


class Account(Base):
    """Bank/credit card accounts linked via Plaid"""
    __tablename__ = 'accounts'
    
    id = Column(Integer, primary_key=True)
    plaid_account_id = Column(String(100), unique=True, nullable=True, index=True)  # NULL for manual accounts
    plaid_item_id = Column(String(100), nullable=True, index=True)  # FK to plaid_items.item_id; NULL for manual
    account_name = Column(String(100), nullable=False)  # e.g., "Chase 8997"
    account_type = Column(String(50))  # checking, credit, etc.
    official_name = Column(String(200))
    mask = Column(String(10))  # Last 4 digits
    is_manual = Column(Boolean, default=False)
    starting_balance = Column(Float, default=0)       # Balance when tracking began
    start_date = Column(DateTime, nullable=True)       # Date starting_balance applies to
    notes = Column(Text, nullable=True)                # Optional user notes
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("Transaction", back_populates="account")
    card = relationship("Card", back_populates="account", uselist=False, foreign_keys="Card.account_id")


class Transaction(Base):
    """Individual transactions from Plaid"""
    __tablename__ = 'transactions'
    
    id = Column(Integer, primary_key=True)
    plaid_transaction_id = Column(String(100), unique=True, nullable=True, index=True)  # NULL for manual txns
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=False, index=True)
    
    # Core transaction data
    date = Column(DateTime, nullable=False, index=True)
    amount = Column(Float, nullable=False)  # Negative for expenses, positive for income
    description_raw = Column(String(500), nullable=False)
    description_clean = Column(String(500))  # Cleaned/standardized description
    merchant_name = Column(String(200))
    
    # Categorization
    action = Column(String(50), index=True)  # Income, Expense, Transfer, Depreciation
    category_auto = Column(String(100))  # Auto-assigned category
    category_manual = Column(String(100))  # User-corrected category
    category_confidence = Column(Float)  # Confidence score 0-1
    
    # Status
    needs_review = Column(Boolean, default=True, index=True)
    is_locked = Column(Boolean, default=False, index=True)  # Protects manual edits from sync overwrites
    is_split = Column(Boolean, default=False)
    parent_transaction_id = Column(Integer, ForeignKey('transactions.id'), nullable=True)

    # Enrichment source — how this transaction got its category/description
    # Values: 'rule' (matched a categorization rule), 'llm' (Groq LLM),
    #         'fallback' (LLM unavailable), 'manual' (user-created), None (not yet enriched)
    enrichment_source = Column(String(20), nullable=True)

    # Import tracking — for CSV/OFX imported transactions (NULL for Plaid)
    # import_hash: SHA-256 of (account_id + date + amount + description + occurrence_index)
    #              used for deduplication on re-import; unique constraint allows NULL (Plaid txns)
    import_hash = Column(String(64), unique=True, nullable=True, index=True)
    # import_source: 'plaid' | 'csv' | 'ofx' | 'manual'
    import_source = Column(String(20), nullable=True)

    # GCB (Gift Card Business) tagging
    gcb_tagged = Column(Boolean, default=False, index=True)  # Legacy — kept for backward compat
    is_gcb = Column(Boolean, default=False, index=True)       # New canonical GCB flag (Section 3b)

    # Points tracking
    points_category = Column(String(100), nullable=True)   # From PointsCategory table
    card_id = Column(Integer, ForeignKey('cards.id'), nullable=True)  # Which card was used

    # Loan payment tracking — set when this transaction is linked to a loan payment
    loan_id = Column(Integer, ForeignKey('loans.id'), nullable=True, index=True)

    # Exclude flag — user can exclude a transaction from all totals/balances without deleting it
    # Useful for pending transactions that already entered the DB and should be ignored.
    is_excluded = Column(Boolean, default=False, index=True)

    # Metadata
    year = Column(Integer, index=True)
    month = Column(Integer, index=True)
    day = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    
    # Relationships
    account = relationship("Account", back_populates="transactions")
    splits = relationship("Transaction", remote_side=[id], foreign_keys=[parent_transaction_id])
    
    # Composite indexes for common queries
    __table_args__ = (
        Index('ix_transactions_date_account', 'date', 'account_id'),
        Index('ix_transactions_needs_review_date', 'needs_review', 'date'),
        Index('ix_transactions_year_month', 'year', 'month'),
    )
    
    @property
    def category_final(self):
        """Return manual category if set, otherwise auto category"""
        return self.category_manual or self.category_auto
    
    @property
    def amount_final(self):
        """Return actual transaction amount"""
        return self.amount


class CategorizationRule(Base):
    """Rules for automatic categorization based on description patterns"""
    __tablename__ = 'categorization_rules'

    id = Column(Integer, primary_key=True)
    priority = Column(Integer, default=100, index=True)  # Lower = higher priority
    priority_order = Column(Integer, default=0)  # Sub-priority within same priority level (Section 2D)
    match_type = Column(String(50), nullable=False)  # contains, equals, starts_with, regex
    pattern = Column(String(500), nullable=False, index=True)

    # Actions
    set_action = Column(String(50))  # Income, Expense, Transfer, etc.
    set_category = Column(String(100))
    set_description = Column(String(500))  # Standardized description
    clean_description = Column(String(500))  # Cleaned/normalized output description (Section 2D)

    # Metadata
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text)

    # Learning stats
    times_matched = Column(Integer, default=0)
    times_accepted = Column(Integer, default=0)
    times_rejected = Column(Integer, default=0)
    
    @property
    def accuracy(self):
        """Calculate rule accuracy"""
        total = self.times_accepted + self.times_rejected
        if total == 0:
            return None
        return self.times_accepted / total


class Category(Base):
    """Master list of expense/income categories"""
    __tablename__ = 'categories'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    parent_category = Column(String(100), nullable=True)  # For future subcategories
    category_type = Column(String(50), index=True)  # expense, income, or both
    is_active = Column(Boolean, default=True)
    display_order = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserCorrection(Base):
    """Track user corrections to improve ML over time"""
    __tablename__ = 'user_corrections'
    
    id = Column(Integer, primary_key=True)
    transaction_id = Column(Integer, ForeignKey('transactions.id'), nullable=False, index=True)
    
    # What changed
    old_category = Column(String(100))
    new_category = Column(String(100), nullable=False)
    old_action = Column(String(50))
    new_action = Column(String(50))
    
    # Context for learning
    description = Column(String(500))
    merchant_name = Column(String(200))
    amount = Column(Float)
    
    created_at = Column(DateTime, default=datetime.utcnow)



class TransactionSplit(Base):
    """
    Split line items for a parent transaction (Section 3a).
    Sum of split amounts must equal parent transaction amount.
    """
    __tablename__ = 'transaction_splits'

    id = Column(Integer, primary_key=True)
    parent_transaction_id = Column(Integer, ForeignKey('transactions.id'), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    description = Column(String(500))
    category = Column(String(100))
    action = Column(String(50), nullable=True)  # Type per split line (Section 4F)
    is_gcb = Column(Boolean, default=False)  # GCB tag per split
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Loan(Base):
    """
    Loan tracking — mortgages, auto loans, student loans, etc. (Section 1).
    Links to an account for balance tracking.
    """
    __tablename__ = 'loans'

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)  # Linked liability account
    lender = Column(String(200), nullable=False)
    loan_type = Column(String(50), nullable=False)  # mortgage, auto, student, personal, other
    original_principal = Column(Float, nullable=False)
    current_balance = Column(Float, nullable=True)   # Known balance as of balance_date
    balance_date = Column(DateTime, nullable=True)   # Date when current_balance was recorded
    remaining_term_months = Column(Integer, nullable=True)  # Remaining months as of balance_date
    interest_rate = Column(Float, nullable=True)     # Annual rate as percentage (e.g. 6.5)
    term_months = Column(Integer, nullable=True)     # Original total term in months
    monthly_payment = Column(Float, nullable=True)   # Total monthly payment (PITI)
    property_tax_monthly = Column(Float, nullable=True)   # Escrow: monthly property tax portion
    insurance_monthly = Column(Float, nullable=True)      # Escrow: monthly insurance portion
    payment_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)  # Checking account that pays
    payment_due_day = Column(Integer, nullable=True)      # Day of month payment is due (1-31)
    start_date = Column(DateTime, nullable=True)
    maturity_date = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AccountMonthlySnapshot(Base):
    """
    Monthly opening/closing balance snapshots per account.
    Populated by the Balance Sync tool and updated after every Plaid transaction sync.
    Formula: opening_balance + SUM(transactions in month) = closing_balance
    """
    __tablename__ = 'account_monthly_snapshots'

    id              = Column(Integer, primary_key=True)
    account_id      = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False, index=True)
    year            = Column(Integer, nullable=False)
    month           = Column(Integer, nullable=False)   # 1–12
    opening_balance = Column(Float, nullable=False)
    closing_balance = Column(Float, nullable=False)
    synced_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('account_id', 'year', 'month', name='uq_account_month'),
    )


class BudgetTarget(Base):
    """
    Monthly budget targets per category (Section 4).
    Unique on (year, month, category) — one amount per cell.
    """
    __tablename__ = 'budget_targets'

    id = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)  # 1-12
    category = Column(String(100), nullable=False, index=True)
    amount = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('ix_budget_targets_ymc', 'year', 'month', 'category', unique=True),
    )


class PointsCategory(Base):
    """Universal points/miles earning categories based on card issuer classification"""
    __tablename__ = 'points_categories'

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    display_order = Column(Integer, default=100)
    is_active = Column(Boolean, default=True)

    merchant_mappings = relationship("MerchantPointsMapping", back_populates="points_category")


class Card(Base):
    """Credit/debit cards — one per physical card"""
    __tablename__ = 'cards'

    id = Column(Integer, primary_key=True)
    card_id = Column(String(50), unique=True, nullable=False, index=True)  # e.g. "VISA 1677"
    last_four = Column(Integer, nullable=True)      # Actual last 4 of card number
    issuer = Column(String(50))                     # CHASE, AMEX, CITI, BOA, etc.
    brand = Column(String(100))                     # Hyatt, Hilton, Chase, etc.
    card_name = Column(String(200))                 # Sapphire Preferred, Freedom, etc.
    network = Column(String(20))                    # VISA, AMEX, MC, DISCOVER
    issue_date = Column(DateTime, nullable=True)
    close_date = Column(DateTime, nullable=True)    # Date card was closed (null = active)
    annual_fee = Column(Float, nullable=True)
    credit_limit = Column(Float, nullable=True)
    statement_close_day = Column(Integer, nullable=True)   # Day of month (1-31)
    payment_due_day = Column(Integer, nullable=True)       # Day of month (1-31)
    plaid_account_id = Column(String(100), nullable=True)  # Legacy string link — prefer account_id
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True, index=True)  # Proper FK to Account
    payment_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)  # Checking account that pays this card
    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account = relationship("Account", back_populates="card", foreign_keys=[account_id])
    payment_account = relationship("Account", foreign_keys=[payment_account_id])
    merchant_mappings = relationship("MerchantPointsMapping", back_populates="card")


class MerchantPointsMapping(Base):
    """Maps merchant + card to points category for points calculation"""
    __tablename__ = 'merchant_points_mappings'

    id = Column(Integer, primary_key=True)
    merchant_pattern = Column(String(200), nullable=False, index=True)  # Merchant name/pattern
    card_id = Column(Integer, ForeignKey('cards.id'), nullable=True)    # Null = applies to all cards
    points_category_id = Column(Integer, ForeignKey('points_categories.id'), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    card = relationship("Card", back_populates="merchant_mappings")
    points_category = relationship("PointsCategory", back_populates="merchant_mappings")


class MerchantOverride(Base):
    """
    User-confirmed merchant → category mappings.
    When a user manually corrects a category, we save it here so future
    transactions from the same merchant resolve instantly (no LLM call needed).
    The merchant_key is a normalised version of description_raw so that
    "STARBUCKS #1234" and "STARBUCKS #9999" both resolve to the same override.
    """
    __tablename__ = 'merchant_overrides'

    id = Column(Integer, primary_key=True)
    merchant_key = Column(String(100), unique=True, nullable=False, index=True)  # Normalised lookup key
    merchant_name = Column(String(200), nullable=False)      # Clean display name, e.g. "Starbucks"
    description_clean = Column(String(500), nullable=True)   # Clean description, e.g. "Starbucks Coffee"
    category = Column(String(100), nullable=False)           # Category from Category table
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)



def _is_sqlite(engine):
    return str(engine.url).startswith('sqlite')


def run_migrations(engine):
    """
    Auto-migrate: safely add any missing columns to existing tables.
    Safe to run on every startup — skips columns that already exist.
    Supports both SQLite and PostgreSQL.
    """
    required_columns = {
        'transactions': [
            ('is_locked',       'BOOLEAN DEFAULT FALSE'),
            ('is_split',        'BOOLEAN DEFAULT FALSE'),
            ('parent_transaction_id', 'INTEGER'),
            ('gcb_tagged',      'BOOLEAN DEFAULT FALSE'),
            ('is_gcb',          'BOOLEAN DEFAULT FALSE'),
            ('points_category', 'VARCHAR(100)'),
            ('card_id',         'INTEGER'),
            ('reviewed_at',       'TIMESTAMP'),
            ('enrichment_source', 'VARCHAR(20)'),
            ('import_hash',       'VARCHAR(64)'),
            ('import_source',     'VARCHAR(20)'),
            ('loan_id',           'INTEGER'),
            ('is_excluded',       'BOOLEAN DEFAULT FALSE'),
        ],
        'accounts': [
            ('is_manual', 'BOOLEAN DEFAULT FALSE'),
            ('starting_balance', 'FLOAT DEFAULT 0'),
            ('start_date', 'DATE'),
            ('notes', 'TEXT'),
        ],
        'cards': [
            ('account_id', 'INTEGER'),
            ('payment_account_id', 'INTEGER'),
        ],
        'loans': [
            ('balance_date',          'DATE'),
            ('remaining_term_months', 'INTEGER'),
            ('property_tax_monthly',  'FLOAT'),
            ('insurance_monthly',     'FLOAT'),
            ('payment_account_id',    'INTEGER'),
            ('payment_due_day',       'INTEGER'),
        ],
        'categorization_rules': [
            ('clean_description', 'VARCHAR(500)'),
            ('priority_order', 'INTEGER DEFAULT 0'),
        ],
        'transaction_splits': [
            ('action', 'VARCHAR(50)'),
        ],
        'merchant_overrides': [],   # No extra columns needed beyond what the model defines
    }

    if _is_sqlite(engine):
        _run_migrations_sqlite(engine, required_columns)
    else:
        _run_migrations_pg(engine, required_columns)


def _run_migrations_sqlite(engine, required_columns):
    import sqlite3
    db_path = str(engine.url).replace('sqlite:///', '')
    conn = sqlite3.connect(db_path)
    try:
        for table, columns in required_columns.items():
            cursor = conn.execute(f'PRAGMA table_info({table})')
            existing = {row[1] for row in cursor.fetchall()}
            for col_name, col_def in columns:
                if col_name not in existing:
                    conn.execute(f'ALTER TABLE {table} ADD COLUMN {col_name} {col_def}')
                    print(f'  Migration: added {table}.{col_name}')
        try:
            cursor = conn.execute('PRAGMA table_info(transactions)')
            cols = {row[1] for row in cursor.fetchall()}
            if 'is_gcb' in cols and 'gcb_tagged' in cols:
                conn.execute('UPDATE transactions SET is_gcb = gcb_tagged WHERE is_gcb = 0 AND gcb_tagged = 1')
                print('  Migration: copied gcb_tagged → is_gcb')
        except Exception:
            pass
        try:
            cursor = conn.execute('PRAGMA table_info(budget_targets)')
            bt_cols = {row[1] for row in cursor.fetchall()}
            if bt_cols and 'year' not in bt_cols:
                conn.execute('DROP TABLE IF EXISTS budget_targets')
                print('  Migration: dropped old budget_targets table (will be recreated)')
        except Exception:
            pass
        # Normalize account_type to Title Case
        try:
            type_map = [
                ('checking',    'Checking'),
                ('savings',     'Savings'),
                ('brokerage',   'Brokerage'),
                ('investment',  'Investment'),
                ('credit card', 'Credit Card'),
                ('credit',      'Credit Card'),
                ('loan',        'Loan'),
                ('other',       'Other'),
            ]
            for old_val, new_val in type_map:
                conn.execute(
                    "UPDATE accounts SET account_type = ? WHERE LOWER(account_type) = ?",
                    (new_val, old_val)
                )
            print('  Migration: normalized account_type casing')
        except Exception:
            pass
        conn.commit()
    finally:
        conn.close()


def _run_migrations_pg(engine, required_columns):
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, columns in required_columns.items():
            if not insp.has_table(table):
                continue
            existing = {c['name'] for c in insp.get_columns(table)}
            for col_name, col_def in columns:
                if col_name not in existing:
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {col_name} {col_def}'))
                    print(f'  Migration: added {table}.{col_name}')
        if insp.has_table('transactions'):
            existing = {c['name'] for c in insp.get_columns('transactions')}
            if 'is_gcb' in existing and 'gcb_tagged' in existing:
                conn.execute(text(
                    'UPDATE transactions SET is_gcb = gcb_tagged WHERE is_gcb = FALSE AND gcb_tagged = TRUE'
                ))
                print('  Migration: copied gcb_tagged → is_gcb')
        # Normalize account_type to Title Case
        if insp.has_table('accounts'):
            type_map = [
                ('checking',    'Checking'),
                ('savings',     'Savings'),
                ('brokerage',   'Brokerage'),
                ('investment',  'Investment'),
                ('credit card', 'Credit Card'),
                ('credit',      'Credit Card'),
                ('loan',        'Loan'),
                ('other',       'Other'),
            ]
            for old_val, new_val in type_map:
                conn.execute(text(
                    "UPDATE accounts SET account_type = :new WHERE LOWER(account_type) = :old"
                ), {'new': new_val, 'old': old_val})
            print('  Migration: normalized account_type casing')

# Database initialization
def init_db(database_url=None):
    """Initialize the database with schema. Reads DATABASE_URL from env, falls back to SQLite."""
    if database_url is None:
        database_url = os.getenv('DATABASE_URL', 'sqlite:///./finance.db')
    # Railway/Heroku may provide postgres:// but SQLAlchemy 2.x needs postgresql://
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    engine = create_engine(database_url, echo=False)
    Base.metadata.create_all(engine)
    run_migrations(engine)
    # Re-run create_all to pick up any tables dropped by migration (e.g. budget_targets schema change)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    return engine, SessionLocal


def seed_categories(session):
    """Seed the database with your expense categories"""
    categories_data = [
        # Expense categories from your budget
        ("Groceries", None, "expense", 1),
        ("Dining", None, "expense", 2),
        ("Transportation", None, "expense", 3),
        ("Housing", None, "expense", 4),
        ("Healthcare", None, "expense", 5),
        ("Education", None, "expense", 6),
        ("Entertainment", None, "expense", 7),  # Combined Leisure
        ("Clothing", None, "expense", 8),
        ("Electronics", None, "expense", 9),
        ("Phone", None, "expense", 10),
        ("Internet", None, "expense", 11),
        ("Streaming", None, "expense", 12),
        ("Insurance", None, "expense", 13),
        ("Fitness", None, "expense", 14),
        ("Self Care", None, "expense", 15),
        ("Vehicle", None, "expense", 16),
        ("Travel", None, "expense", 17),
        ("Gifts", None, "expense", 18),
        ("Books", None, "expense", 19),
        ("Kids", None, "expense", 20),
        ("Parents", None, "expense", 21),
        ("Siblings", None, "expense", 22),
        ("For Others", None, "expense", 23),
        ("Home", None, "expense", 24),
        ("Water", None, "expense", 25),
        ("Electricity", None, "expense", 26),
        ("Fees and Interest", None, "expense", 27),
        ("Consulting", None, "expense", 28),
        ("Studies", None, "expense", 29),
        ("Music Lessons", None, "expense", 30),
        ("Tutoring", None, "expense", 31),
        ("Events", None, "expense", 32),
        ("Lottery", None, "expense", 33),
        ("Dry Cleaning", None, "expense", 34),
        ("Investments", None, "expense", 35),
        ("Other", None, "expense", 36),
        ("Leisure", None, "expense", 37),
        
        # Income categories
        ("Work", None, "income", 1),
        ("Investment Income", None, "income", 2),
        ("Interest Income", None, "income", 3),
        
        # Special
        ("Unclassified", None, "both", 100),
        ("Transfer", None, "both", 101),
    ]
    
    for name, parent, cat_type, order in categories_data:
        existing = session.query(Category).filter_by(name=name).first()
        if not existing:
            category = Category(
                name=name,
                parent_category=parent,
                category_type=cat_type,
                display_order=order
            )
            session.add(category)
    
    session.commit()


if __name__ == "__main__":
    # Test database creation
    engine, SessionLocal = init_db()
    session = SessionLocal()
    seed_categories(session)
    session.close()
    print("Database initialized successfully!")

def seed_points_categories(session):
    """Seed universal points/miles earning categories"""
    cats = [
        ("Groceries", 1),
        ("Drug Store", 2),
        ("Gas & EV Charging", 3),
        ("Dining & Restaurants", 4),
        ("Travel", 5),
        ("Transit & Rideshare", 6),
        ("Streaming & Subscriptions", 7),
        ("Online Retail", 8),
        ("General Merchandise", 9),
        ("Wholesale Clubs", 10),
        ("Home Improvement", 11),
        ("Healthcare & Medical", 12),
        ("Other / Uncategorized", 13),
    ]
    for name, order in cats:
        if not session.query(PointsCategory).filter_by(name=name).first():
            session.add(PointsCategory(name=name, display_order=order))
    session.commit()


def import_cards_from_excel(filepath, session):
    """Import cards from Excel file"""
    import openpyxl
    wb = openpyxl.load_workbook(filepath)
    ws = wb.active
    headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]

    imported = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        d = dict(zip(headers, row))
        card_id = str(d.get('ID', '')).strip()
        if not card_id:
            continue
        existing = session.query(Card).filter_by(card_id=card_id).first()
        if not existing:
            # Parse close_date if present
            close_date = d.get('Close Date')
            if close_date and hasattr(close_date, 'year'):
                pass  # already a datetime
            else:
                close_date = None

            card = Card(
                card_id=card_id,
                last_four=d.get('Last 4'),
                issuer=str(d.get('Issuer', '')).strip() or None,
                brand=str(d.get('Brand', '')).strip() or None,
                card_name=str(d.get('Card', '')).strip() or None,
                network=str(d.get('Network', '')).strip() or None,
                issue_date=d.get('Issue Date'),
                close_date=close_date,
                annual_fee=d.get('Annual Fee'),
                credit_limit=d.get('Credit Limit'),
                is_active=close_date is None,
            )
            session.add(card)
            imported += 1
    session.commit()
    return imported

