"""
Plaid API integration for automatic transaction fetching
"""
import os
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.model.transactions_get_request_options import TransactionsGetRequestOptions
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.item_get_request import ItemGetRequest
from plaid.model.institutions_get_by_id_request import InstitutionsGetByIdRequest
import plaid
from plaid.api_client import ApiClient
from plaid.configuration import Configuration


class PlaidClient:
    """
    Wrapper for Plaid API to fetch transactions and manage accounts
    """
    
    def __init__(self, client_id: str, secret: str, environment: str = 'sandbox'):
        """
        Initialize Plaid client
        
        Args:
            client_id: Your Plaid client ID
            secret: Your Plaid secret
            environment: 'sandbox', 'development', or 'production'
        """
        self.client_id = client_id
        self.secret = secret
        
        # Configure Plaid environment
        if environment == 'sandbox':
            host = plaid.Environment.Sandbox
        elif environment == 'development':
            host = plaid.Environment.Development
        else:
            host = plaid.Environment.Production
        
        configuration = Configuration(
            host=host,
            api_key={
                'clientId': client_id,
                'secret': secret,
            }
        )
        
        api_client = ApiClient(configuration)
        self.client = plaid_api.PlaidApi(api_client)
    
    def create_link_token(self, user_id: str, redirect_uri: str = None) -> str:
        """
        Create a Link token for Plaid Link (used in frontend).

        Args:
            user_id: Unique user identifier
            redirect_uri: Required for OAuth institutions (Chase, Amex, etc.).
                          Must be a registered redirect URI in your Plaid dashboard.

        Returns: link_token to use in Plaid Link
        """
        kwargs = dict(
            user=LinkTokenCreateRequestUser(client_user_id=user_id),
            client_name="Finance Automation",
            products=[Products("transactions")],
            country_codes=[CountryCode('US')],
            language='en',
        )
        if redirect_uri:
            kwargs['redirect_uri'] = redirect_uri

        request = LinkTokenCreateRequest(**kwargs)
        response = self.client.link_token_create(request)
        return response['link_token']
    
    def get_institution_name(self, access_token: str) -> Optional[str]:
        """
        Look up the proper institution name (e.g. "Chase", "American Express")
        via /item/get → institution_id → /institutions/get_by_id.
        Returns None on any failure so callers can fall back gracefully.
        """
        return (self.get_institution_info(access_token) or {}).get('name')

    def get_institution_info(self, access_token: str) -> Optional[dict]:
        """
        Look up both the institution name AND Plaid's immutable institution_id
        (e.g. {'name': 'Chase', 'institution_id': 'ins_3'}).
        institution_id never changes even when users rename the connection,
        so it's the reliable key for account matching on re-link.
        Returns None on any failure.
        """
        try:
            item_resp = self.client.item_get(ItemGetRequest(access_token=access_token))
            institution_id = item_resp['item']['institution_id']
            if institution_id:
                inst_resp = self.client.institutions_get_by_id(
                    InstitutionsGetByIdRequest(
                        institution_id=institution_id,
                        country_codes=[CountryCode('US')],
                    )
                )
                return {
                    'name': inst_resp['institution']['name'],
                    'institution_id': institution_id,
                }
        except Exception:
            pass
        return None

    def exchange_public_token(self, public_token: str) -> Dict[str, str]:
        """
        Exchange a public token for an access token
        This happens after user completes Plaid Link
        
        Returns: {'access_token': '...', 'item_id': '...'}
        """
        request = ItemPublicTokenExchangeRequest(public_token=public_token)
        response = self.client.item_public_token_exchange(request)
        
        return {
            'access_token': response['access_token'],
            'item_id': response['item_id']
        }
    
    def get_accounts(self, access_token: str) -> List[Dict]:
        """
        Get all accounts for an item
        
        Returns: List of account dictionaries
        """
        request = AccountsGetRequest(access_token=access_token)
        response = self.client.accounts_get(request)
        
        accounts = []
        for account in response['accounts']:
            # Convert Plaid enum objects to plain strings to avoid serialization errors
            acct_type = account['type']
            acct_subtype = account.get('subtype')
            acct_type_str = str(acct_type.value) if hasattr(acct_type, 'value') else str(acct_type)
            acct_subtype_str = str(acct_subtype.value) if hasattr(acct_subtype, 'value') else str(acct_subtype) if acct_subtype else None

            accounts.append({
                'account_id': account['account_id'],
                'persistent_account_id': account.get('persistent_account_id'),  # Stable across re-links; None if institution doesn't support it
                'name': account['name'],
                'official_name': account.get('official_name'),
                'type': acct_type_str,
                'subtype': acct_subtype_str,
                'mask': account.get('mask'),
                'balance': account.get('balances', {}).get('current')
            })
        
        return accounts
    
    def sync_transactions(self, access_token: str, cursor: Optional[str] = None) -> Dict:
        """
        Sync transactions using Plaid's Transactions Sync API (recommended approach)
        
        Args:
            access_token: Access token for the item
            cursor: Cursor from previous sync (None for initial sync)
        
        Returns: {
            'added': [...],
            'modified': [...],
            'removed': [...],
            'next_cursor': '...',
            'has_more': bool
        }
        """
        added_transactions = []
        modified_transactions = []
        removed_transactions = []
        has_more = True
        
        while has_more:
            if cursor:
                request = TransactionsSyncRequest(access_token=access_token, cursor=cursor)
            else:
                request = TransactionsSyncRequest(access_token=access_token)
            
            response = self.client.transactions_sync(request)
            
            # Add this page of results
            added_transactions.extend(response['added'] or [])
            modified_transactions.extend(response['modified'] or [])
            removed_transactions.extend(response['removed'] or [])
            
            has_more = response['has_more']
            cursor = response['next_cursor']
        
        return {
            'added': [f for f in (self._safe_format(t) for t in added_transactions) if f is not None],
            'modified': [f for f in (self._safe_format(t) for t in modified_transactions) if f is not None],
            'removed': [t['transaction_id'] for t in removed_transactions],
            'next_cursor': cursor,
            'has_more': False
        }
    
    def get_transactions(self, access_token: str, start_date: datetime, end_date: datetime) -> List[Dict]:
        """
        Get transactions for a date range (legacy API, use sync_transactions instead)
        
        Args:
            access_token: Access token for the item
            start_date: Start date
            end_date: End date
        
        Returns: List of formatted transaction dictionaries
        """
        request = TransactionsGetRequest(
            access_token=access_token,
            start_date=start_date.date(),
            end_date=end_date.date(),
            options=TransactionsGetRequestOptions(count=500)
        )
        
        response = self.client.transactions_get(request)
        transactions = response['transactions']
        
        # Handle pagination
        total_transactions = response['total_transactions']
        while len(transactions) < total_transactions:
            request.options.offset = len(transactions)
            response = self.client.transactions_get(request)
            transactions.extend(response['transactions'])
        
        return [self._format_transaction(t) for t in transactions]
    
    @staticmethod
    def _plaid_get(obj, key, default=None):
        """Safe field access for Plaid SDK objects — they support [] but not .get()."""
        try:
            val = obj[key]
            return val if val is not None else default
        except (KeyError, TypeError, AttributeError):
            return default

    def _safe_format(self, transaction) -> Optional[Dict]:
        """
        Wrap _format_transaction so one bad record doesn't crash the entire batch.
        Returns None (and logs) if the transaction cannot be parsed.
        """
        try:
            return self._format_transaction(transaction)
        except Exception as e:
            tid = '?'
            try:
                tid = transaction['transaction_id']
            except Exception:
                pass
            print(f"[plaid] skipping malformed transaction {tid}: {e}")
            return None

    def _format_transaction(self, transaction: Dict) -> Dict:
        """
        Format a Plaid transaction into our standard format.
        Handles both date and datetime objects returned by the Plaid SDK —
        str(datetime(...)) produces '2024-01-15 00:00:00' which breaks strptime('%Y-%m-%d').
        """
        date_raw = transaction['date']
        if hasattr(date_raw, 'year'):
            # Already a date or datetime object — construct datetime directly
            txn_date = datetime(date_raw.year, date_raw.month, date_raw.day)
        else:
            # String — strip any time/timezone portion (e.g. '2024-01-15 00:00:00' or '2024-01-15T00:00:00Z')
            date_str = str(date_raw).split(' ')[0].split('T')[0]
            txn_date = datetime.strptime(date_str, '%Y-%m-%d')

        pfc = transaction.get('personal_finance_category') or {}
        return {
            'plaid_transaction_id': transaction['transaction_id'],
            'plaid_account_id': transaction['account_id'],
            'date': txn_date,
            'amount': float(transaction['amount']),  # Keep Plaid's sign as-is; categorization engine handles interpretation
            'description_raw': transaction['name'] or '',
            'merchant_name': self._plaid_get(transaction, 'merchant_name'),
            'category': self._plaid_get(transaction, 'category', []),
            'pending': self._plaid_get(transaction, 'pending', False),
            'payment_channel': self._plaid_get(transaction, 'payment_channel'),
            # Plaid personal_finance_category (stable hierarchical taxonomy, more accurate than legacy category)
            'pfc_primary': pfc.get('primary'),       # e.g. 'FOOD_AND_DRINK'
            'pfc_detailed': pfc.get('detailed'),      # e.g. 'FOOD_AND_DRINK_COFFEE'
            'pfc_confidence': pfc.get('confidence_level'),  # 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW'
        }


def setup_plaid_from_env() -> PlaidClient:
    """
    Initialize Plaid client from environment variables
    
    Required env vars:
        PLAID_CLIENT_ID
        PLAID_SECRET
        PLAID_ENV (sandbox, development, or production)
    """
    client_id = os.getenv('PLAID_CLIENT_ID')
    secret = os.getenv('PLAID_SECRET')
    environment = os.getenv('PLAID_ENV', 'sandbox')
    
    if not client_id or not secret:
        raise ValueError("PLAID_CLIENT_ID and PLAID_SECRET must be set in environment")
    
    return PlaidClient(client_id, secret, environment)


# Example usage and testing
if __name__ == "__main__":
    import sys
    
    # This is example code to help you test Plaid integration
    print("Plaid Integration Module")
    print("="*80)
    print("\nTo use this module:")
    print("1. Get Plaid API credentials from https://dashboard.plaid.com/")
    print("2. Set environment variables:")
    print("   export PLAID_CLIENT_ID='your_client_id'")
    print("   export PLAID_SECRET='your_secret'")
    print("   export PLAID_ENV='sandbox'  # or 'development' or 'production'")
    print("\n3. Use in your app:")
    print("   from plaid_integration import setup_plaid_from_env")
    print("   plaid = setup_plaid_from_env()")
    print("   link_token = plaid.create_link_token('user_123')")
    
    # Try to initialize if credentials are available
    try:
        plaid = setup_plaid_from_env()
        print("\n✓ Plaid client initialized successfully!")
        print(f"  Environment: {os.getenv('PLAID_ENV', 'sandbox')}")
    except ValueError as e:
        print(f"\n✗ {e}")
        sys.exit(1)
