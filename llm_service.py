"""
LLM-powered merchant enrichment service using Anthropic Claude API.

Flow:
1. Call Claude Haiku to clean description + assign category
2. Write results back to transaction
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
    "Kids", "Entertainment", "Gifts", "Education",
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

# "For Others" was removed as a category (2026-09-05) in favor of the
# is_for_others tag (see Transaction.is_for_others) — money spent on behalf
# of family/others, excluded from budget but kept for cash flow. When the LLM
# still reaches for one of these old names, resolve the category to
# Unclassified (real category TBD) and surface the tag via enrich_transaction's
# "is_for_others" return key instead of remapping to a dead category name.
_FOR_OTHERS_CATEGORY_ALIASES = {"For Others", "Parents", "Siblings"}

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


def enrich_transaction(
    description_raw: str,
    api_key: Optional[str] = None,
) -> dict:
    """
    Enrich a single transaction with merchant name, clean description, and category
    via a Claude Haiku API call.

    Returns dict with keys: merchant_name, description_clean, category, source
    source is one of: 'llm', 'fallback'
    """
    if api_key is None:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")

    if not api_key:
        logger.warning("No ANTHROPIC_API_KEY set — returning fallback")
        return _fallback(description_raw)

    result = _call_llm(description_raw, api_key)

    if result:
        merchant_name     = str(result.get("merchant_name") or "").strip()[:200]
        description_clean = str(result.get("description_clean") or "").strip()[:500]
        category          = str(result.get("category") or "").strip()

        is_for_others = category in _FOR_OTHERS_CATEGORY_ALIASES
        category = _CATEGORY_REMAP.get(category, category)
        if is_for_others or category not in VALID_CATEGORIES:
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
            "is_for_others":     is_for_others,
        }

    return _fallback(description_raw)


def _fallback(description_raw: str) -> dict:
    """Return a safe fallback when LLM is unavailable."""
    return {
        "merchant_name":     description_raw[:200],
        "description_clean": description_raw[:500],
        "category":          "Unclassified",
        "source":            "fallback",
        "is_for_others":     False,
    }
