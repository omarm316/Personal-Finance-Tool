import {useState,useEffect,useCallback} from 'react';
import {apiFetch} from '../lib/api';
import {todayStr} from '../lib/format';

export function LiquidityForecastCard({ toast }) {
  const [forecast, setForecast] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAcct, setSelectedAcct] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', expected_date: todayStr() });

  useEffect(() => {
    (async () => {
      try {
        const accts = await apiFetch('/accounts');
        const cashAccts = accts.filter(a => ['Checking', 'Savings'].includes(a.account_type));
        setAccounts(cashAccts);
        if (cashAccts.length > 0) setSelectedAcct(cashAccts[0].id);
      } catch (e) {}
    })();
  }, []);

  const loadForecast = useCallback(async () => {
    if (!selectedAcct) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/forecast/${selectedAcct}?days=30`);
      setForecast(data);
    } catch (e) {
      toast('Failed to load forecast', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedAcct]);

  useEffect(() => { loadForecast(); }, [loadForecast]);

  const handleAddPurchase = async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/planned-purchases', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) })
      });
      toast('Planned purchase added');
      setForm({ name: '', amount: '', expected_date: todayStr() });
      setShowForm(false);
      loadForecast();
    } catch (e) {
      toast('Failed to add purchase', 'error');
    }
  };

  return (
    <div className="card" style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Liquidity Forecast</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Projected 30-day runway including scheduled flows</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={selectedAcct} onChange={e => setSelectedAcct(e.target.value)} className="filter-select">
            {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ Planned Spend</button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleAddPurchase} style={{ background: 'var(--elevated)', padding: 24, borderRadius: 20, marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 16, alignItems: 'end', border: '1px solid var(--border)' }}>
          <div className="review-field" style={{ marginBottom: 0 }}><label>Description</label><input className="search-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="review-field" style={{ marginBottom: 0 }}><label>Amount</label><input className="search-input" type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></div>
          <div className="review-field" style={{ marginBottom: 0 }}><label>Expected Date</label><input className="search-input" type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} required /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit">Add</button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>✕</button>
          </div>
        </form>
      )}

      {loading ? <div className="loading" style={{ padding: 40 }}><div className="spinner" /></div> : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, scrollbarWidth: 'none' }}>
          {forecast.map(d => (
            <div key={d.date} style={{ 
              minWidth: 100, padding: '16px 14px', borderRadius: 20, 
              background: d.shortfall ? 'rgba(239, 68, 68, 0.1)' : 'var(--surface)', 
              border: d.shortfall ? '1px solid var(--red)' : '1px solid var(--border)', 
              textAlign: 'center', flexShrink: 0,
              boxShadow: d.shortfall ? '0 0 15px rgba(239, 68, 68, 0.1)' : 'none'
            }}>
              <div style={{ fontSize: 11, color: d.shortfall ? 'var(--red)' : 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: d.shortfall ? 'var(--red)' : 'var(--text-primary)', marginTop: 8 }}>
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(d.balance)}
              </div>
              {d.shortfall && <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 6, fontWeight: 800, letterSpacing: '0.5px' }}>SHORTFALL</div>}
            </div>
          ))}
          {forecast.length === 0 && <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', width: '100%' }}>Select a cash account to generate projection</div>}
        </div>
      )}
    </div>
  );
}
