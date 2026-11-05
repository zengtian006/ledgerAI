import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { config } from '../config.js';
import { aiConfigured } from '../services/gemini.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const startedAt = Date.now();
const DAYS = 30;

// Aggregate numbers only: the dashboard never exposes receipt contents, merchants or amounts.
router.get('/overview', async (_req, res) => {
  const [users, receipts, activeUploaders, ai, series, categories, countries, currencies, topUsers, topScanners, failures, models, dbSize] =
    await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS new_24h,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_7d,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_30d,
                    COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours')::int AS active_24h,
                    COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '7 days')::int AS active_7d,
                    COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '30 days')::int AS active_30d,
                    COUNT(*) FILTER (WHERE country IS NOT NULL)::int AS with_country
               FROM users`),
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS new_24h,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_7d,
                    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_30d,
                    COUNT(*) FILTER (WHERE image_key IS NOT NULL)::int AS with_images
               FROM receipts`),
      query('SELECT COUNT(DISTINCT user_id)::int AS n FROM receipts'),
      query(
        `SELECT COUNT(*)::int AS calls,
                COUNT(*) FILTER (WHERE ok)::int AS ok,
                COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS calls_24h,
                COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS calls_7d,
                COUNT(*) FILTER (WHERE model = $1)::int AS fallback_calls,
                COALESCE(ROUND(AVG(duration_ms) FILTER (WHERE ok)), 0)::int AS avg_ms,
                COALESCE(ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE ok)), 0)::int AS p95_ms,
                COALESCE(SUM(input_tokens), 0)::float8 AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::float8 AS output_tokens,
                kind
           FROM usage_events WHERE created_at >= now() - interval '${DAYS} days' GROUP BY kind`,
        [config.gemini.fallbackModel],
      ),
      query(
        `WITH d AS (SELECT generate_series(current_date - ${DAYS - 1}, current_date, interval '1 day')::date AS day)
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                (SELECT COUNT(*) FROM users u WHERE u.created_at::date = d.day)::int AS signups,
                (SELECT COUNT(*) FROM receipts r WHERE r.created_at::date = d.day)::int AS receipts,
                (SELECT COUNT(DISTINCT r.user_id) FROM receipts r WHERE r.created_at::date = d.day)::int AS uploaders,
                (SELECT COUNT(*) FROM usage_events e WHERE e.kind = 'parse' AND e.created_at::date = d.day)::int AS scans,
                (SELECT COUNT(*) FROM usage_events e WHERE e.kind = 'parse' AND NOT e.ok AND e.created_at::date = d.day)::int AS scan_failures
           FROM d ORDER BY d.day`,
      ),
      query('SELECT category, COUNT(*)::int AS receipts FROM receipts GROUP BY category ORDER BY receipts DESC'),
      query("SELECT COALESCE(country, '—') AS country, COUNT(*)::int AS users FROM users GROUP BY 1 ORDER BY users DESC LIMIT 10"),
      query('SELECT currency, COUNT(*)::int AS users FROM users GROUP BY currency ORDER BY users DESC LIMIT 10'),
      query(
        `SELECT u.email, COUNT(*)::int AS receipts, MAX(r.created_at) AS last_receipt_at
           FROM receipts r JOIN users u ON u.user_id = r.user_id
          GROUP BY u.user_id ORDER BY receipts DESC LIMIT 8`,
      ),
      query(
        `SELECT u.email, COUNT(*)::int AS scans, COUNT(*) FILTER (WHERE NOT e.ok)::int AS failures
           FROM usage_events e JOIN users u ON u.user_id = e.user_id
          WHERE e.kind = 'parse' AND e.created_at >= now() - interval '${DAYS} days'
          GROUP BY u.user_id ORDER BY scans DESC LIMIT 8`,
      ),
      query(
        `SELECT e.created_at, e.kind, e.model, e.error, e.duration_ms, u.email
           FROM usage_events e LEFT JOIN users u ON u.user_id = e.user_id
          WHERE NOT e.ok ORDER BY e.created_at DESC LIMIT 10`,
      ),
      query(
        `SELECT COALESCE(model, 'none') AS model, COUNT(*)::int AS calls,
                COALESCE(SUM(input_tokens), 0)::float8 AS input_tokens, COALESCE(SUM(output_tokens), 0)::float8 AS output_tokens
           FROM usage_events WHERE created_at >= now() - interval '${DAYS} days' GROUP BY 1 ORDER BY calls DESC`,
      ),
      pool.query('SELECT pg_database_size(current_database())::float8 AS bytes'),
    ]);

  const aiByKind = Object.fromEntries(ai.rows.map(({ kind, ...v }) => [kind, v]));
  const empty = { calls: 0, ok: 0, calls_24h: 0, calls_7d: 0, fallback_calls: 0, avg_ms: 0, p95_ms: 0, input_tokens: 0, output_tokens: 0 };
  const u = users.rows[0];
  const withReceipts = activeUploaders.rows[0].n;

  res.json({
    generated_at: new Date().toISOString(),
    window_days: DAYS,
    users: { ...u, with_receipts: withReceipts, activation_pct: u.total ? Math.round((withReceipts / u.total) * 100) : 0 },
    receipts: { ...receipts.rows[0], avg_per_active_user: withReceipts ? Math.round((receipts.rows[0].total / withReceipts) * 10) / 10 : 0 },
    ai: { parse: { ...empty, ...aiByKind.parse }, insights: { ...empty, ...aiByKind.insights }, models: models.rows },
    series: series.rows,
    breakdowns: { categories: categories.rows, countries: countries.rows, currencies: currencies.rows },
    top_users: topUsers.rows,
    top_scanners: topScanners.rows,
    recent_failures: failures.rows,
    system: {
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      node: process.version,
      auth_mode: config.authMode,
      storage: config.storage.driver,
      ai: aiConfigured() ? (config.gemini.mock && !config.gemini.apiKey ? 'mock' : 'gemini') : 'off',
      model: config.gemini.model,
      fallback_model: config.gemini.fallbackModel,
      db_bytes: dbSize.rows[0].bytes,
      admins: config.adminEmails.length,
    },
  });
});

const SORTS = {
  created_at: 'u.created_at',
  last_seen_at: 'u.last_seen_at',
  receipts: 'receipts',
  scans_30d: 'scans_30d',
  email: 'u.email',
};

const userQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(Object.keys(SORTS)).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/users', async (req, res) => {
  const f = userQuery.parse(req.query);
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const [rows, total] = await Promise.all([
    query(
      `SELECT u.user_id, u.email, u.display_name, u.country, u.currency, u.created_at, u.last_seen_at,
              (u.cognito_sub IS NOT NULL) AS cognito,
              COUNT(r.receipt_id)::int AS receipts,
              MAX(r.created_at) AS last_receipt_at,
              (SELECT COUNT(*)::int FROM usage_events e
                WHERE e.user_id = u.user_id AND e.kind = 'parse' AND e.created_at >= now() - interval '${DAYS} days') AS scans_30d
         FROM users u LEFT JOIN receipts r ON r.user_id = u.user_id
        WHERE ($1::text IS NULL OR u.email ILIKE $1 OR u.display_name ILIKE $1)
        GROUP BY u.user_id
        ORDER BY ${SORTS[f.sort]} ${f.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, u.user_id DESC
        LIMIT ${f.limit} OFFSET ${f.offset}`,
      [like],
    ),
    query('SELECT COUNT(*)::int AS n FROM users WHERE ($1::text IS NULL OR email ILIKE $1 OR display_name ILIKE $1)', [like]),
  ]);
  res.json({ users: rows.rows, total: total.rows[0].n });
});

export default router;
