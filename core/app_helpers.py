"""
core/app_helpers.py — static-asset-serving helpers shared by main.py's own
routes (`/`, `/plaid/oauth-return`) and router modules that also serve the
frontend entry point (e.g. routers/misc.py's `/v2`, `/mockup`).

Extracted from main.py (Phase 1 of the backend token-usage refactor — see
PLAN.md "main.py -> domain routers split"). Not one of the originally-scoped
core/ modules — added because `_frontend_index()` is needed by both main.py
and a router, and (unlike Phase 0's helpers) it does its own `__file__`-based
path math, which breaks silently if copied as-is into a `routers/` module
one directory deeper than main.py. PROJECT_ROOT below is computed once here
instead, so every caller resolves paths the same way regardless of which
directory they live in.
"""
import os
import logging

logger = logging.getLogger('moresheth')

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _frontend_index() -> str:
    """
    Path to the HTML entry point.

    Prefers the Vite build output (static/app/index.html, produced by
    `cd frontend && npm run build` — the Dockerfile does this in a Node build
    stage). Falls back to the legacy single-file v2.html so a checkout with no
    build still runs, and logs loudly when it does, because silently serving
    the old bundle would hide a broken build in production.
    """
    built = os.path.join(PROJECT_ROOT, "static", "app", "index.html")
    if os.path.exists(built):
        return built
    logger.warning(
        "Vite build not found at static/app/index.html — falling back to the "
        "legacy v2.html. Run `cd frontend && npm run build`."
    )
    return os.path.join(PROJECT_ROOT, "v2.html")
