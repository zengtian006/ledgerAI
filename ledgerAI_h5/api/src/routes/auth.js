import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { HttpError, isAdminEmail, requireAuth, signToken } from '../auth.js';
import { config } from '../config.js';

const router = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
});

const publicUser = (u) => ({ user_id: u.user_id, email: u.email, currency: u.currency, display_name: u.display_name ?? null, country: u.country ?? null, is_admin: isAdminEmail(u.email) });

if (config.authMode === 'local') router.post('/register', async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, currency) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO NOTHING RETURNING user_id, email, currency, display_name, country`,
    [email, hash, config.defaultCurrency],
  );
  if (!rows[0]) throw new HttpError(409, 'Email already registered');
  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});

if (config.authMode === 'local') router.post('/login', async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const ok = rows[0] && (await bcrypt.compare(password, rows[0].password_hash));
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT user_id, email, currency, display_name, country FROM users WHERE user_id = $1', [req.userId]);
  if (!rows[0]) throw new HttpError(401, 'User no longer exists');
  res.json({ user: publicUser(rows[0]) });
});

export default router;
