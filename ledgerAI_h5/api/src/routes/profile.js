import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { HttpError, forgetCognitoUser, requireAuth } from '../auth.js';
import { config } from '../config.js';
import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { COUNTRIES, COUNTRY_BY_CODE, CURRENCIES } from '../countries.js';
import { invalidateInsights } from '../services/insights.js';
import { deleteImage } from '../services/storage.js';

export const publicCountries = Router().get('/', (_req, res) => res.json({ countries: COUNTRIES, currencies: CURRENCIES }));

const router = Router();
router.use(requireAuth);

async function loadProfile(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.email, u.display_name, u.country, u.currency, u.created_at,
            (SELECT COUNT(*)::int FROM receipts r WHERE r.user_id = u.user_id) AS receipt_count
       FROM users u WHERE u.user_id = $1`,
    [userId],
  );
  if (!rows[0]) throw new HttpError(401, 'User no longer exists');
  return rows[0];
}

router.get('/', async (req, res) => res.json({ profile: await loadProfile(req.userId) }));

const profileInput = z.object({
  display_name: z.string().trim().max(80).nullish(),
  country: z.string().refine((c) => COUNTRY_BY_CODE.has(c), 'Unknown country').optional(),
  currency: z.string().refine((c) => CURRENCIES.includes(c), 'Unsupported currency').optional(),
});

// Country and currency are chosen once (at sign-up) and then locked, because receipts and totals are in that currency.
// Currency follows the chosen country unless the client explicitly overrides it.
router.put('/', async (req, res) => {
  const input = profileInput.parse(req.body);
  const before = await loadProfile(req.userId);
  const displayName = input.display_name || null;

  if (before.country) {
    const changesRegion = (input.country && input.country !== before.country) || (input.currency && input.currency !== before.currency);
    if (changesRegion) throw new HttpError(403, 'Country and currency are set once and can’t be changed.');
    await query('UPDATE users SET display_name = $2 WHERE user_id = $1', [req.userId, displayName]);
  } else {
    if (!input.country) throw new HttpError(400, 'Please choose your country.');
    const currency = input.currency ?? COUNTRY_BY_CODE.get(input.country).currency;
    // The country IS NULL guard keeps concurrent first-time saves from overwriting each other
    const { rowCount } = await query(
      'UPDATE users SET display_name = $2, country = $3, currency = $4 WHERE user_id = $1 AND country IS NULL',
      [req.userId, displayName, input.country, currency],
    );
    if (!rowCount) throw new HttpError(403, 'Country and currency are set once and can’t be changed.');
    if (before.currency !== currency) await invalidateInsights(req.userId);
  }
  res.json({ profile: await loadProfile(req.userId) });
});

router.delete('/', async (req, res) => {
  // Cognito mode: the web app re-authenticates with the password before calling this
  if (config.authMode === 'local') {
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const { rows } = await query('SELECT password_hash FROM users WHERE user_id = $1', [req.userId]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) throw new HttpError(403, 'Incorrect password');
  }
  const keys = await query('SELECT image_key FROM receipts WHERE user_id = $1 AND image_key IS NOT NULL', [req.userId]);
  await query('DELETE FROM users WHERE user_id = $1', [req.userId]); // cascades receipts, items, budgets, insights
  await Promise.all(keys.rows.map((r) => deleteImage(r.image_key)));
  if (config.authMode === 'cognito') {
    await new CognitoIdentityProviderClient({ region: config.cognito.region }).send(
      new AdminDeleteUserCommand({ UserPoolId: config.cognito.userPoolId, Username: req.cognito.username }),
    );
    forgetCognitoUser(req.cognito.sub);
  }
  res.status(204).end();
});

export default router;
