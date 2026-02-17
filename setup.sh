#!/bin/bash
# Automated setup script for Finance Automation System

echo "========================================="
echo "Finance Automation System - Setup"
echo "========================================="
echo ""

# Check Python version
echo "Checking Python version..."
python3 --version
echo ""

# Install dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt --break-system-packages
echo ""

# Initialize database
echo "Initializing database..."
python3 database.py
echo ""

# Import rules from Excel
echo "Importing categorization rules from Excel..."
python3 << 'EOF'
from database import init_db, seed_categories
from categorization import load_rules_from_excel

# Initialize database
engine, SessionLocal = init_db()
session = SessionLocal()

# Seed categories
seed_categories(session)
print("✓ Categories loaded")

# Import rules from Excel
try:
    load_rules_from_excel('/mnt/user-data/uploads/i_e_v9_2_2026.xlsx', session)
    print("✓ Rules imported successfully")
except Exception as e:
    print(f"⚠ Could not import rules: {e}")
    print("  You can import rules later via API: POST /api/init/import-rules")

session.close()
print("\n✓ Database initialization complete!")
EOF

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Configure Plaid credentials in .env file:"
echo "   cp .env.example .env"
echo "   # Edit .env with your Plaid API credentials"
echo ""
echo "2. Start the backend:"
echo "   python3 main.py"
echo ""
echo "3. Open frontend.html in your browser"
echo ""
echo "See README.md for detailed instructions."
