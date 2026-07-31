import {fmt,fmtDate} from '../lib/format';

export function BalanceCellModal({ cell, onClose }) {
  return (
    <div className="review-overlay">
      <div className="review-panel" style={{ maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>{cell.acct_name}</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDate(cell.date)}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: 4, minHeight: 0 }}>✕</button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Balance Before</span>
            <span style={{ fontWeight: 600 }}>{fmt(cell.raw_balance)}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cell.entries.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 12, borderLeft: `3px solid ${e.amount >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.description}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{e.source.replace(/_/g, ' ')}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: e.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {e.amount >= 0 ? '+' : '-'}{fmt(Math.abs(e.amount))}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, borderTop: '2px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
            <span style={{ fontWeight: 600 }}>Projected Balance</span>
            <span style={{ fontWeight: 700, color: cell.projected_balance >= 0 ? 'var(--blue-primary)' : 'var(--red)' }}>{fmt(cell.projected_balance)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
