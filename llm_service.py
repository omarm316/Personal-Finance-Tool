"""
LLM-powered merchant enrichment service using Groq API (free tier).

Flow:
1. Check merchant_overrides table first (user-confirmed mappings, no API call needed)
2. If no override, call Groq LLM to clean description + assign category
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

# ── Groq API config ──────────────────────────────────────────────────────────
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"   # Free, fast, great at structured output

# ── Valid categories (must match your Category table) ───────────────────────
VALID_CATEGORIES = [
    "Groceries", "Dining", "Transportation", "Housing", "Healthcare",
    "Education", "Entertainment", "Clothing", "Electronics", "Phone",
    "Internet", "Streaming", "Insurance", "Fitness", "Self Care",
    "Vehicle", "Travel", "Gifts", "Books", "Kids", "Parents",
    "Siblings", "For Others", "Home", "Water", "Electricity",
    "Fees and Interest", "Consulting", "Studies", "Music Lessons",
    "Tutoring", "Events", "Lottery", "Dry Cleaning", "Investments",
    "Other", "Leisure", "Work", "Investment Income", "Interest Income",
    "Transfer", "Unclassified",
]

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = f"""You are a financial transaction classifier. Given a raw bank transaction description, you will:
1. Identify the merchant name (clean, human-readable, e.g. "Starbucks" not "STARBUCKS #1234 PPD ID:...")
2. Write a clean short description (e.g. "Starbucks Coffee" or "Netflix Subscription")
3. Assign the best category from the list below

Valid categories (pick EXACTLY one, spelling must match):
{json.dumps(VALID_CATEGORIES, indent=2)}

Rules:
- merchant_name: proper-case brand name only, no location/store numbers/IDs (max 50 chars)
- description_clean: short human-readable label (max 80 chars)
- category: must be one of the valid categories above, spelled exactly
- If it looks like a bank transfer/payment between accounts, use "Transfer"
- If you cannot determine the category, use "Unclassified"

Always respond with valid JSON only, no explanation, no markdown. Example:
{{"merchant_name": "Whole Foods", "description_clean": "Whole Foods Grocery", "category": "Groceries"}}"""


def _call_groq(description_raw: str, api_key: str) -> Optional[dict]:
    """
    Call Groq API and return parsed JSON result.
    Returns None on any failure (network, API error, bad JSON).
    Uses only stdlib urllib — no extra dependencies.
    """
    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Transaction description: {description_raw}"}
        ],
        "temperature": 0.1,      # Low temp = consistent, predictable output
        "max_tokens": 150,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = Request(
        GROQ_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            content = body["choices"][0]["message"]["content"]
            result = json.loads(content)
            return result
    except HTTPError as e:
        logger.error(f"Groq API HTTP error {e.code}: {e.read().decode()}")
        return None
    except (URLError, json.JSONDecodeError, KeyError) as e:
        logger.error(f"Groq API error: {e}")
        return None


def _normalize_merchant_key(raw_description: str) -> str:
    """
    Create a normalized lookup key from a raw description for override matching.
    Strips noise so "STARBUCKS #1234" and "STARBUCKS #9999" both map to "STARBUCKS".
    """
    # Uppercase, strip trailing numbers/IDs/locations
    key = raw_description.upper().strip()
    # Remove common suffixes: store numbers, PPD IDs, long digit strings
    key = re.sub(r'\s*#\d+', '', key)           # #1234
    key = re.sub(r'\s+\d{4,}', '', key)         # long numbers
    key = re.sub(r'\s+PPD ID.*', '', key)        # PPD ID: ...
    key = re.sub(r'\s+[A-Z]{2}\s*$', '', key)   # State abbreviations at end
    key = re.sub(r'\s+', ' ', key).strip()
    return key[:100]  # max 100 chars


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
    2. Groq LLM API call

    Returns dict with keys: merchant_name, description_clean, category, source
    source is one of: 'override', 'llm', 'fallback'
    """
    from database import MerchantOverride

    if api_key is None:
        api_key = os.getenv("GROQ_API_KEY", "")

    lookup_key = _normalize_merchant_key(description_raw)

    # ── Step 1: Check override table ─────────────────────────────────────────
    override = db_session.query(MerchantOverride).filter_by(
        merchant_key=lookup_key
    ).first()

    if override:
        logger.info(f"Override hit for '{lookup_key}': {override.merchant_name} → {override.category}")
        return {
            "merchant_name": override.merchant_name,
            "description_clean": override.description_clean or override.merchant_name,
            "category": override.category,
            "source": "override",
        }

    # ── Step 2: Call LLM ─────────────────────────────────────────────────────
    if not api_key:
        logger.warning("No GROQ_API_KEY set — returning fallback")
        return _fallback(description_raw)

    result = _call_groq(description_raw, api_key)

    if result:
        merchant_name = str(result.get("merchant_name") or "").strip()[:200]
        description_clean = str(result.get("description_clean") or "").strip()[:500]
        category = str(result.get("category") or "").strip()

        # Validate category is in our list
        if category not in VALID_CATEGORIES:
            category = "Unclassified"

        # Sanitize empty fields
        if not merchant_name:
            merchant_name = description_raw[:200]
        if not description_clean:
            description_clean = merchant_name

        return {
            "merchant_name": merchant_name,
            "description_clean": description_clean,
            "category": category,
            "source": "llm",
        }

    return _fallback(description_raw)


def _fallback(description_raw: str) -> dict:
    """Return a safe fallback when LLM is unavailable."""
    return {
        "merchant_name": description_raw[:200],
        "description_clean": description_raw[:500],
        "category": "Unclassified",
        "source": "fallback",
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
        existing.merchant_name = merchant_name
        existing.description_clean = description_clean
        existing.category = category
        from datetime import datetime
        existing.updated_at = datetime.utcnow()
        logger.info(f"Updated override for '{lookup_key}': {category}")
    else:
        override = MerchantOverride(
            merchant_key=lookup_key,
            merchant_name=merchant_name,
            description_clean=description_clean,
            category=category,
        )
        db_session.add(override)
        logger.info(f"Created override for '{lookup_key}': {category}")

    db_session.commit()
