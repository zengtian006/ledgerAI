import { query } from '../db.js';
import { generateInsightsWithAi } from './gemini.js';
import { config } from '../config.js';
import { recordUsage } from './usage.js';

const MIN_REFRESH_MS = 5 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

export const currentPeriod = () => new Date().toISOString().slice(0, 7);

const prevPeriod = (period) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
};

const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const round2 = (n) => Math.round(n * 100) / 100;

// Aggregation happens in SQL; only these summaries are sent to the LLM.
export async function buildAggregates(userId, period) {
  const prev = prevPeriod(period);
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date();
  const isCurrent = period === currentPeriod();
  const daysElapsed = isCurrent ? today.getUTCDate() : daysInMonth;

  const [user, cats, budget, merchants, dupes, spikes] = await Promise.all([
    query('SELECT currency FROM users WHERE user_id = $1', [userId]),
    query(
      `SELECT category,
              COALESCE(SUM(total_amount) FILTER (WHERE to_char(transaction_date,'YYYY-MM') = $2), 0) AS current,
              COALESCE(SUM(total_amount) FILTER (WHERE to_char(transaction_date,'YYYY-MM') = $3), 0) AS previous
         FROM receipts WHERE user_id = $1 AND to_char(transaction_date,'YYYY-MM') IN ($2,$3)
         GROUP BY category`,
      [userId, period, prev],
    ),
    query('SELECT amount FROM budgets WHERE user_id = $1 AND month = $2', [userId, period]),
    query(
      `SELECT merchant_name, SUM(total_amount) AS total, COUNT(*)::int AS visits
         FROM receipts WHERE user_id = $1 AND to_char(transaction_date,'YYYY-MM') = $2
         GROUP BY merchant_name ORDER BY total DESC LIMIT 5`,
      [userId, period],
    ),
    query(
      `SELECT merchant_name, to_char(transaction_date,'YYYY-MM-DD') AS date, total_amount AS amount, COUNT(*)::int AS count
         FROM receipts WHERE user_id = $1 AND transaction_date >= (CURRENT_DATE - INTERVAL '60 days')
         GROUP BY merchant_name, transaction_date, total_amount HAVING COUNT(*) > 1
         ORDER BY transaction_date DESC LIMIT 5`,
      [userId],
    ),
    query(
      `WITH base AS (
         SELECT AVG(total_amount) AS avg_amt, COUNT(*) AS n FROM receipts
          WHERE user_id = $1 AND transaction_date >= (CURRENT_DATE - INTERVAL '90 days')
       )
       SELECT r.merchant_name, to_char(r.transaction_date,'YYYY-MM-DD') AS date, r.total_amount AS amount, ROUND(b.avg_amt, 2) AS typical
         FROM receipts r, base b
        WHERE r.user_id = $1 AND to_char(r.transaction_date,'YYYY-MM') = $2
          AND b.n >= 5 AND r.total_amount > b.avg_amt * 3
        ORDER BY r.total_amount DESC LIMIT 3`,
      [userId, period],
    ),
  ]);

  const categories = cats.rows
    .map((r) => ({ category: r.category, current: round2(r.current), previous: round2(r.previous), change_pct: pct(r.current, r.previous) }))
    .sort((a, b) => b.current - a.current);
  const total = round2(categories.reduce((s, c) => s + c.current, 0));
  const previousTotal = round2(categories.reduce((s, c) => s + c.previous, 0));
  const budgetAmount = budget.rows[0]?.amount ?? null;

  return {
    period,
    currency: user.rows[0]?.currency ?? config.defaultCurrency,
    total,
    previous_total: previousTotal,
    change_pct: pct(total, previousTotal),
    days_elapsed: daysElapsed,
    days_in_month: daysInMonth,
    projected_total: isCurrent ? round2((total / Math.max(daysElapsed, 1)) * daysInMonth) : total,
    budget: budgetAmount,
    categories,
    top_merchants: merchants.rows.map((r) => ({ ...r, total: round2(r.total) })),
    possible_duplicates: dupes.rows,
    spikes: spikes.rows,
  };
}

// Deterministic fallback with the same shape as the Gemini schema.
export function ruleBasedInsights(a) {
  const insights = [];
  const fmt = (n) => `${a.currency} ${n.toFixed(2)}`;

  for (const d of a.possible_duplicates) {
    insights.push({
      type: 'anomaly',
      title: `Possible duplicate at ${d.merchant_name}`,
      detail: `${d.count} identical charges of ${fmt(d.amount)} on ${d.date}. Check whether you were charged twice.`,
    });
  }
  for (const s of a.spikes) {
    insights.push({
      type: 'anomaly',
      title: `Large purchase at ${s.merchant_name}`,
      detail: `${fmt(s.amount)} on ${s.date} is much higher than your typical ${fmt(s.typical)}.`,
    });
  }
  for (const c of a.categories.filter((c) => c.change_pct !== null && Math.abs(c.change_pct) >= 15 && c.current >= 10).slice(0, 2)) {
    insights.push({
      type: 'trend',
      title: `${c.category} ${c.change_pct > 0 ? 'rose' : 'fell'} ${Math.abs(c.change_pct)}%`,
      detail: `${fmt(c.current)} this month vs ${fmt(c.previous)} last month.`,
    });
  }
  const top = a.categories[0];
  if (top && a.total > 0) {
    insights.push({
      type: 'tip',
      title: `Trim ${top.category}`,
      detail: `${top.category} is ${Math.round((top.current / a.total) * 100)}% of your spend. Cutting 10% would save about ${fmt(top.current * 0.1)}.`,
    });
  }

  let velocity = 'normal';
  const benchmark = a.budget ?? (a.previous_total || null);
  if (benchmark) {
    const ratio = a.projected_total / benchmark;
    velocity = ratio > 1.1 ? 'high_alert' : ratio < 0.8 ? 'under_control' : 'normal';
  }

  return {
    summary_headline:
      a.total === 0
        ? 'No spending recorded yet this month'
        : `You've spent ${fmt(a.total)} so far, on pace for ${fmt(a.projected_total)}`,
    spending_velocity: velocity,
    key_insights: insights.slice(0, 6),
    ...(a.budget && a.projected_total > a.budget
      ? { suggested_budget_adjustment: `Projected spend exceeds your ${fmt(a.budget)} budget. Reduce daily spend to about ${fmt(Math.max(a.budget - a.total, 0) / Math.max(a.days_in_month - a.days_elapsed, 1))}.` }
      : {}),
  };
}

export async function getCachedInsights(userId, period = currentPeriod()) {
  const { rows } = await query('SELECT payload, source, created_at FROM insights WHERE user_id = $1 AND period = $2', [userId, period]);
  if (!rows[0]) return null;
  return { period, ...rows[0].payload, source: rows[0].source, generated_at: rows[0].created_at };
}

// Called whenever receipts change so the next dashboard load regenerates the digest
export const invalidateInsights = (userId) => query('DELETE FROM insights WHERE user_id = $1', [userId]);

export async function refreshInsights(userId, { force = false } = {}) {
  const period = currentPeriod();
  const cached = await getCachedInsights(userId, period);
  if (cached) {
    const age = Date.now() - new Date(cached.generated_at).getTime();
    if (age < (force ? MIN_REFRESH_MS : STALE_MS)) return { ...cached, cached: true };
  }

  const aggregates = await buildAggregates(userId, period);
  let payload;
  let source = 'rules';
  if (aggregates.total === 0 && aggregates.previous_total === 0) {
    payload = ruleBasedInsights(aggregates);
  } else if (config.gemini.apiKey) {
    const meta = {};
    const startedAt = Date.now();
    try {
      payload = await generateInsightsWithAi(aggregates, meta);
      source = 'gemini';
      await recordUsage({ userId, kind: 'insights', ok: true, meta, startedAt });
    } catch (err) {
      console.error('Gemini insights failed, using rules:', err.message);
      await recordUsage({ userId, kind: 'insights', ok: false, meta, startedAt, error: err.message });
      payload = ruleBasedInsights(aggregates);
    }
  } else {
    payload = ruleBasedInsights(aggregates);
  }

  await query(
    `INSERT INTO insights (user_id, period, payload, source, created_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (user_id, period) DO UPDATE SET payload = EXCLUDED.payload, source = EXCLUDED.source, created_at = now()`,
    [userId, period, payload, source],
  );
  return getCachedInsights(userId, period);
}
