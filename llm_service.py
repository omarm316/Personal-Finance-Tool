"""
LLM-powered merchant enrichment service using Anthropic Claude API.

Flow:
1. Check merchant_overrides table first (user-confirmed mappings, no API call needed)
2. If no override, call Claude Haiku to clean description + assign category
3. Write results back to transaction
4. When user overrides a category → save to merchant_overrides for future use
"""

import os
import json
import re
import logging
from typing import Optional
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

logger = logging.getLogger(__name__)

# ── Anthropic API config ──────────────────────────────────────────────────────
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-haiku-4-5"   # Fast, cheap, great at structured output
ANTHROPIC_VERSION = "2023-06-01"

# ── Valid categories (canonical — must match database.py seed_categories) ─────
# This is the single source of truth for category names used in LLM validation.
# If you add/remove a category from the DB, update this list to match.
VALID_CATEGORIES = [
    # Expense
    "Groceries", "Dining", "Transportation", "Housing", "Utilities",
    "Healthcare", "Insurance", "Vehicle", "Fitness", "Self Care",
    "Clothing", "Electronics", "Streaming", "Travel", "Home",
    "Kids", "Entertainment", "Gifts", "For Others", "Education",
    "Fees & Interest", "Other",
    # Both (expense or income depending on sign)
    "Business", "Investment Gain (Loss)",
    # Income
    "Work",
    # System / special
    "Transfer", "Unclassified",
]

# Remap deprecated or alternate category names → canonical names.
# Applied to LLM output AND override-table lookups so old data stays valid.
_CATEGORY_REMAP: dict[str, str] = {
    "Fees and Interest": "Fees & Interest",
    "Phone":             "Utilities",
    "Internet":          "Utilities",
    "Water":             "Utilities",
    "Electricity":       "Utilities",
    "Books":             "Entertainment",
    "Leisure":           "Entertainment",
    "Events":            "Entertainment",
    "Lottery":           "Entertainment",
    "Music Lessons":     "Education",
    "Tutoring":          "Education",
    "Studies":           "Education",
    "Parents":           "For Others",
    "Siblings":          "For Others",
    "Consulting":        "Business",
    "Dry Cleaning":      "Self Care",
    "Investments":       "Investment Gain (Loss)",
    "Investment Income": "Investment Gain (Loss)",
    "Interest Income":   "Investment Gain (Loss)",
    "Rent":              "Housing",
    "Mortgage":          "Housing",
    "Paycheck":          "Work",
    "Income":            "Work",
}

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = f"""You are an expert at decoding raw bank transaction strings into clean merchant names and categories.

STEP 1 — IDENTIFY THE MERCHANT
Raw bank descriptions are garbled: uppercase, full of codes, store numbers, terminal IDs, dates, and noise.
Your first job is to identify the real-world business behind the string. Use your knowledge of:
- Domain names: "SAMSCLUB.COM" → "Sam's Club", "WHOLEFDS" → "Whole Foods", "AMZN" → "Amazon"
- Common prefixes: "SQ *" → Square (small business POS), "TST*" → Toast (restaurant POS), "PP*" → PayPal
- Abbreviations: "WHOLEFDS" → "Whole Foods", "TGT" → "Target", "WMT" → "Walmart", "CSTCO" → "Costco"
- Suffixes to strip: store numbers (#1234), state codes (CA, NY), terminal IDs, dates, PPD ID, ACH codes
- Financial institutions: "UNFCU" → "UN Federal Credit Union", "BOFA" → "Bank of America"
- If it's a transfer/payment between accounts (AUTOPAY, ACH, ZELLE, WIRE, XFER), the merchant is the counterparty institution

STEP 2 — WRITE A CLEAN DESCRIPTION
A short, human-readable label a person would write in their own budget spreadsheet.
Examples: "Sam's Club Groceries", "Netflix Subscription", "Verizon Bill", "Zelle Transfer"

STEP 3 — ASSIGN A CATEGORY
Pick the single best category from this list (spelling must match exactly):
{json.dumps(VALID_CATEGORIES, indent=2)}

OUTPUT RULES:
- merchant_name: proper-case real business name, no codes/numbers/locations (max 50 chars)
- description_clean: short human label (max 80 chars)
- category: exactly one from the list above
- Transfers/payments between accounts → category "Transfer"
- Truly unidentifiable → category "Unclassified" (last resort)

Respond with valid JSON only, no explanation, no markdown:
{{"merchant_name": "Sam's Club", "description_clean": "Sam's Club Groceries", "category": "Groceries"}}"""


def _call_llm(description_raw: str, api_key: str) -> Optional[dict]:
    """
    Call Claude API and return parsed JSON result.
    Returns None on any failure (network, API error, bad JSON).
    Uses only stdlib urllib — no extra dependencies.
    """
    # System prompt is identical for every transaction — mark it for caching.
    # Anthropic caches the prompt for 5 minutes; cache hits are ~85% faster and
    # ~90% cheaper on input tokens. Batches of 10+ calls see meaningful savings.
    payload = json.dumps({
        "model": ANTHROPIC_MODEL,
        "max_tokens": 200,
        "system": [
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [
            {"role": "user", "content": f"Decode this raw bank transaction string: {description_raw}"}
        ],
    }).encode("utf-8")

    req = Request(
        ANTHROPIC_API_URL,
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-beta": "prompt-caching-2024-07-31",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            content = body["content"][0]["text"]
            # Strip any accidental markdown fences
            content = re.sub(r"^```[a-z]*\n?", "", content.strip())
            content = re.sub(r"\n?```$", "", content.strip())
            result = json.loads(content)
            return result
    except HTTPError as e:
        logger.error(f"Claude API HTTP error {e.code}: {e.read().decode()}")
        return None
    except (URLError, json.JSONDecodeError, KeyError) as e:
        logger.error(f"Claude API error: {e}")
        return None


# Keep old name as alias so existing call sites in main.py don't break
_call_groq = _call_llm


def _normalize_merchant_key(raw_description: str) -> str:
    """
    Create a normalized lookup key from a raw description for override matching.
    Strips noise so "STARBUCKS #1234" and "STARBUCKS #9999" both map to "STARBUCKS".
    """
    key = raw_description.upper().strip()
    key = re.sub(r'\s*#\d+', '', key)           # #1234
    key = re.sub(r'\s+\d{4,}', '', key)         # long numbers
    key = re.sub(r'\s+PPD ID.*', '', key)        # PPD ID: ...
    key = re.sub(r'\s+[A-Z]{2}\s*$', '', key)   # State abbreviations at end
    key = re.sub(r'\s+', ' ', key).strip()
    return key[:100]


def enrich_transaction(
    transaction_id: int,
    description_raw: str,
    db_session,
    api_key: Optional[str] = None,
) -> dict:
    """
    Enrich a single transaction with merchant name, clean description, and category.

    Priority:
    1. merchant_overrides table (user-confirmed, instant, no API call)
    2. Claude Haiku API call

    Returns dict with keys: merchant_name, description_clean, category, source
    source is one of: 'override', 'llm', 'fallback'
    """
    from database import MerchantOverride

    if api_key is None:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")

    lookup_key = _normalize_merchant_key(description_raw)

    # ── Step 1: Check override table ─────────────────────────────────────────
    override = db_session.query(MerchantOverride).filter_by(
        merchant_key=lookup_key
    ).first()

    if override:
        logger.info(f"Override hit for '{lookup_key}': {override.merchant_name} → {override.category}")
        canonical_cat = _CATEGORY_REMAP.get(override.category, override.category)
        return {
            "merchant_name": override.merchant_name,
            "description_clean": override.description_clean or override.merchant_name,
            "category": canonical_cat,
            "source": "override",
        }

    # ── Step 2: Call Claude ───────────────────────────────────────────────────
    if not api_key:
        logger.warning("No ANTHROPIC_API_KEY set — returning fallback")
        return _fallback(description_raw)

    result = _call_llm(description_raw, api_key)

    if result:
        merchant_name     = str(result.get("merchant_name") or "").strip()[:200]
        description_clean = str(result.get("description_clean") or "").strip()[:500]
        category          = str(result.get("category") or "").strip()

        category = _CATEGORY_REMAP.get(category, category)
        if category not in VALID_CATEGORIES:
            category = "Unclassified"
        if not merchant_name:
            merchant_name = description_raw[:200]
        if not description_clean:
            description_clean = merchant_name

        return {
            "merchant_name":     merchant_name,
            "description_clean": description_clean,
            "category":          category,
            "source":            "llm",
        }

    return _fallback(description_raw)


def _fallback(description_raw: str) -> dict:
    """Return a safe fallback when LLM is unavailable."""
    return {
        "merchant_name":     description_raw[:200],
        "description_clean": description_raw[:500],
        "category":          "Unclassified",
        "source":            "fallback",
    }


def save_override(
    description_raw: str,
    merchant_name: str,
    description_clean: str,
    category: str,
    db_session,
) -> None:
    """
    Save a user-confirmed merchant → category mapping to the overrides table.
    Called when a user manually corrects a category so future transactions
    from the same merchant are resolved instantly without an LLM call.
    """
    from database import MerchantOverride

    lookup_key = _normalize_merchant_key(description_raw)

    existing = db_session.query(MerchantOverride).filter_by(
        merchant_key=lookup_key
    ).first()

    if existing:
        existing.merchant_name     = merchant_name
        existing.description_clean = description_clean
        existing.category          = category
        from datetime import datetime
        existing.updated_at = datetime.utcnow()
        logger.info(f"Updated override for '{lookup_key}': {category}")
    else:
        override = MerchantOverride(
            merchant_key      = lookup_key,
            merchant_name     = merchant_name,
            description_clean = description_clean,
            category          = category,
        )
        db_session.add(override)
        logger.info(f"Created override for '{lookup_key}': {category}")

    db_session.commit()
