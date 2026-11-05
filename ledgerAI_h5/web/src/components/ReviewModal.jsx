import { useState } from 'react';
import { api } from '../api.js';
import { CATEGORIES, todayISO } from '../utils.js';
import { MinusCircle, PlusCircle } from './Icons.jsx';

const toForm = (r = {}) => ({
  merchant_name: r.merchant_name ?? '',
  transaction_date: r.transaction_date ?? todayISO(),
  currency: r.currency ?? 'GBP',
  total_amount: r.total_amount != null ? String(r.total_amount) : '',
  tax_amount: r.tax_amount != null ? String(r.tax_amount) : '',
  category: r.category ?? 'Other',
  line_items: (r.line_items ?? []).map((i) => ({
    description: i.description,
    quantity: String(i.quantity ?? 1),
    price: String(i.price ?? 0),
  })),
});

const num = (s) => (s === '' || s === null ? null : Number(s));

const Row = ({ label, children }) => (
  <label className="flex items-center gap-3 px-4 py-[11px]">
    <span className="w-24 shrink-0 text-[17px]">{label}</span>
    {children}
  </label>
);
const right = 'ios-input text-right text-ios-secondary focus:text-black';

/**
 * Bottom-sheet review for a freshly scanned receipt (new) or an existing one (edit).
 * `session` = { receiptId?, imageUrl, imageKey, imageHash, duplicateOf, draft }
 */
export default function ReviewModal({ session, onClose, onSaved }) {
  const editing = Boolean(session.receiptId);
  const [form, setForm] = useState(() => toForm(session.draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setItem = (idx, patch) => set({ line_items: form.line_items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });

  const close = () => {
    if (!editing && session.imageKey) api.discardImage(session.imageKey);
    onClose();
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const total = num(form.total_amount);
    if (total === null || Number.isNaN(total) || total < 0) return setError('Total must be 0 or more.');
    const payload = {
      merchant_name: form.merchant_name,
      transaction_date: form.transaction_date,
      currency: form.currency,
      total_amount: total,
      tax_amount: num(form.tax_amount),
      category: form.category,
      line_items: form.line_items
        .filter((i) => i.description.trim())
        .map((i) => ({
          description: i.description,
          quantity: Number(i.quantity) || 1,
          price: Number(i.price) || 0,
        })),
      ...(editing ? {} : { image_key: session.imageKey, image_hash: session.imageHash }),
    };
    setBusy(true);
    try {
      if (editing) await api.updateReceipt(session.receiptId, payload);
      else await api.saveReceipt(payload);
      onSaved();
    } catch (err) {
      setError(err.details?.[0] ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this receipt?')) return;
    setBusy(true);
    try {
      await api.deleteReceipt(session.receiptId);
      onSaved();
    } catch (err) {
      setError(err.details?.[0] ?? err.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div className="backdrop absolute inset-0 bg-black/40" onClick={close} />
      <div
        className="sheet relative flex w-full max-w-md flex-col overflow-hidden rounded-t-[14px] bg-ios-bg"
        style={{ height: 'calc(100% - var(--safe-top) - 12px)' }}
        role="dialog"
        aria-label={editing ? 'Edit receipt' : 'Review receipt'}
      >
        <header className="ios-bar relative flex h-[52px] shrink-0 items-center justify-between border-b-[0.5px] border-black/20 px-4">
          <span className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-black/15" />
          <button type="button" onClick={close} className="ios-btn mt-2 text-[17px] text-ios-blue">Cancel</button>
          <h2 className="mt-2 text-[17px] font-semibold">{editing ? 'Edit Receipt' : 'Review'}</h2>
          <button form="receipt-form" disabled={busy} className="ios-btn mt-2 text-[17px] font-semibold text-ios-blue disabled:opacity-40">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </header>

        <form id="receipt-form" onSubmit={save} className="flex-1 space-y-6 overflow-y-auto px-4 pb-10 pt-4">
          {session.imageUrl && (
            <a href={session.imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[10px] bg-black/5">
              <img src={session.imageUrl} alt="Receipt" className="max-h-56 w-full object-contain" />
            </a>
          )}
          {session.duplicateOf && (
            <p className="rounded-[10px] bg-ios-orange/15 px-4 py-3 text-[15px] text-[#b36b00]">This image looks identical to a receipt you already saved.</p>
          )}

          <div>
            {!editing && <p className="ios-header">Pre-filled by AI · please double-check</p>}
            <div className="ios-group">
              <Row label="Merchant">
                <input required maxLength={255} value={form.merchant_name} onChange={(e) => set({ merchant_name: e.target.value })} className={right} />
              </Row>
              <Row label="Date">
                <input required type="date" value={form.transaction_date} onChange={(e) => set({ transaction_date: e.target.value })} className={`${right} !w-auto flex-1`} />
              </Row>
              <Row label="Category">
                <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={`${right} appearance-none [text-align-last:right]`}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Row>
            </div>
          </div>

          <div className="ios-group">
            <Row label="Total">
              <input required type="number" inputMode="decimal" step="0.01" min="0" value={form.total_amount} onChange={(e) => set({ total_amount: e.target.value })} className={`${right} !text-black font-semibold`} />
            </Row>
            <Row label="Tax">
              <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="Optional" value={form.tax_amount} onChange={(e) => set({ tax_amount: e.target.value })} className={right} />
            </Row>
            <Row label="Currency">
              <input required maxLength={10} value={form.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} className={right} />
            </Row>
          </div>

          <div>
            <p className="ios-header">Items</p>
            <div className="ios-group">
              {form.line_items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2.5 px-4 py-2.5">
                  <button type="button" aria-label="Remove item" onClick={() => set({ line_items: form.line_items.filter((_, i) => i !== idx) })} className="ios-btn shrink-0">
                    <MinusCircle width={22} height={22} />
                  </button>
                  <input placeholder="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} className="ios-input flex-1 text-[17px]" />
                  <input aria-label="Quantity" type="number" min="0" step="any" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} className="ios-input !w-9 text-center text-[15px] text-ios-secondary" />
                  <input aria-label="Price" type="number" step="0.01" value={it.price} onChange={(e) => setItem(idx, { price: e.target.value })} className="ios-input !w-[4.5rem] text-right text-[17px]" />
                </div>
              ))}
              <button type="button" onClick={() => set({ line_items: [...form.line_items, { description: '', quantity: '1', price: '0' }] })} className="ios-press flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[17px]">
                <PlusCircle width={22} height={22} /> add item
              </button>
            </div>
          </div>

          {error && <p className="px-4 text-[15px] text-ios-red">{error}</p>}

          {editing && (
            <div className="ios-group">
              <button type="button" disabled={busy} onClick={remove} className="ios-press w-full py-3 text-center text-[17px] text-ios-red">Delete Receipt</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
