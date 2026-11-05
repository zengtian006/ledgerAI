// Dev-only: creates (or resets) a demo account with ~16 months of sample receipts.
//   npm run seed            -> demo@example.com / password123
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { migrate, pool, withTransaction } from '../src/db.js';

if (config.isProd) throw new Error('Refusing to seed in production');

const EMAIL = 'demo@example.com';
const PASSWORD = 'password123';

const MERCHANTS = {
  Groceries: [['Tesco', 18, 75], ['Sainsbury\'s', 15, 70], ['Waitrose', 20, 90], ['Aldi', 12, 55]],
  Dining: [['Pret A Manger', 5, 12], ['Nando\'s', 18, 45], ['Dishoom', 30, 80], ['Wagamama', 15, 40]],
  Transport: [['TfL', 2, 15], ['Uber', 8, 28], ['Trainline', 15, 70]],
  Utilities: [['Octopus Energy', 55, 95], ['Thames Water', 28, 40], ['Vodafone', 18, 30]],
  Entertainment: [['Odeon', 10, 24], ['Spotify', 11, 11], ['Netflix', 11, 11]],
  Shopping: [['Zara', 25, 120], ['Amazon', 8, 90], ['IKEA', 20, 150]],
  Other: [['Boots', 6, 30], ['Post Office', 3, 15]],
};
const WEIGHTS = { Groceries: 9, Dining: 7, Transport: 6, Utilities: 2, Entertainment: 2, Shopping: 3, Other: 2 };
const ITEMS = {
  Groceries: ['Bread', 'Milk', 'Eggs', 'Chicken breast', 'Apples', 'Pasta', 'Cheddar', 'Coffee'],
  Dining: ['Flat white', 'Chicken wrap', 'Burger', 'Sparkling water', 'Dessert'],
};

// Deterministic PRNG so every run produces the same demo data
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);

function weightedCategory() {
  let r = rand() * Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  for (const [cat, w] of Object.entries(WEIGHTS)) if ((r -= w) <= 0) return cat;
  return 'Other';
}

function buildReceipts() {
  const out = [];
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 15, 1));
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const n = rand() < 0.55 ? 1 : rand() < 0.5 ? 2 : 0;
    for (let i = 0; i < n; i++) {
      const category = weightedCategory();
      const [merchant, lo, hi] = pick(MERCHANTS[category]);
      const total = round2(between(lo, hi));
      const tax = ['Groceries'].includes(category) ? 0 : round2(total / 6);
      const names = ITEMS[category];
      const line_items = names
        ? Array.from({ length: 2 + Math.floor(rand() * 3) }, () => ({ description: pick(names), quantity: 1, price: round2(total / 3) }))
        : [];
      out.push({ merchant, category, total, tax: tax || null, date: iso(d), line_items });
    }
  }
  // Showcase the anomaly insights: a duplicate charge and an unusually large purchase this month
  const recent = iso(new Date(Date.now() - 2 * 86400000));
  out.push({ merchant: 'Dishoom', category: 'Dining', total: 54.2, tax: 9.03, date: recent, line_items: [] });
  out.push({ merchant: 'Dishoom', category: 'Dining', total: 54.2, tax: 9.03, date: recent, line_items: [] });
  out.push({ merchant: 'Apple Store', category: 'Shopping', total: 489, tax: 81.5, date: iso(new Date(Date.now() - 86400000)), line_items: [] });
  return out;
}

await migrate();
const hash = await bcrypt.hash(PASSWORD, 12);
const receipts = buildReceipts();

await withTransaction(async (db) => {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, display_name, country, currency) VALUES ($1,$2,'Demo User','GB','GBP')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = 'Demo User', country = 'GB', currency = 'GBP'
     RETURNING user_id`,
    [EMAIL, hash],
  );
  const userId = rows[0].user_id;
  await db.query('DELETE FROM receipts WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM insights WHERE user_id = $1', [userId]);

  for (const r of receipts) {
    const subtotal = r.tax != null ? round2(r.total - r.tax) : null;
    const ins = await db.query(
      `INSERT INTO receipts (user_id, merchant_name, transaction_date, currency, subtotal, tax, total_amount, category)
       VALUES ($1,$2,$3,'GBP',$4,$5,$6,$7) RETURNING receipt_id`,
      [userId, r.merchant, r.date, subtotal, r.tax, r.total, r.category],
    );
    for (const li of r.line_items) {
      await db.query('INSERT INTO line_items (receipt_id, description, quantity, price) VALUES ($1,$2,$3,$4)', [
        ins.rows[0].receipt_id, li.description, li.quantity, li.price,
      ]);
    }
  }
  await db.query(
    `INSERT INTO budgets (user_id, month, amount) VALUES ($1,$2,900)
     ON CONFLICT (user_id, month) DO UPDATE SET amount = 900`,
    [userId, new Date().toISOString().slice(0, 7)],
  );
});

// ---- Extra synthetic users + AI usage so the /admin dashboard has something to show ----
const COUNTRIES = [['GB', 'GBP'], ['GB', 'GBP'], ['US', 'USD'], ['US', 'USD'], ['DE', 'EUR'], ['FR', 'EUR'], ['JP', 'JPY'], ['CN', 'CNY'], ['AU', 'AUD'], ['CA', 'CAD'], [null, 'GBP']];
const daysAgo = (n, extraHours = 0) => new Date(Date.now() - n * 86400000 - extraHours * 3600000);

await withTransaction(async (db) => {
  await db.query("DELETE FROM users WHERE email LIKE '%@seed.test'");
  await db.query('DELETE FROM usage_events WHERE user_id IS NULL OR user_id = (SELECT user_id FROM users WHERE email = $1)', [EMAIL]);
  const demoId = (await db.query('SELECT user_id FROM users WHERE email = $1', [EMAIL])).rows[0].user_id;
  await db.query('UPDATE users SET last_seen_at = now(), created_at = $2 WHERE user_id = $1', [demoId, daysAgo(40)]);
  await db.query('UPDATE receipts SET created_at = transaction_date + time \'12:00\' WHERE user_id = $1', [demoId]); // spread over time, not all "today"

  const event = (userId, at, { kind = 'parse', ok = true } = {}) => {
    const fallback = rand() < 0.12;
    return db.query(
      `INSERT INTO usage_events (user_id, kind, ok, model, duration_ms, input_tokens, output_tokens, error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        userId, kind, ok, ok ? (fallback ? config.gemini.fallbackModel : config.gemini.model) : config.gemini.model,
        Math.round(ok ? between(2200, 9500) : between(15000, 20000)),
        ok ? Math.round(between(1200, 2600)) : null, ok ? Math.round(between(150, 600)) : null,
        ok ? null : pick(['503 UNAVAILABLE: model is currently experiencing high demand', 'timeout after 20000ms']), at,
      ],
    );
  };

  for (let i = 0; i < 40; i++) await event(demoId, daysAgo(rand() * 28, rand() * 20), { ok: rand() > 0.07 });
  for (let i = 0; i < 6; i++) await event(demoId, daysAgo(rand() * 25), { kind: 'insights' });

  for (let n = 1; n <= 14; n++) {
    const [country, currency] = pick(COUNTRIES);
    const joined = Math.floor(rand() * 28);
    const lastSeen = rand() < 0.2 ? daysAgo(Math.floor(rand() * 25) + 2) : daysAgo(rand() * Math.min(joined, 6));
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, display_name, country, currency, created_at, last_seen_at)
       VALUES ($1,'x',$2,$3,$4,$5,$6) RETURNING user_id`,
      [`user${String(n).padStart(2, '0')}@seed.test`, n % 3 === 0 ? `Sample User ${n}` : null, country, currency, daysAgo(joined), lastSeen],
    );
    const uid = rows[0].user_id;
    const count = rand() < 0.25 ? 0 : Math.floor(rand() * 22) + 1;
    for (let i = 0; i < count; i++) {
      const category = weightedCategory();
      const [merchant, lo, hi] = pick(MERCHANTS[category]);
      const at = daysAgo(rand() * Math.max(joined, 1));
      await db.query(
        `INSERT INTO receipts (user_id, merchant_name, transaction_date, currency, total_amount, category, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uid, merchant, iso(at), currency, round2(between(lo, hi)), category, at],
      );
      await event(uid, at, { ok: true });
      if (rand() < 0.08) await event(uid, at, { ok: false });
    }
  }
});

console.log(`Seeded ${receipts.length} receipts for ${EMAIL} (password: ${PASSWORD}) + 14 sample users (@seed.test) with AI usage`);
await pool.end();
