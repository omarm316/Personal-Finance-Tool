# Finance Automation - Quick Start Guide

## What This System Does

Automates your 18-20k annual transactions:
1. **Auto-fetches** from banks via Plaid (no more manual CSV downloads)
2. **Auto-categorizes** using your Excel rules (38 categories)
3. **Learns** from your corrections to improve over time
4. **Clean UI** to review and adjust (~15-20% need review)
5. **Exports** to CSV/Excel anytime

## 5-Minute Setup

### 1. Get Plaid Credentials (Free)
```bash
# Go to: https://dashboard.plaid.com/signup
# Sign up for free Sandbox account
# Copy your Client ID and Secret
```

### 2. Configure
```bash
cd /home/claude/finance-automation
cp .env.example .env
# Edit .env - paste your Plaid credentials
```

### 3. Setup
```bash
./setup.sh
```

### 4. Start
```bash
# Terminal 1: Start backend
python3 main.py

# Terminal 2: Open frontend
open frontend.html  # or your browser
```

### 5. Connect Banks
1. Click "Connect Bank" in UI
2. Select your bank in Plaid Link
3. Use test credentials (Sandbox mode)
4. System fetches transactions automatically

## Test Credentials (Sandbox)

For testing in Sandbox mode, use:
- **Username**: `user_good`
- **Password**: `pass_good`

This connects to fake bank accounts with sample transactions.

## What Happens Next?

1. **First Sync**: System fetches last 2 years of transactions
2. **Auto-Categorization**: Uses your 38 categories + rules
3. **Review Queue**: Low-confidence transactions flagged
4. **You Review**: Click "Review" → Adjust if needed → Save
5. **System Learns**: Gets better with each correction

## Daily Workflow

```
Click "Sync Transactions" 
   ↓
Review flagged items (typically 10-20%)
   ↓
Make corrections
   ↓
Done!
```

## Your Categories (38 Total)

**Main Expenses:**
- Groceries, Dining, Transportation, Housing
- Healthcare, Education, Entertainment, Clothing
- Electronics, Phone, Internet, Streaming
- Insurance, Fitness, Self Care, Vehicle, Travel

**Other:**
- Gifts, Books, Kids, Parents, Siblings
- Home, Water, Electricity, Fees and Interest
- And more...

**Income:**
- Work, Investment Income, Interest Income

## Key Features

### ✅ Rule-Based Categorization
Your Excel rules are imported automatically:
- "WHOLE FOODS" → Groceries
- "PRUDENTIAL" → Work (Income)
- "BEST BUY" → Electronics
- And ~100 more from your Excel Rules sheet

### ✅ Learning System
System learns from your corrections:
- You correct "STARBUCKS" → Dining (instead of Other)
- Next time "STARBUCKS" appears → Auto-categorized as Dining
- Confidence increases with each correction

### ✅ Transaction Splits
Support for splitting transactions across categories:
- Transaction: $500 Target purchase
- Split: $300 Groceries + $200 Clothing
- (This feature requires additional UI work)

### ✅ Export
Click "Export CSV" anytime:
- All transactions with final categories
- Compatible with your Excel workflow
- Use for tax reporting, budgeting, analysis

## Troubleshooting

**"Cannot connect to Plaid"**
→ Check PLAID_CLIENT_ID and PLAID_SECRET in .env

**"No transactions appear"**
→ Click "Sync Transactions" button
→ Check you've connected at least one account

**"Low accuracy"**
→ Import rules: `curl -X POST http://localhost:8000/api/init/import-rules`
→ Review and correct more transactions (system learns)

**"Port 8000 already in use"**
→ Stop other process: `lsof -i :8000`
→ Or change port in main.py

## Next Steps

1. **Import Your Historical Data** (optional)
   - See README.md for Excel import script
   - Or start fresh with Plaid

2. **Fine-Tune Rules**
   - Add merchants you use frequently
   - Adjust priorities
   - See Advanced Configuration in README.md

3. **Set Up Auto-Sync** (optional)
   - Cron job to sync daily
   - Never manually download CSVs again

4. **Production Mode**
   - Switch PLAID_ENV=production in .env
   - Connect real bank accounts
   - Apply for Production access at Plaid

## Support

- Full docs: README.md
- API docs: http://localhost:8000/docs
- Test system: `python3 test_system.py`

## Files

```
finance-automation/
├── main.py                 # Backend server
├── database.py             # Database schema
├── categorization.py       # Categorization engine
├── plaid_integration.py    # Plaid API
├── frontend.html           # Web UI
├── requirements.txt        # Python packages
├── .env                    # Your config
└── finance.db              # Database (auto-created)
```

## Architecture

```
Banks (Chase, etc.)
    ↓
Plaid API (secure OAuth)
    ↓
Your Backend (localhost:8000)
    ↓
SQLite Database (finance.db)
    ↓
React Frontend (browser)
```

All data stays on your computer. Plaid only has read-only access to transactions.

## Production Checklist

Before going to production:
- [ ] Get Plaid Production access
- [ ] Switch to PLAID_ENV=production
- [ ] Set up daily auto-sync
- [ ] Set up database backups
- [ ] Add authentication (if cloud-hosted)
- [ ] Use HTTPS (if cloud-hosted)

## That's It!

You're ready to automate your finances. Questions? Check README.md or API docs.

Happy automating! 🚀
