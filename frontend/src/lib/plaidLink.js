/* Plaid Link helpers shared by + Connect Bank (hooks/index.jsx) and the
   Reconnect / + Add Account buttons (components/BankRow.jsx).

   OAuth banks (Bank of America, Chase, Amex...) can send the user away and back
   to /plaid/oauth-return. Plaid requires Link to be reopened there with the SAME
   link token, so the token, and whether it was a new connection or a reconnect,
   is saved before Link opens. */

const KEY = 'plaidLinkPending';
const MAX_AGE_MS = 4 * 3600 * 1000; // link tokens last 4 hours

export function saveLinkState(state) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, at: Date.now() })); } catch { /* storage off */ }
}

export function takeLinkState() {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return Date.now() - (s.at || 0) < MAX_AGE_MS ? s : null;
  } catch { return null; }
}

export function clearLinkState() {
  try { localStorage.removeItem(KEY); } catch { /* storage off */ }
}

/* One line for the reply of POST /plaid/update-complete/{item_id}. */
export function reconnectMessage(name, r) {
  const accts = (r && r.accounts) || [];
  const kept = accts.filter(a => a.status === 'matched' || a.status === 'relinked').length;
  const added = accts.filter(a => a.status === 'created').map(a => a.name);
  let msg = `✓ ${name}: ${kept} account${kept !== 1 ? 's' : ''} kept their history`;
  if (added.length) msg += ` · new: ${added.join(', ')}`;
  return msg + ' — syncing…';
}

/* What to say when Link closes with an error (null when the user just closed it).
   mode is 'update' for Reconnect / + Add Account, 'new' for + Connect Bank. */
export function linkErrorMessage(name, err, mode = 'update') {
  if (!err || !err.error_code) return null;
  const detail = err.display_message || err.error_message || err.error_code;
  if (mode === 'new') return `Bank not connected: ${detail}`;
  if (err.error_code === 'INSTITUTION_NO_LONGER_SUPPORTED') {
    return `Plaid can no longer refresh this ${name} connection. Connect the bank again with + Connect Bank: `
      + `its accounts keep their history and the new connection replaces this one.`;
  }
  return `${name}: ${detail}`;
}
