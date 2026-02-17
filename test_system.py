#!/usr/bin/env python3
"""
Test script to verify the finance automation system is working
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_database():
    """Test database initialization"""
    print("Testing database...")
    try:
        from database import init_db, seed_categories, Category
        
        engine, SessionLocal = init_db("sqlite:///./test_finance.db")
        session = SessionLocal()
        
        # Seed categories
        seed_categories(session)
        
        # Check categories were created
        categories = session.query(Category).all()
        assert len(categories) > 0, "No categories found"
        
        session.close()
        os.remove("test_finance.db")
        
        print("✓ Database test passed")
        return True
    except Exception as e:
        print(f"✗ Database test failed: {e}")
        return False


def test_categorization():
    """Test categorization engine"""
    print("\nTesting categorization engine...")
    try:
        from database import init_db, seed_categories, CategorizationRule
        from categorization import CategorizationEngine
        
        engine, SessionLocal = init_db("sqlite:///./test_finance.db")
        session = SessionLocal()
        seed_categories(session)
        
        # Add a test rule
        rule = CategorizationRule(
            priority=10,
            match_type="contains",
            pattern="WHOLE FOODS",
            set_category="Groceries",
            set_action="Expense",
            is_active=True
        )
        session.add(rule)
        session.commit()
        
        # Test categorization
        categorizer = CategorizationEngine(session)
        
        test_cases = [
            ("WHOLE FOODS MARKET #10", -87.32, "Expense", "Groceries"),
            ("PRUDENTIAL DIR DEP", 4344.05, "Income", "Work"),
            ("CHASE AUTOPAY PAYMENT", -1500.00, "Transfer", None),
        ]
        
        passed = 0
        for desc, amount, expected_action, expected_cat in test_cases:
            action, category, confidence = categorizer.categorize(desc, amount)
            
            if action == expected_action:
                if expected_cat is None or category == expected_cat:
                    passed += 1
                    print(f"  ✓ {desc[:30]:30} → {action:12} {category:15} ({confidence:.2f})")
                else:
                    print(f"  ✗ {desc[:30]:30} → Expected {expected_cat}, got {category}")
            else:
                print(f"  ✗ {desc[:30]:30} → Expected {expected_action}, got {action}")
        
        session.close()
        os.remove("test_finance.db")
        
        print(f"\n✓ Categorization test passed ({passed}/{len(test_cases)} cases)")
        return passed == len(test_cases)
        
    except Exception as e:
        print(f"✗ Categorization test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_api_imports():
    """Test that all API modules can be imported"""
    print("\nTesting API imports...")
    try:
        import database
        import categorization
        import plaid_integration
        import main
        
        print("✓ All modules imported successfully")
        return True
    except Exception as e:
        print(f"✗ Import test failed: {e}")
        return False


def main():
    """Run all tests"""
    print("="*60)
    print("Finance Automation System - Test Suite")
    print("="*60)
    print()
    
    results = []
    
    # Run tests
    results.append(("Database", test_database()))
    results.append(("Categorization", test_categorization()))
    results.append(("API Imports", test_api_imports()))
    
    # Summary
    print("\n" + "="*60)
    print("Test Summary")
    print("="*60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{name:20} {status}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✓ All tests passed! System is ready to use.")
        return 0
    else:
        print(f"\n✗ {total - passed} test(s) failed. Please check errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
