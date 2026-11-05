// Minimal App Store Connect API client (no dependencies; Node 18+).
//
// Credentials come from the environment so the .p8 key never has to live in the repo:
//   ASC_KEY_PATH    absolute path to AuthKey_XXXXXXXXXX.p8
//   ASC_KEY_ID      10-character key id
//   ASC_ISSUER_ID   issuer UUID from App Store Connect → Users and Access → Integrations
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = 'https://api.appstoreconnect.apple.com';

const b64url = (input) => Buffer.from(input).toString('base64url');

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (see the header of scripts/asc.mjs)`);
  return value;
}

/** Short-lived (10 min) ES256 JWT. Apple rejects tokens valid for more than 20 minutes. */
export function token() {
  const keyId = need('ASC_KEY_ID');
  const issuer = need('ASC_ISSUER_ID');
  const key = createPrivateKey(readFileSync(need('ASC_KEY_PATH'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(signature)}`;
}

export class AscError extends Error {
  constructor(status, errors) {
    super(errors.map((e) => `${e.status ?? status} ${e.code ?? ''}: ${e.detail ?? e.title}`).join('\n') || `HTTP ${status}`);
    this.status = status;
    this.errors = errors;
  }
}

export async function asc(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new AscError(res.status, json.errors ?? []);
  return json;
}
