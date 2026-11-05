import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import ReceiptRow from '../components/ReceiptRow.jsx';
import ReviewModal from '../components/ReviewModal.jsx';
import { ChevronLeft, ChevronRight } from '../components/Icons.jsx';
import { CATEGORIES, CATEGORY_STYLE, MONTH_SHORT, currentMonth, dayLabel, downloadBlob, money, monthLabel, shiftMonth } from '../utils.js';

const VIEWS = [['daily', 'Daily'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];

function Stepper({ label, onPrev, onNext, nextDisabled }) {
  return (
    <div className="flex items-center justify-between">
      <button onClick={onPrev} className="ios-btn p-2 text-ios-blue" aria-label="Previous"><ChevronLeft width={20} height={20} /></button>
      <span className="text-[17px] font-semibold">{label}</span>
      <button onClick={onNext} disabled={nextDisabled} className="ios-btn p-2 text-ios-blue disabled:opacity-30" aria-label="Next"><ChevronRight width={20} height={20} /></button>
    </div>
  );
}

const Change = ({ pct }) =>
  pct == null ? <span className="text-[13px] text-ios-secondary">new</span> : (
    <span className={`text-[13px] font-medium ${pct > 0 ? 'text-ios-red' : pct < 0 ? 'text-ios-green' : 'text-ios-secondary'}`}>
      {pct > 0 ? '↑' : pct < 0 ? '↓' : '–'} {Math.abs(pct)}%
    </span>
  );

const Empty = ({ children }) => <p className="ios-card px-4 py-6 text-center text-[15px] text-ios-secondary">{children}</p>;

export default function Analytics({ version, onChanged }) {
  const [view, setView] = useState('monthly');
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(Number(currentMonth().slice(0, 4)));
  const [category, setCategory] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [recurring, setRecurring] = useState(null);
  const [recurringError, setRecurringError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    const req = view === 'daily' ? api.daily(month) : view === 'monthly' ? api.monthly(month) : api.yearly(String(year));
    req.then((d) => !cancelled && setData({ ...d, _view: view })).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [view, month, year, version]);

  useEffect(() => {
    let cancelled = false;
    setRecurring(null);
    setRecurringError('');
    api.recurring()
      .then(({ expenses }) => !cancelled && setRecurring(expenses))
      .catch((e) => !cancelled && setRecurringError(e.message));
    return () => { cancelled = true; };
  }, [version]);

  const range = () => {
    if (view === 'yearly') return { from: `${year}-01-01`, to: `${year}-12-31` };
    const [y, m] = month.split('-').map(Number);
    return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { from, to } = range();
      downloadBlob(await api.exportCsv({ from, to, category }), `ledgerai-${from}_${to}.csv`);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const openReceipt = async (id) => {
    try {
      const { receipt } = await api.getReceipt(id);
      setSession({ receiptId: id, imageUrl: receipt.image_url, draft: receipt });
    } catch (e) {
      setError(e.message);
    }
  };

  const thisYear = Number(currentMonth().slice(0, 4));
  // Ignore data left over from the previous tab for the one render before the effect clears it
  const ready = data?._view === view ? data : null;

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <h1 className="px-1 pt-2 text-[34px] font-bold tracking-tight">Analytics</h1>

      <div className="ios-segmented">
        {VIEWS.map(([id, label]) => (
          <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {view === 'yearly' ? (
        <Stepper label={String(year)} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} nextDisabled={year >= thisYear} />
      ) : (
        <Stepper label={monthLabel(month)} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} nextDisabled={month >= currentMonth()} />
      )}

      {error && <p className="rounded-[10px] bg-ios-red/10 px-4 py-3 text-[15px] text-ios-red">{error}</p>}
      {!ready && !error && <p className="py-10 text-center text-[15px] text-ios-secondary">Loading…</p>}

      {ready && view === 'daily' && (
        ready.days.length === 0 ? <Empty>No expenses this month.</Empty> : (
          <div className="space-y-5">
            {ready.days.map((d) => (
              <section key={d.date}>
                <div className="ios-header flex justify-between">
                  <span>{dayLabel(d.date)}</span>
                  <span className="tabular-nums">{money(d.total, d.receipts[0].currency)}</span>
                </div>
                <div className="ios-group">
                  {d.receipts.map((r) => <ReceiptRow key={r.receipt_id} receipt={r} showDate={false} onClick={() => openReceipt(r.receipt_id)} />)}
                </div>
              </section>
            ))}
          </div>
        )
      )}

      {ready && view === 'monthly' && <MonthlyView data={ready} />}
      {ready && view === 'monthly' && (
        <section>
          <p className="ios-header">Likely recurring</p>
          {recurringError ? (
            <p className="ios-card px-4 py-4 text-[15px] text-ios-red">{recurringError}</p>
          ) : !recurring ? (
            <p className="ios-card px-4 py-4 text-center text-[15px] text-ios-secondary">Checking receipt history…</p>
          ) : recurring.length === 0 ? (
            <Empty>No likely recurring expenses found yet. Add at least three similar charges to help identify a pattern.</Empty>
          ) : (
            <div className="ios-group">
              {recurring.map((expense) => (
                <div key={`${expense.merchant_name}-${expense.currency}-${expense.cadence}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-medium">{expense.merchant_name}</p>
                    <p className="text-[13px] text-ios-secondary">{expense.cadence} · next expected {expense.expected_date}</p>
                  </div>
                  <span className="shrink-0 text-[15px] tabular-nums">{money(expense.average_amount, expense.currency)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="px-4 pt-1.5 text-[13px] text-ios-secondary">Estimates based on at least three similar charges; check the dates and amounts before relying on them.</p>
        </section>
      )}
      {ready && view === 'yearly' && <YearlyView data={ready} />}

      <section>
        <p className="ios-header">Export</p>
        <div className="ios-group">
          <label className="flex items-center justify-between px-4 py-[11px]">
            <span className="text-[17px]">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="ios-input !w-auto appearance-none text-right text-ios-secondary" aria-label="Export category filter">
              <option value="">All</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <button onClick={exportCsv} disabled={exporting} className="ios-press w-full px-4 py-[11px] text-left text-[17px] text-ios-blue disabled:opacity-40">
            {exporting ? 'Exporting…' : 'Export as CSV'}
          </button>
        </div>
      </section>

      {session && (
        <ReviewModal session={session} onClose={() => setSession(null)} onSaved={() => { setSession(null); onChanged(); }} />
      )}
    </div>
  );
}

function MonthlyView({ data }) {
  const { currency } = data;
  const empty = data.categories.length === 0;
  const over = data.budget && data.total > data.budget;
  return (
    <div className="space-y-5">
      <div className="ios-card px-4 py-3">
        <p className="text-[13px] text-ios-secondary">Total spend</p>
        <p className="text-[34px] font-bold leading-tight tracking-tight tabular-nums">{money(data.total, currency)}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ios-secondary">
          <span>Last month {money(data.previous_total, currency)}</span>
          <Change pct={data.change_pct} />
        </div>
        {data.budget != null && (
          <p className={`mt-1 text-[13px] ${over ? 'text-ios-red' : 'text-ios-secondary'}`}>
            Budget {money(data.budget, currency)} · {over ? `${money(data.total - data.budget, currency)} over` : `${money(data.budget - data.total, currency)} left`}
          </p>
        )}
      </div>

      {empty ? <Empty>No expenses this month.</Empty> : (
        <>
          <section>
            <p className="ios-header">By category</p>
            <div className="ios-group">
              <div className="relative h-52 px-4 pt-3">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.categories} dataKey="total" nameKey="category" innerRadius={62} outerRadius={86} paddingAngle={2} cornerRadius={4} stroke="none">
                      {data.categories.map((c) => <Cell key={c.category} fill={CATEGORY_STYLE[c.category]?.color ?? '#8e8e93'} />)}
                    </Pie>
                    <Tooltip formatter={(v) => money(v, currency)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center pt-3 text-center">
                  <div>
                    <p className="text-[12px] text-ios-secondary">Total</p>
                    <p className="text-[17px] font-bold tabular-nums">{money(data.total, currency)}</p>
                  </div>
                </div>
              </div>
              {data.categories.map((c) => (
                <div key={c.category} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ background: CATEGORY_STYLE[c.category]?.color }} />
                  <span className="flex-1 text-[17px]">{c.category}</span>
                  <span className="text-[13px] text-ios-secondary">{Math.round((c.total / data.total) * 100)}%</span>
                  <span className="w-24 text-right text-[17px] tabular-nums">{money(c.total, currency)}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="ios-header">Top merchants</p>
            <div className="ios-group">
              {data.top_merchants.map((m) => (
                <div key={m.merchant_name} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px]">{m.merchant_name}</span>
                    <span className="block text-[13px] text-ios-secondary">{m.visits} {m.visits === 1 ? 'visit' : 'visits'}</span>
                  </span>
                  <span className="text-[17px] tabular-nums">{money(m.total, currency)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function YearlyView({ data }) {
  const { currency } = data;
  const series = data.months.map((m) => ({ name: MONTH_SHORT[m.month - 1], total: m.total }));
  return (
    <div className="space-y-5">
      <div className="ios-card px-4 pb-2 pt-3">
        <p className="text-[13px] text-ios-secondary">Total for {data.year}</p>
        <p className="text-[34px] font-bold leading-tight tracking-tight tabular-nums">{money(data.total, currency)}</p>
        <div className="mt-3 h-48">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ left: -20, right: 16, top: 4 }}>
              <defs>
                <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#007aff" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#007aff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(60,60,67,0.15)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8e8e93' }} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: '#8e8e93' }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => money(v, currency)} />
              <Area type="monotone" dataKey="total" stroke="#007aff" strokeWidth={2.5} fill="url(#spend)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <section>
        <p className="ios-header">Change vs {Number(data.year) - 1}</p>
        {data.categories.length === 0 ? <Empty>No data for this year.</Empty> : (
          <div className="ios-group">
            {data.categories.map((c) => {
              const s = CATEGORY_STYLE[c.category];
              return (
                <div key={c.category} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-[30px] w-[30px] place-items-center rounded-[7px] text-[16px]" style={{ background: s?.color }}>{s?.icon}</span>
                  <span className="flex-1 text-[17px]">{c.category}</span>
                  <Change pct={c.change_pct} />
                  <span className="w-24 text-right text-[17px] tabular-nums">{money(c.total, currency)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
