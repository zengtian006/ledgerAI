import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PG_PORT = 54329;
let pg, server, base, tmp, pool;
let token;
const month = new Date().toISOString().slice(0, 7);

const api = async (method, url, { body, auth = true, form } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, res };
};

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ledger-test-'));
  pg = new EmbeddedPostgres({ databaseDir: path.join(tmp, 'pg'), user: 'postgres', password: 'pw', port: PG_PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('ledgerai');

  process.env.DATABASE_URL = `postgres://postgres:pw@localhost:${PG_PORT}/ledgerai`;
  process.env.MOCK_AI = 'true';
  process.env.ADMIN_EMAILS = 'Test@Example.com';
  process.env.LOCAL_UPLOAD_DIR = path.join(tmp, 'uploads');
  const db = await import('../src/db.js');
  pool = db.pool;
  await db.migrate();
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool?.end();
  await pg?.stop();
  await rm(tmp, { recursive: true, force: true });
});

const jpeg = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3])], { type: 'image/jpeg' });

describe('LedgerAI API', () => {
  test('rejects unauthenticated access', async () => {
    assert.equal((await api('GET', '/api/receipts', { auth: false })).status, 401);
  });

  test('register, duplicate register, login', async () => {
    const creds = { email: 'Test@Example.com', password: 'password123' };
    const reg = await api('POST', '/api/auth/register', { body: creds, auth: false });
    assert.equal(reg.status, 201);
    token = reg.data.token;
    assert.equal((await api('POST', '/api/auth/register', { body: creds, auth: false })).status, 409);
    assert.equal((await api('POST', '/api/auth/login', { body: { ...creds, password: 'wrong-pass-1' }, auth: false })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { body: creds, auth: false })).status, 200);
    assert.equal((await api('GET', '/api/auth/me')).data.user.email, 'test@example.com');
  });

  let draft;
  test('parse uploads image and returns draft + signed url', async () => {
    const form = new FormData();
    form.append('image', jpeg(), 'r.jpg');
    const r = await api('POST', '/api/receipts/parse', { form });
    assert.equal(r.status, 200);
    assert.equal(r.data.draft.merchant_name, 'Mock Market');
    assert.equal(r.data.draft.category, 'Groceries');
    draft = r.data;
    const img = await fetch(base + r.data.image_url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(base + r.data.image_url.replace(/sig=.{4}/, 'sig=0000'))).status, 403);
  });

  test('parse rejects non-images', async () => {
    const form = new FormData();
    form.append('image', new Blob(['hello world, not an image'], { type: 'image/jpeg' }), 'x.jpg');
    assert.equal((await api('POST', '/api/receipts/parse', { form })).status, 415);
  });

  let receiptId;
  test('save verified receipt, reject foreign image key and bad data', async () => {
    const d = draft.draft;
    const payload = { ...d, image_key: draft.image_key, image_hash: draft.image_hash };
    const ok = await api('POST', '/api/receipts', { body: payload });
    assert.equal(ok.status, 201);
    receiptId = ok.data.receipt.receipt_id;
    assert.equal(ok.data.receipt.subtotal, 10.42);

    assert.equal((await api('POST', '/api/receipts', { body: { ...payload, image_key: 'receipts/999/x.jpg' } })).status, 400);
    const withDiscount = { merchant_name: 'Deal Mart', transaction_date: `${month}-03`, total_amount: 8, category: 'Groceries', line_items: [{ description: 'Cheese', quantity: 1, price: 10 }, { description: 'Coupon', quantity: 1, price: -2 }] };
    const disc = await api('POST', '/api/receipts', { body: withDiscount });
    assert.equal(disc.status, 201);
    const items = (await api('GET', `/api/receipts/${disc.data.receipt.receipt_id}`)).data.receipt.line_items;
    assert.deepEqual(items.map((i) => i.price), [10, -2]);
    assert.equal((await api('POST', '/api/receipts', { body: { ...withDiscount, total_amount: -8 } })).status, 400);
    await api('DELETE', `/api/receipts/${disc.data.receipt.receipt_id}`);
    assert.equal((await api('POST', '/api/receipts', { body: { ...payload, transaction_date: '2024-02-31' } })).status, 400);
    assert.equal((await api('POST', '/api/receipts', { body: { ...payload, category: 'Hax' } })).status, 400);

    const again = new FormData();
    again.append('image', jpeg(), 'r.jpg');
    assert.equal((await api('POST', '/api/receipts/parse', { form: again })).data.duplicate_of, receiptId);
  });

  test('list, detail, update, filters', async () => {
    const list = await api('GET', '/api/receipts');
    assert.equal(list.data.count, 1);
    const detail = await api('GET', `/api/receipts/${receiptId}`);
    assert.equal(detail.data.receipt.line_items.length, 2);
    assert.ok(detail.data.receipt.image_url);
    const upd = await api('PUT', `/api/receipts/${receiptId}`, {
      body: { merchant_name: 'Corner Cafe', transaction_date: `${month}-01`, currency: 'GBP', total_amount: 20, category: 'Dining', line_items: [] },
    });
    assert.equal(upd.status, 200);
    assert.equal((await api('GET', '/api/receipts?category=Dining')).data.count, 1);
    assert.equal((await api('GET', '/api/receipts?category=Groceries')).data.count, 0);
    assert.equal((await api('GET', '/api/receipts?q=cafe')).data.count, 1);
  });

  test('analytics, budget, insights, csv', async () => {
    await api('PUT', '/api/budget', { body: { amount: 500 } });
    const m = await api('GET', `/api/monthly?month=${month}`);
    assert.equal(m.data.total, 20);
    assert.equal(m.data.budget, 500);
    assert.equal(m.data.categories[0].category, 'Dining');
    const d = await api('GET', `/api/daily?month=${month}`);
    assert.equal(d.data.days[0].total, 20);
    const y = await api('GET', `/api/yearly?year=${month.slice(0, 4)}`);
    assert.equal(y.data.months.length, 12);
    assert.equal(y.data.total, 20);
    assert.equal((await api('GET', '/api/monthly?month=2024-13')).status, 400);

    const ins = await api('POST', '/api/insights/refresh', { body: {} });
    assert.equal(ins.status, 200);
    assert.ok(ins.data.insights.summary_headline);
    assert.match(ins.data.insights.summary_headline, /20\.00/);
    assert.ok(['under_control', 'normal', 'high_alert'].includes(ins.data.insights.spending_velocity));

    const csv = await api('GET', '/api/receipts/export.csv');
    assert.match(csv.res.headers.get('content-type'), /text\/csv/);
    assert.match(csv.data, /Corner Cafe/);
  });

  test('recurring expense analysis requires three similar recent charges', async () => {
    const now = new Date();
    for (let monthsAgo = 2; monthsAgo >= 0; monthsAgo--) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)).toISOString().slice(0, 10);
      const saved = await api('POST', '/api/receipts', {
        body: { merchant_name: 'Monthly Plan', transaction_date: date, currency: 'GBP', total_amount: 9.99, category: 'Utilities' },
      });
      assert.equal(saved.status, 201);
    }
    const { expenses } = (await api('GET', '/api/recurring')).data;
    const plan = expenses.find((expense) => expense.merchant_name === 'Monthly Plan');
    assert.ok(plan);
    assert.equal(plan.cadence, 'monthly');
    assert.equal(plan.occurrence_count, 3);
  });

  test('CSV neutralises formula injection and users are isolated', async () => {
    await api('POST', '/api/receipts', {
      body: { merchant_name: '=HYPERLINK("x")', transaction_date: `${month}-02`, total_amount: 5, category: 'Other' },
    });
    assert.match((await api('GET', '/api/receipts/export.csv')).data, /"'=HYPERLINK/);

    const other = await api('POST', '/api/auth/register', { body: { email: 'b@example.com', password: 'password123' }, auth: false });
    const saved = token;
    token = other.data.token;
    assert.equal((await api('GET', `/api/receipts/${receiptId}`)).status, 404);
    assert.equal((await api('DELETE', `/api/receipts/${receiptId}`)).status, 404);
    assert.equal((await api('GET', '/api/receipts')).data.count, 0);
    token = saved;
  });

  test('delete receipt', async () => {
    assert.equal((await api('DELETE', `/api/receipts/${receiptId}`)).status, 204);
    assert.equal((await api('GET', `/api/receipts/${receiptId}`)).status, 404);
  });

  test('profile: country/currency are chosen once, then locked', async () => {
    const countries = await api('GET', '/api/countries', { auth: false });
    assert.ok(countries.data.countries.find((c) => c.code === 'JP' && c.currency === 'JPY'));

    assert.equal((await api('PUT', '/api/profile', { body: { display_name: 'No country' } })).status, 400);
    assert.equal((await api('PUT', '/api/profile', { body: { country: 'ZZ' } })).status, 400);
    assert.equal((await api('PUT', '/api/profile', { body: { country: 'JP', currency: 'XXX' } })).status, 400);

    const upd = await api('PUT', '/api/profile', { body: { display_name: '  Alex  ', country: 'JP' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.profile.currency, 'JPY');
    assert.equal(upd.data.profile.display_name, 'Alex');
    assert.equal((await api('GET', '/api/auth/me')).data.user.country, 'JP');

    const form = new FormData();
    form.append('image', jpeg(), 'r2.jpg');
    assert.equal((await api('POST', '/api/receipts/parse', { form })).data.draft.currency, 'JPY');

    // Locked: neither the country nor the currency can change, but the name still can
    assert.equal((await api('PUT', '/api/profile', { body: { country: 'GB' } })).status, 403);
    assert.equal((await api('PUT', '/api/profile', { body: { country: 'JP', currency: 'USD' } })).status, 403);
    const rename = await api('PUT', '/api/profile', { body: { display_name: 'Sam', country: 'JP', currency: 'JPY' } });
    assert.equal(rename.status, 200);
    assert.equal(rename.data.profile.display_name, 'Sam');
    assert.equal(rename.data.profile.currency, 'JPY');
    assert.equal((await api('GET', '/api/monthly')).data.currency, 'JPY');
  });

  test('admin: restricted to ADMIN_EMAILS, aggregate usage and user list', async () => {
    assert.equal((await api('GET', '/api/auth/me')).data.user.is_admin, true);

    const other = await api('POST', '/api/auth/register', { body: { email: 'plain@example.com', password: 'password123' }, auth: false });
    const saved = token;
    token = other.data.token;
    assert.equal(other.data.user.is_admin, false);
    assert.equal((await api('GET', '/api/admin/overview')).status, 403);
    assert.equal((await api('GET', '/api/admin/users')).status, 403);
    token = saved;
    assert.equal((await api('GET', '/api/admin/overview', { auth: false })).status, 401);

    const ov = (await api('GET', '/api/admin/overview')).data;
    assert.ok(ov.users.total >= 2);
    assert.ok(ov.receipts.total >= 1);
    assert.ok(ov.ai.parse.calls >= 3 && ov.ai.parse.ok >= 3, 'scans were logged');
    assert.equal(ov.ai.models[0].model, 'mock');
    assert.equal(ov.series.length, 30);
    assert.ok(ov.users.active_24h >= 1, 'last_seen_at is recorded');
    assert.ok(ov.system.db_bytes > 0);
    assert.ok(!JSON.stringify(ov).includes('Corner Cafe'), 'no receipt contents leak');

    const list = (await api('GET', '/api/admin/users?q=plain&sort=email&order=asc')).data;
    assert.equal(list.total, 1);
    assert.equal(list.users[0].email, 'plain@example.com');
    assert.equal(list.users[0].receipts, 0);
    assert.equal((await api('GET', '/api/admin/users?sort=password_hash')).status, 400);
  });

  test('delete account requires the password and removes data', async () => {
    assert.equal((await api('DELETE', '/api/profile', { body: { password: 'wrong-password' } })).status, 403);
    assert.equal((await api('DELETE', '/api/profile', { body: { password: 'password123' } })).status, 204);
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'test@example.com', password: 'password123' }, auth: false })).status, 401);
  });
});
