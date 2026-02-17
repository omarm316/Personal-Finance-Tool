# Finance Automation System - Setup Guide

## Overview
This system automates your transaction tracking using Plaid API integration, automatic categorization based on your existing rules, and a clean web interface for review.

## Features
- ✅ Automatic transaction fetching via Plaid (all your bank accounts)
- ✅ Rule-based categorization (imported from your Excel rules)
- ✅ Machine learning from your corrections
- ✅ Clean web UI for reviewing and adjusting
- ✅ SQLite database (lightweight, file-based)
- ✅ CSV/Excel export anytime
- ✅ Support for transaction splits
- ✅ ~18-20k transactions/year capacity

## Architecture
```
Frontend (React)  →  Backend (FastAPI)  →  Database (SQLite)
                           ↓
                     Plaid API (Banks)
                           ↓
                  Categorization Engine
```

## Prerequisites
- Python 3.8+
- Plaid API credentials (free sandbox account)
- Modern web browser

## Installation

### Step 1: Install Dependencies
```bash
cd /home/claude/finance-automation
pip install -r requirements.txt --break-system-packages
```

### Step 2: Get Plaid API Credentials
1. Go to https://dashboard.plaid.com/signup
2. Create a free account (Sandbox environment)
3. Get your Client ID and Secret from the dashboard
4. For production, you'll need to apply for Production access

### Step 3: Configure Environment
Create a `.env` file:
```bash
cat > .env << EOF
PLAID_CLIENT_ID=your_client_id_here
PLAID_SECRET=your_secret_here
PLAID_ENV=sandbox
EOF
```

### Step 4: Initialize Database
```bash
# Import your categories and rules from Excel
python database.py

# Import rules from your Excel file
python categorization.py
```

Or use the API endpoint after starting the server:
```bash
curl -X POST http://localhost:8000/api/init/import-rules
```

### Step 5: Start the Backend
```bash
python main.py
```

The API will start on http://localhost:8000

### Step 6: Open the Frontend
Open `frontend.html` in your browser:
```bash
# Linux
xdg-open frontend.html

# Mac
open frontend.html

# Windows
start frontend.html
```

## First-Time Setup Flow

### 1. Connect Bank Accounts (Plaid Link)
1. Click "Connect Bank" in the UI
2. Plaid Link will open - select your bank
3. Enter credentials (use test credentials in Sandbox)
4. Select accounts to link
5. System will fetch last 2 years of transactions

### 2. Initial Categorization
- All transactions are auto-categorized using your rules
- Low-confidence transactions marked for review
- Review interface shows confidence scores

### 3. Review Transactions
1. Filter to "Needs Review Only"
2. Click "Review" on each transaction
3. Adjust category if needed
4. Click "Save" - system learns from your correction

### 4. Export Data
- Click "Export CSV" anytime
- Compatible with your existing Excel workflow
- Can import back into Excel if needed

## Usage Guide

### Daily Workflow
1. Click "Sync Transactions" (fetches new transactions)
2. Review flagged transactions (typically 10-20%)
3. Make corrections as needed
4. System learns and improves accuracy

### Category Management
Your existing 38 categories are pre-loaded:
- Groceries, Dining, Transportation, Housing, Healthcare
- Education, Entertainment, Clothing, Electronics
- Phone, Internet, Streaming, Insurance, Fitness
- (and 23 more from your Excel file)

### Rules System
Rules are imported from your Excel "Rules" sheet:
- Pattern matching (contains, equals, starts_with)
- Priority-based (lower number = higher priority)
- Action determination (Income, Expense, Transfer)
- Category assignment

### Learning System
The system learns from your corrections:
- Tracks merchant patterns
- Builds confidence over time
- Suggests categories based on past corrections
- Improves accuracy with use

## API Documentation

### Key Endpoints

**Transactions**
- `GET /api/transactions` - List transactions (with filters)
- `GET /api/transactions/{id}` - Get single transaction
- `PATCH /api/transactions/{id}` - Update category/status
- `GET /api/export/csv` - Export to CSV

**Plaid Integration**
- `GET /api/plaid/link-token` - Create Link token
- `POST /api/plaid/exchange-token` - Exchange public token
- `POST /api/plaid/sync-transactions` - Sync all accounts

**Categories & Stats**
- `GET /api/categories` - List all categories
- `GET /api/stats` - Get statistics

**Health**
- `GET /health` - Health check

Full API docs available at: http://localhost:8000/docs

## Database Schema

### Tables
- **accounts** - Connected bank/credit accounts
- **transactions** - All transactions
- **categories** - Master category list
- **categorization_rules** - Your rules from Excel
- **user_corrections** - Learning data

### Key Fields
Transactions table:
- `date`, `amount`, `description_raw`, `description_clean`
- `action` (Income/Expense/Transfer)
- `category_auto` (auto-assigned), `category_manual` (user corrected)
- `category_confidence` (0-1 score)
- `needs_review` (boolean flag)

## Migration from Excel

### One-Time Import
If you have historical data in Excel:

```python
import pandas as pd
from database import SessionLocal, Transaction, Account
from categorization import CategorizationEngine

# Read your Excel database sheet
df = pd.read_excel('i_e_v9_2_2026.xlsx', sheet_name='Final_WithSplits')

# Map to database format and import
session = SessionLocal()
categorizer = CategorizationEngine(session)

for idx, row in df.iterrows():
    # Create transaction...
    # See import script for full details
```

### Ongoing Sync
Going forward:
- Plaid auto-fetches transactions daily
- No more manual CSV downloads
- Still export to Excel anytime for analysis

## Troubleshooting

### "Cannot connect to Plaid"
- Check your PLAID_CLIENT_ID and PLAID_SECRET in .env
- Verify environment (sandbox vs production)
- Check Plaid dashboard for API status

### "No transactions appear"
- Make sure you've clicked "Sync Transactions"
- Check account is active in database
- Verify access token is valid

### "Database locked"
- Close any other connections to finance.db
- SQLite only allows one writer at a time
- Restart the backend

### "Low categorization accuracy"
- Import your rules: POST /api/init/import-rules
- Review and correct more transactions (system learns)
- Check rules priority order

## Advanced Configuration

### Custom Categories
Add categories via database or API:
```python
from database import SessionLocal, Category

session = SessionLocal()
category = Category(
    name="My Custom Category",
    category_type="expense",
    display_order=100
)
session.add(category)
session.commit()
```

### Custom Rules
Add rules for specific merchants:
```python
from database import SessionLocal, CategorizationRule

session = SessionLocal()
rule = CategorizationRule(
    priority=50,
    match_type="contains",
    pattern="MY MERCHANT",
    set_category="My Category",
    is_active=True
)
session.add(rule)
session.commit()
```

### Backup & Export
```bash
# Backup database
cp finance.db finance_backup_$(date +%Y%m%d).db

# Export all data
curl http://localhost:8000/api/export/csv > transactions_$(date +%Y%m%d).csv
```

## Production Deployment

### Option 1: Local Desktop App (Recommended for you)
- Run on your computer
- Access via localhost:8000
- Database stored locally
- Most secure option

### Option 2: Cloud Deployment
If you want access from anywhere:

1. Deploy to Render.com (free tier):
   - Connect GitHub repo
   - Auto-deploys on push
   - Free PostgreSQL database

2. Deploy to Railway.app:
   - Similar to Render
   - Good free tier

3. Self-hosted VPS:
   - Full control
   - Requires server management

## Security Notes

### Current Setup (Local)
- ✅ Database on your machine
- ✅ API only accessible locally
- ✅ Plaid uses OAuth tokens (secure)
- ⚠️ No authentication (local only)

### For Cloud Deployment
Add authentication:
- User accounts and login
- API key authentication
- HTTPS/SSL certificates
- Encrypt access tokens

## Next Steps

1. ✅ Connect your first bank account
2. ✅ Let system categorize transactions
3. ✅ Review and correct flagged transactions
4. ✅ Export to verify accuracy
5. ✅ Set up daily sync (cron job or scheduled task)

## Support & Questions

- Check API docs: http://localhost:8000/docs
- Database issues: Check SQLite browser
- Plaid issues: Check dashboard.plaid.com
- Rules issues: Review Rules sheet mapping

## File Structure
```
finance-automation/
├── database.py              # Database schema
├── categorization.py        # Categorization engine
├── plaid_integration.py     # Plaid API wrapper
├── main.py                  # FastAPI backend
├── frontend.html            # React UI
├── requirements.txt         # Python dependencies
├── .env                     # Environment config
├── README.md               # This file
└── finance.db              # SQLite database (created on first run)
```

## License
Personal use only.
