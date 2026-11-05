import jwt from 'jsonwebtoken';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from './config.js';
import { query } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const signToken = (user) =>
  jwt.sign({ sub: String(user.user_id) }, config.jwtSecret, { expiresIn: '14d' });

let verifier;
const cognitoVerifier = () =>
  (verifier ??= CognitoJwtVerifier.create({
    userPoolId: config.cognito.userPoolId,
    clientId: config.cognito.clientIds,
    tokenUse: 'id',
  }));

const subToUserId = new Map(); // avoids a DB lookup on every request

// First request after Cognito sign-up provisions the local profile row
async function userIdForCognito(payload) {
  const cached = subToUserId.get(payload.sub);
  if (cached) return cached;
  const { rows } = await query(
    `INSERT INTO users (email, cognito_sub, currency) VALUES ($1,$2,$3)
     ON CONFLICT (cognito_sub) DO UPDATE SET email = EXCLUDED.email RETURNING user_id`,
    [String(payload.email).toLowerCase(), payload.sub, config.defaultCurrency],
  );
  subToUserId.set(payload.sub, rows[0].user_id);
  return rows[0].user_id;
}

export const isAdminEmail = (email) => config.adminEmails.includes(String(email ?? '').toLowerCase());

// Records activity for the admin dashboard, at most once every 5 minutes per user
const lastSeenWrite = new Map();
function touchLastSeen(userId) {
  const now = Date.now();
  if (now - (lastSeenWrite.get(userId) ?? 0) < 5 * 60 * 1000) return;
  lastSeenWrite.set(userId, now);
  query('UPDATE users SET last_seen_at = now() WHERE user_id = $1', [userId]).catch(() => {});
}

export const forgetCognitoUser = (sub) => subToUserId.delete(sub);

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    if (config.authMode === 'cognito') {
      const payload = await cognitoVerifier().verify(token);
      if (!payload.email) throw new Error('missing email claim');
      req.cognito = { sub: payload.sub, username: payload['cognito:username'] };
      req.userId = await userIdForCognito(payload);
    } else {
      req.userId = Number(jwt.verify(token, config.jwtSecret).sub);
    }
    touchLastSeen(req.userId);
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

export async function requireAdmin(req, _res, next) {
  try {
    const { rows } = await query('SELECT email FROM users WHERE user_id = $1', [req.userId]);
    if (!rows[0] || !isAdminEmail(rows[0].email)) throw new HttpError(403, 'Admin access required');
    next();
  } catch (err) {
    next(err);
  }
}
