import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CATEGORIES, config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { HttpError, requireAuth } from '../auth.js';
import { AiUnavailableError, aiConfigured, parseReceiptImage } from '../services/gemini.js';
import { deleteImage, getImageUrl, keyBelongsToUser, newKey, saveImage } from '../services/storage.js';
import { invalidateInsights } from '../services/insights.js';
import { recordUsage } from '../services/usage.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

const parseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `u${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many receipt scans, try again later' },
});

// Verify real file type from magic bytes instead of trusting the client header
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(1, 4).toString() === 'PNG') return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString() === 'ftyp') return 'image/heic';
  return null;
}

const money = z.number().finite().min(0).max(100_000_000);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), 'Invalid date');

const receiptInput = z.object({
  merchant_name: z.string().trim().min(1).max(255),
  transaction_date: isoDate,
  currency: z.string().trim().toUpperCase().min(3).max(10).default('GBP'),
  total_amount: money,
  tax_amount: money.nullish(),
  category: z.enum(CATEGORIES),
  image_key: z.string().max(300).nullish(),
  image_hash: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  line_items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.number().finite().min(0).max(100000).default(1),
        price: z.number().finite().min(-100_000_000).max(100_000_000), // negative = discount
      }),
    )
    .max(100)
    .default([]),
});

const filters = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.enum(CATEGORIES).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function buildWhere(userId, f) {
  const where = ['user_id = $1'];
  const params = [userId];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.from) add('transaction_date >= ?', f.from);
  if (f.to) add('transaction_date <= ?', f.to);
  if (f.category) add('category = ?', f.category);
  if (f.q) add('merchant_name ILIKE ?', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
  return { clause: where.join(' AND '), params };
}

const toApi = ({ tax, ...r }) => ({ ...r, tax_amount: tax });
const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id');
  return n;
};

async function validateImageKey(userId, key) {
  if (key && !keyBelongsToUser(key, userId)) throw new HttpError(400, 'Invalid image_key');
}

// 1) Upload + AI parse -> returns a draft for the user to verify (nothing is saved to receipts yet)
router.post('/parse', parseLimiter, upload.single('image'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Image file is required (field "image")');
  const mime = sniffImage(req.file.buffer);
  if (!mime) throw new HttpError(415, 'Unsupported image type (use JPEG, PNG, WebP or HEIC)');
  if (!aiConfigured()) throw new HttpError(503, 'AI parsing is not configured on the server');

  const hash = createHash('sha256').update(req.file.buffer).digest('hex');
  const key = newKey(req.userId, mime);

  const { rows: u } = await query('SELECT currency FROM users WHERE user_id = $1', [req.userId]);
  let draft;
  const meta = {};
  const startedAt = Date.now();
  try {
    [draft] = await Promise.all([parseReceiptImage(req.file.buffer, mime, u[0]?.currency, meta), saveImage(key, req.file.buffer, mime)]);
    await recordUsage({ userId: req.userId, kind: 'parse', ok: true, meta, startedAt });
  } catch (err) {
    await recordUsage({ userId: req.userId, kind: 'parse', ok: false, meta, startedAt, error: err.message });
    await deleteImage(key);
    if (err instanceof AiUnavailableError) throw new HttpError(503, err.message);
    console.error('Receipt parse failed:', err.message);
    throw new HttpError(502, 'Could not read this receipt. Please retry or enter details manually.');
  }

  const dup = await query('SELECT receipt_id FROM receipts WHERE user_id = $1 AND image_hash = $2 LIMIT 1', [
    req.userId,
    hash,
  ]);
  res.json({
    image_key: key,
    image_hash: hash,
    image_url: await getImageUrl(key),
    draft,
    duplicate_of: dup.rows[0]?.receipt_id ?? null,
  });
});

// 2) Save a verified/edited receipt
router.post('/', async (req, res) => {
  const input = receiptInput.parse(req.body);
  await validateImageKey(req.userId, input.image_key);
  const receipt = await withTransaction(async (db) => {
    const subtotal = input.tax_amount != null ? Math.max(input.total_amount - input.tax_amount, 0) : null;
    const { rows } = await db.query(
      `INSERT INTO receipts (user_id, image_key, image_hash, merchant_name, transaction_date, currency, subtotal, tax, total_amount, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.userId, input.image_key ?? null, input.image_hash ?? null, input.merchant_name, input.transaction_date,
        input.currency, subtotal, input.tax_amount ?? null, input.total_amount, input.category],
    );
    for (const item of input.line_items) {
      await db.query('INSERT INTO line_items (receipt_id, description, quantity, price) VALUES ($1,$2,$3,$4)', [
        rows[0].receipt_id, item.description, item.quantity, item.price,
      ]);
    }
    return rows[0];
  });
  await invalidateInsights(req.userId);
  res.status(201).json({ receipt: toApi(receipt) });
});

router.get('/', async (req, res) => {
  const f = filters.parse(req.query);
  const { clause, params } = buildWhere(req.userId, f);
  const [list, total] = await Promise.all([
    query(
      `SELECT * FROM receipts WHERE ${clause} ORDER BY transaction_date DESC, receipt_id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0) AS sum FROM receipts WHERE ${clause}`, params),
  ]);
  res.json({ receipts: list.rows.map(toApi), count: total.rows[0].n, sum: total.rows[0].sum });
});

// CSV-injection safe export of the filtered history
router.get('/export.csv', async (req, res) => {
  const f = filters.parse({ ...req.query, limit: 500 });
  const { clause, params } = buildWhere(req.userId, f);
  const { rows } = await query(
    `SELECT transaction_date, merchant_name, category, currency, subtotal, tax, total_amount, status
       FROM receipts WHERE ${clause} ORDER BY transaction_date DESC, receipt_id DESC`,
    params,
  );
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['date', 'merchant', 'category', 'currency', 'subtotal', 'tax', 'total', 'status'];
  const body = rows.map((r) =>
    [r.transaction_date, r.merchant_name, r.category, r.currency, r.subtotal, r.tax, r.total_amount, r.status].map(cell).join(','),
  );
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="ledgerai-transactions.csv"',
  });
  res.send([header.join(','), ...body].join('\n'));
});

// Discard an uploaded image when the user cancels the review modal
router.delete('/draft-image', async (req, res) => {
  const key = String(req.query.key ?? '');
  await validateImageKey(req.userId, key);
  const used = await query('SELECT 1 FROM receipts WHERE user_id = $1 AND image_key = $2', [req.userId, key]);
  if (!used.rows[0]) await deleteImage(key);
  res.status(204).end();
});

router.get('/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM receipts WHERE receipt_id = $1 AND user_id = $2', [id(req), req.userId]);
  if (!rows[0]) throw new HttpError(404, 'Receipt not found');
  const items = await query(
    'SELECT item_id, description, quantity, price FROM line_items WHERE receipt_id = $1 ORDER BY item_id',
    [rows[0].receipt_id],
  );
  res.json({ receipt: { ...toApi(rows[0]), line_items: items.rows, image_url: await getImageUrl(rows[0].image_key) } });
});

router.put('/:id', async (req, res) => {
  const input = receiptInput.parse(req.body);
  const rid = id(req);
  const receipt = await withTransaction(async (db) => {
    const subtotal = input.tax_amount != null ? Math.max(input.total_amount - input.tax_amount, 0) : null;
    const { rows } = await db.query(
      `UPDATE receipts SET merchant_name=$3, transaction_date=$4, currency=$5, subtotal=$6, tax=$7, total_amount=$8, category=$9
        WHERE receipt_id=$1 AND user_id=$2 RETURNING *`,
      [rid, req.userId, input.merchant_name, input.transaction_date, input.currency, subtotal, input.tax_amount ?? null,
        input.total_amount, input.category],
    );
    if (!rows[0]) throw new HttpError(404, 'Receipt not found');
    await db.query('DELETE FROM line_items WHERE receipt_id = $1', [rid]);
    for (const item of input.line_items) {
      await db.query('INSERT INTO line_items (receipt_id, description, quantity, price) VALUES ($1,$2,$3,$4)', [
        rid, item.description, item.quantity, item.price,
      ]);
    }
    return rows[0];
  });
  await invalidateInsights(req.userId);
  res.json({ receipt: toApi(receipt) });
});

router.delete('/:id', async (req, res) => {
  const { rows } = await query('DELETE FROM receipts WHERE receipt_id = $1 AND user_id = $2 RETURNING image_key', [
    id(req), req.userId,
  ]);
  if (!rows[0]) throw new HttpError(404, 'Receipt not found');
  await deleteImage(rows[0].image_key);
  await invalidateInsights(req.userId);
  res.status(204).end();
});

export default router;
