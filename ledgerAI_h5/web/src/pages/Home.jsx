import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { compressImage, currentMonth, money, monthLabel } from '../utils.js';
import InsightsCard from '../components/InsightsCard.jsx';
import ReceiptRow from '../components/ReceiptRow.jsx';
import ReviewModal from '../components/ReviewModal.jsx';
import { CameraIcon, PhotoIcon } from '../components/Icons.jsx';

export default function Home({ user, version, onChanged }) {
  const month = currentMonth();
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [session, setSession] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([api.monthly(month), api.listReceipts({ limit: 10 })]);
      setSummary(m);
      setRecent(r.receipts);
    } catch (e) {
      setError(e.message);
    }
  }, [month]);

  // The server caches the digest (invalidated on any receipt change) and throttles manual refreshes
  const loadInsights = useCallback(async (force = false) => {
    try {
      const r = await api.refreshInsights(force);
      setInsights(r.insights);
    } catch {
      setInsights(null);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, version]);
  useEffect(() => { loadInsights(); }, [loadInsights, version]);

  const refreshInsights = async () => {
    setRefreshing(true);
    await loadInsights(true);
    setRefreshing(false);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setScanning(true);
    try {
      const { blob, name } = await compressImage(file);
      const r = await api.parseReceipt(blob, name);
      setSession({ imageUrl: r.image_url, imageKey: r.image_key, imageHash: r.image_hash, duplicateOf: r.duplicate_of, draft: r.draft });
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const openReceipt = async (id) => {
    try {
      const { receipt } = await api.getReceipt(id);
      setSession({ receiptId: id, imageUrl: receipt.image_url, draft: receipt });
    } catch (err) {
      setError(err.message);
    }
  };

  const saveBudget = async (e) => {
    e.preventDefault();
    const amount = Number(budgetInput);
    if (!Number.isFinite(amount) || amount < 0) return;
    await api.setBudget(month, amount);
    setEditingBudget(false);
    onChanged();
  };

  const currency = summary?.currency ?? user.currency;
  const pct = summary?.budget ? Math.min(100, Math.round((summary.total / summary.budget) * 100)) : 0;
  const over = summary?.budget && summary.total > summary.budget;

  return (
    <div className="space-y-6 px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}>
      <header className="px-1">
        <p className="text-[13px] font-medium uppercase text-ios-secondary">{monthLabel(month)}</p>
        <h1 className="text-[40px] font-bold leading-tight tracking-tight tabular-nums">{money(summary?.total ?? 0, currency)}</h1>
        {summary?.change_pct != null && (
          <p className={`text-[15px] ${summary.change_pct > 0 ? 'text-ios-red' : 'text-ios-green'}`}>
            {summary.change_pct > 0 ? '↑' : '↓'} {Math.abs(summary.change_pct)}% vs last month
          </p>
        )}
      </header>

      <div className="space-y-2.5">
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={scanning}
          className="ios-btn flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-ios-blue text-[17px] font-semibold text-white disabled:opacity-60"
        >
          <CameraIcon width={22} height={22} />
          {scanning ? 'Reading receipt…' : 'Snap Receipt'}
        </button>
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={scanning}
          className="ios-btn flex h-[44px] w-full items-center justify-center gap-2 rounded-[14px] bg-ios-blue/10 text-[17px] font-medium text-ios-blue disabled:opacity-60"
        >
          <PhotoIcon width={20} height={20} /> Choose from Library
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
        {error && <p className="rounded-[10px] bg-ios-red/10 px-4 py-3 text-[15px] text-ios-red">{error}</p>}
      </div>

      <section>
        <p className="ios-header">Budget</p>
        <div className="ios-group">
          {editingBudget ? (
            <form onSubmit={saveBudget} className="flex items-center gap-3 px-4 py-2.5">
              <input autoFocus type="number" min="0" step="1" inputMode="decimal" placeholder="Monthly budget" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} className="ios-input flex-1" />
              <button className="ios-btn font-semibold text-ios-blue">Done</button>
              <button type="button" onClick={() => setEditingBudget(false)} className="ios-btn text-ios-blue">Cancel</button>
            </form>
          ) : summary?.budget ? (
            <button onClick={() => { setBudgetInput(String(summary.budget)); setEditingBudget(true); }} className="ios-press block w-full px-4 py-3 text-left">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[17px]">{money(summary.budget, currency)}</span>
                <span className={`text-[15px] ${over ? 'text-ios-red' : 'text-ios-secondary'}`}>
                  {over ? `${money(summary.total - summary.budget, currency)} over` : `${money(summary.budget - summary.total, currency)} left`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ios-fill">
                <div className={`h-full rounded-full ${over ? 'bg-ios-red' : pct > 80 ? 'bg-ios-orange' : 'bg-ios-green'}`} style={{ width: `${pct}%` }} />
              </div>
            </button>
          ) : (
            <button onClick={() => { setBudgetInput(''); setEditingBudget(true); }} className="ios-press w-full px-4 py-3 text-left text-[17px] text-ios-blue">
              Set Monthly Budget
            </button>
          )}
        </div>
      </section>

      <InsightsCard insights={insights} loading={insightsLoading} onRefresh={refreshInsights} refreshing={refreshing} />

      <section>
        <p className="ios-header">Recent</p>
        {recent.length === 0 ? (
          <p className="ios-card px-4 py-6 text-center text-[15px] text-ios-secondary">No receipts yet. Tap “Snap Receipt” to start.</p>
        ) : (
          <div className="ios-group">
            {recent.map((r) => <ReceiptRow key={r.receipt_id} receipt={r} onClick={() => openReceipt(r.receipt_id)} />)}
          </div>
        )}
      </section>

      {session && (
        <ReviewModal
          session={session}
          onClose={() => setSession(null)}
          onSaved={() => { setSession(null); onChanged(); }}
        />
      )}
    </div>
  );
}
