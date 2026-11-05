import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { hasSession, signOut } from '../auth.js';
import AuthScreen from './AuthScreen.jsx';

const nf = new Intl.NumberFormat();
const num = (n) => nf.format(Math.round(n ?? 0));
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function bytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function duration(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const shortDay = (d) => d.slice(5);

function Card({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-xl bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-[28px] font-bold leading-none tabular-nums ${tone ?? ''}`}>{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-slate-500">{sub}</p>}
    </div>
  );
}

function BarList({ rows, labelKey, valueKey, color = '#007aff' }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  if (!rows.length) return <p className="text-sm text-slate-400">No data yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r[labelKey]} className="text-sm">
          <div className="mb-0.5 flex justify-between">
            <span>{r[labelKey]}</span>
            <span className="tabular-nums text-slate-500">{num(r[valueKey])}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${(r[valueKey] / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Table({ head, children, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[12px] uppercase tracking-wide text-slate-500">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="py-4 text-center text-sm text-slate-400">{empty}</p>}
    </div>
  );
}

const Th = ({ children, className = '' }) => <th className={`whitespace-nowrap px-2 py-2 font-medium ${className}`}>{children}</th>;
const Td = ({ children, className = '' }) => <td className={`px-2 py-2 ${className}`}>{children}</td>;

function UsersTable() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ users: [], total: 0 });
  const [error, setError] = useState('');
  const limit = 15;

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    api.adminUsers({ q: query, sort, order, limit, offset })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [query, sort, order, offset]);

  const sortBy = (key) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setOrder('desc'); }
    setOffset(0);
  };
  const SortTh = ({ k, children, className }) => (
    <Th className={className}>
      <button onClick={() => sortBy(k)} className={`uppercase ${sort === k ? 'text-slate-900' : ''}`}>
        {children}{sort === k ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </Th>
  );

  return (
    <Card
      title={`Users (${num(data.total)})`}
      right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or name" className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 !text-[14px] outline-none focus:border-blue-500" />}
    >
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <Table
        empty={data.users.length ? '' : 'No users match.'}
        head={
          <>
            <SortTh k="email">User</SortTh>
            <Th>Country</Th>
            <SortTh k="created_at">Joined</SortTh>
            <SortTh k="last_seen_at">Last seen</SortTh>
            <SortTh k="receipts" className="text-right">Receipts</SortTh>
            <SortTh k="scans_30d" className="text-right">Scans 30d</SortTh>
            <Th>Auth</Th>
          </>
        }
      >
        {data.users.map((u) => (
          <tr key={u.user_id}>
            <Td>
              <div className="font-medium">{u.email}</div>
              {u.display_name && <div className="text-[12px] text-slate-500">{u.display_name}</div>}
            </Td>
            <Td>{u.country ? `${u.country} · ${u.currency}` : <span className="text-slate-400">not set</span>}</Td>
            <Td className="whitespace-nowrap text-slate-600">{ago(u.created_at)}</Td>
            <Td className="whitespace-nowrap text-slate-600">{ago(u.last_seen_at)}</Td>
            <Td className="text-right tabular-nums">{num(u.receipts)}</Td>
            <Td className="text-right tabular-nums">{num(u.scans_30d)}</Td>
            <Td className="text-[12px] text-slate-500">{u.cognito ? 'Cognito' : 'Local'}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
        <span>{data.total ? `${offset + 1}–${Math.min(offset + limit, data.total)} of ${num(data.total)}` : ''}</span>
        <div className="space-x-2">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">Prev</button>
          <button disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </Card>
  );
}

function Dashboard({ me, onSignOut }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.adminOverview());
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const header = (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">LedgerAI Admin</h1>
        <p className="text-[13px] text-slate-500">
          {data ? `Updated ${ago(data.generated_at)} · last ${data.window_days} days` : 'Loading…'}
        </p>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-500">{me.email}</span>
        <button onClick={load} disabled={loading} className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
        <a href="/" className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5">Back to app</a>
        <button onClick={onSignOut} className="whitespace-nowrap text-red-600">Sign out</button>
      </div>
    </header>
  );

  if (!data) return <>{header}{error && <p className="text-red-600">{error}</p>}</>;

  const { users, receipts, ai, series, breakdowns, system } = data;
  const parse = ai.parse;
  const chartData = series.map((d) => ({ ...d, day: shortDay(d.day), ok: d.scans - d.scan_failures }));
  const successRate = parse.calls ? Math.round((parse.ok / parse.calls) * 100) : null;
  const tick = { fontSize: 11, fill: '#64748b' };

  return (
    <>
      {header}
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Users" value={num(users.total)} sub={`+${users.new_7d} this week · +${users.new_24h} today`} />
        <Kpi label="Active (7d)" value={num(users.active_7d)} sub={`${num(users.active_24h)} in 24h · ${num(users.active_30d)} in 30d`} />
        <Kpi label="Receipts" value={num(receipts.total)} sub={`+${receipts.new_7d} this week · ${receipts.avg_per_active_user}/user`} />
        <Kpi label="AI scans (30d)" value={num(parse.calls)} sub={`${num(parse.calls_24h)} today · ${num(parse.calls_7d)} this week`} />
        <Kpi
          label="Scan success"
          value={successRate === null ? '—' : `${successRate}%`}
          sub={`avg ${(parse.avg_ms / 1000).toFixed(1)}s · p95 ${(parse.p95_ms / 1000).toFixed(1)}s`}
          tone={successRate !== null && successRate < 90 ? 'text-red-600' : ''}
        />
        <Kpi label="Database" value={bytes(system.db_bytes)} sub={`${num(receipts.with_images)} receipt images stored`} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Signups & receipts per day">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ left: -20, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receipts" name="Receipts" fill="#007aff" radius={[3, 3, 0, 0]} />
                <Bar dataKey="signups" name="Signups" fill="#34c759" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="AI receipt scans per day">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ left: -20, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ok" name="Succeeded" stackId="s" fill="#5ac8fa" />
                <Bar dataKey="scan_failures" name="Failed" stackId="s" fill="#ff3b30" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="Activation funnel">
          <ul className="space-y-3 text-sm">
            {[
              ['Signed up', users.total],
              ['Chose a country', users.with_country],
              ['Saved a receipt', users.with_receipts],
              ['Active in last 7 days', users.active_7d],
            ].map(([label, n]) => (
              <li key={label}>
                <div className="mb-0.5 flex justify-between"><span>{label}</span><span className="tabular-nums text-slate-500">{num(n)} · {pct(n, users.total)}</span></div>
                <div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: users.total ? `${(n / users.total) * 100}%` : 0 }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Receipts by category"><BarList rows={breakdowns.categories} labelKey="category" valueKey="receipts" color="#af52de" /></Card>
        <Card title="Users by country"><BarList rows={breakdowns.countries} labelKey="country" valueKey="users" color="#ff9500" /></Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="AI usage (30d)" className="lg:col-span-2">
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><p className="text-slate-500">Fallback model used</p><p className="text-lg font-semibold">{pct(parse.fallback_calls, parse.calls)}</p></div>
            <div><p className="text-slate-500">Input tokens</p><p className="text-lg font-semibold tabular-nums">{num(parse.input_tokens + ai.insights.input_tokens)}</p></div>
            <div><p className="text-slate-500">Output tokens</p><p className="text-lg font-semibold tabular-nums">{num(parse.output_tokens + ai.insights.output_tokens)}</p></div>
            <div><p className="text-slate-500">Insight digests</p><p className="text-lg font-semibold tabular-nums">{num(ai.insights.calls)}</p></div>
          </div>
          <Table
            empty={ai.models.length ? '' : 'No AI calls yet.'}
            head={<><Th>Model</Th><Th className="text-right">Calls</Th><Th className="text-right">Input tokens</Th><Th className="text-right">Output tokens</Th></>}
          >
            {ai.models.map((m) => (
              <tr key={m.model}>
                <Td className="font-mono text-[13px]">{m.model}</Td>
                <Td className="text-right tabular-nums">{num(m.calls)}</Td>
                <Td className="text-right tabular-nums">{num(m.input_tokens)}</Td>
                <Td className="text-right tabular-nums">{num(m.output_tokens)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="System">
          <dl className="space-y-1.5 text-sm">
            {[
              ['API uptime', duration(system.uptime_s)],
              ['Auth', system.auth_mode],
              ['Image storage', system.storage],
              ['AI', system.ai],
              ['Model', system.model],
              ['Fallback', system.fallback_model],
              ['Node', system.node],
              ['Admins', system.admins],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Most active users (receipts)">
          <Table
            empty={data.top_users.length ? '' : 'No receipts yet.'}
            head={<><Th>User</Th><Th className="text-right">Receipts</Th><Th>Last upload</Th></>}
          >
            {data.top_users.map((u) => (
              <tr key={u.email}><Td>{u.email}</Td><Td className="text-right tabular-nums">{num(u.receipts)}</Td><Td className="text-slate-600">{ago(u.last_receipt_at)}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Heaviest AI scanners (30d)">
          <Table
            empty={data.top_scanners.length ? '' : 'No scans yet.'}
            head={<><Th>User</Th><Th className="text-right">Scans</Th><Th className="text-right">Failed</Th></>}
          >
            {data.top_scanners.map((u) => (
              <tr key={u.email}><Td>{u.email}</Td><Td className="text-right tabular-nums">{num(u.scans)}</Td><Td className="text-right tabular-nums">{u.failures || '–'}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Recent AI failures" className="mb-5">
        <Table
          empty={data.recent_failures.length ? '' : 'No failures recorded. 🎉'}
          head={<><Th>When</Th><Th>Kind</Th><Th>User</Th><Th>Model</Th><Th className="text-right">Time</Th><Th>Error</Th></>}
        >
          {data.recent_failures.map((f, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap text-slate-600">{ago(f.created_at)}</Td>
              <Td>{f.kind}</Td>
              <Td>{f.email ?? <span className="text-slate-400">deleted</span>}</Td>
              <Td className="font-mono text-[12px]">{f.model ?? '—'}</Td>
              <Td className="text-right tabular-nums">{f.duration_ms ? `${(f.duration_ms / 1000).toFixed(1)}s` : '—'}</Td>
              <Td className="max-w-[28rem] truncate text-[12px] text-slate-600" title={f.error}>{f.error}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <UsersTable />
      <p className="mt-6 text-center text-[12px] text-slate-400">Aggregate usage only. Receipt contents, merchants and amounts are never shown here.</p>
    </>
  );
}

export default function Admin() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(hasSession());

  useEffect(() => {
    if (!hasSession()) return;
    api.me().then((r) => setUser(r.user)).catch(() => signOut()).finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('ledgerai:logout', onLogout);
    return () => window.removeEventListener('ledgerai:logout', onLogout);
  }, []);

  const out = () => { signOut(); setUser(null); };

  if (booting) return <div className="grid h-full place-items-center text-ios-secondary">Loading…</div>;
  if (!user) return <AuthScreen onAuth={setUser} />;

  if (!user.is_admin) {
    return (
      <div className="mx-auto grid h-full max-w-sm place-items-center px-4 text-center">
        <div>
          <p className="text-[34px]">🔒</p>
          <h1 className="mt-2 text-xl font-semibold">Not authorised</h1>
          <p className="mt-1 text-sm text-slate-500">{user.email} is not an admin of this app.</p>
          <div className="mt-4 space-x-4 text-sm">
            <a href="/" className="text-blue-600">Back to app</a>
            <button onClick={out} className="text-red-600">Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Dashboard me={user} onSignOut={out} />
      </div>
    </div>
  );
}
