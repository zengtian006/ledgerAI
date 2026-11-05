import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { CATEGORIES } from '../config.js';
import { currentPeriod, getCachedInsights, refreshInsights } from '../services/insights.js';
import { detectRecurringExpenses } from '../services/recurring.js';

const router = Router();
router.use(requireAuth);

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const year = z.string().regex(/^\d{4}$/);
const ym = "to_char(transaction_date,'YYYY-MM')";

const prevMonth = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7);
};

const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

router.get('/daily', async (req, res) => {
  const m = month.default(currentPeriod()).parse(req.query.month);
  const { rows } = await query(
    `SELECT receipt_id, merchant_name, category, currency, total_amount, to_char(transaction_date,'YYYY-MM-DD') AS transaction_date
       FROM receipts WHERE user_id = $1 AND ${ym} = $2 ORDER BY transaction_date DESC, receipt_id DESC`,
    [req.userId, m],
  );
  const days = new Map();
  for (const r of rows) {
    const d = days.get(r.transaction_date) ?? { date: r.transaction_date, total: 0, receipts: [] };
    d.total = Math.round((d.total + r.total_amount) * 100) / 100;
    d.receipts.push(r);
    days.set(r.transaction_date, d);
  }
  res.json({ month: m, days: [...days.values()] });
});

router.get('/monthly', async (req, res) => {
  const m = month.default(currentPeriod()).parse(req.query.month);
  const prev = prevMonth(m);
  const [cats, merchants, budget, totals, user] = await Promise.all([
    query(
      `SELECT category, SUM(total_amount) AS total, COUNT(*)::int AS count FROM receipts
        WHERE user_id = $1 AND ${ym} = $2 GROUP BY category ORDER BY total DESC`,
      [req.userId, m],
    ),
    query(
      `SELECT merchant_name, SUM(total_amount) AS total, COUNT(*)::int AS visits FROM receipts
        WHERE user_id = $1 AND ${ym} = $2 GROUP BY merchant_name ORDER BY total DESC LIMIT 5`,
      [req.userId, m],
    ),
    query('SELECT amount FROM budgets WHERE user_id = $1 AND month = $2', [req.userId, m]),
    query(
      `SELECT COALESCE(SUM(total_amount) FILTER (WHERE ${ym} = $2),0) AS current,
              COALESCE(SUM(total_amount) FILTER (WHERE ${ym} = $3),0) AS previous
         FROM receipts WHERE user_id = $1 AND ${ym} IN ($2,$3)`,
      [req.userId, m, prev],
    ),
    query('SELECT currency FROM users WHERE user_id = $1', [req.userId]),
  ]);
  res.json({
    month: m,
    currency: user.rows[0]?.currency ?? 'GBP',
    total: totals.rows[0].current,
    previous_total: totals.rows[0].previous,
    change_pct: pct(totals.rows[0].current, totals.rows[0].previous),
    budget: budget.rows[0]?.amount ?? null,
    categories: cats.rows,
    top_merchants: merchants.rows,
  });
});

router.get('/yearly', async (req, res) => {
  const y = year.default(String(new Date().getUTCFullYear())).parse(req.query.year);
  const prevY = String(Number(y) - 1);
  const [months, cats, user] = await Promise.all([
    query(
      `SELECT to_char(transaction_date,'MM')::int AS m, SUM(total_amount) AS total FROM receipts
        WHERE user_id = $1 AND to_char(transaction_date,'YYYY') = $2 GROUP BY 1`,
      [req.userId, y],
    ),
    query(
      `SELECT category,
              COALESCE(SUM(total_amount) FILTER (WHERE to_char(transaction_date,'YYYY') = $2),0) AS total,
              COALESCE(SUM(total_amount) FILTER (WHERE to_char(transaction_date,'YYYY') = $3),0) AS previous_total
         FROM receipts WHERE user_id = $1 AND to_char(transaction_date,'YYYY') IN ($2,$3) GROUP BY category`,
      [req.userId, y, prevY],
    ),
    query('SELECT currency FROM users WHERE user_id = $1', [req.userId]),
  ]);
  const byMonth = new Map(months.rows.map((r) => [r.m, r.total]));
  const series = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: byMonth.get(i + 1) ?? 0 }));
  res.json({
    year: y,
    currency: user.rows[0]?.currency ?? 'GBP',
    total: Math.round(series.reduce((s, r) => s + r.total, 0) * 100) / 100,
    months: series,
    categories: cats.rows
      .map((c) => ({ ...c, change_pct: pct(c.total, c.previous_total) }))
      .sort((a, b) => b.total - a.total),
  });
});

router.get('/recurring', async (req, res) => {
  const { rows } = await query(
    `SELECT merchant_name, transaction_date::text AS transaction_date, currency, total_amount
       FROM receipts
      WHERE user_id = $1 AND transaction_date >= CURRENT_DATE - INTERVAL '1100 days'
      ORDER BY transaction_date, receipt_id`,
    [req.userId],
  );
  res.json({ expenses: detectRecurringExpenses(rows) });
});

router.get('/budget', async (req, res) => {
  const m = month.default(currentPeriod()).parse(req.query.month);
  const { rows } = await query('SELECT amount FROM budgets WHERE user_id = $1 AND month = $2', [req.userId, m]);
  res.json({ month: m, amount: rows[0]?.amount ?? null });
});

router.put('/budget', async (req, res) => {
  const body = z
    .object({ month: month.default(currentPeriod()), amount: z.number().finite().min(0).max(100_000_000) })
    .parse(req.body);
  await query(
    `INSERT INTO budgets (user_id, month, amount) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [req.userId, body.month, body.amount],
  );
  res.json(body);
});

router.get('/insights', async (req, res) => {
  res.json({ insights: await getCachedInsights(req.userId) });
});

router.post('/insights/refresh', async (req, res) => {
  const force = req.body?.force === true;
  res.json({ insights: await refreshInsights(req.userId, { force }) });
});

router.get('/categories', (_req, res) => res.json({ categories: CATEGORIES }));

export default router;
