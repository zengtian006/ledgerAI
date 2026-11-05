import { AuthenticationDetails, CognitoUser, CognitoUserAttribute, CognitoUserPool } from 'amazon-cognito-identity-js';

// With VITE_COGNITO_* set (production build) users sign in through Amazon Cognito.
// Without them (local dev) the API's built-in email/password login is used.
const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
export const COGNITO = Boolean(poolId && clientId);
const pool = COGNITO ? new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId }) : null;

const LOCAL_KEY = 'ledgerai_token';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MESSAGES = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UsernameExistsException: 'An account with this email already exists.',
  CodeMismatchException: 'That code is incorrect.',
  ExpiredCodeException: 'That code has expired. Request a new one.',
  InvalidPasswordException: 'Password must be at least 8 characters with upper and lower case letters and a number.',
  LimitExceededException: 'Too many attempts. Please wait a while and try again.',
  TooManyRequestsException: 'Too many attempts. Please wait a while and try again.',
  TooManyFailedAttemptsException: 'Too many attempts. Please wait a while and try again.',
  InvalidParameterException: 'Please check your details and try again.',
};

function wrap(err) {
  const code = err?.code || err?.name || 'Error';
  return new AuthError(code, MESSAGES[code] ?? err?.message ?? 'Something went wrong. Please try again.');
}

const call = (fn) => new Promise((resolve, reject) => fn(resolve, (e) => reject(wrap(e))));
const cognitoUser = (email) => new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });

async function localPost(path, body) {
  const res = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(String(res.status), data.details?.[0] ?? data.error ?? 'Request failed');
  return data;
}

export const hasSession = () => (COGNITO ? Boolean(pool.getCurrentUser()) : Boolean(localStorage.getItem(LOCAL_KEY)));

// Returns a valid ID token; Cognito refreshes it automatically when it has expired
export function getToken() {
  if (!COGNITO) return Promise.resolve(localStorage.getItem(LOCAL_KEY));
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err, session) => resolve(err || !session?.isValid() ? null : session.getIdToken().getJwtToken()));
  });
}

export function signOut() {
  if (COGNITO) pool.getCurrentUser()?.signOut();
  else localStorage.removeItem(LOCAL_KEY);
}

export async function signIn(email, password) {
  if (!COGNITO) {
    const { token } = await localPost('login', { email, password });
    localStorage.setItem(LOCAL_KEY, token);
    return;
  }
  const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });
  await call((ok, fail) => cognitoUser(email).authenticateUser(details, { onSuccess: ok, onFailure: fail }));
}

// Resolves { confirmed } — Cognito accounts must be confirmed with the emailed code first
export async function signUp(email, password) {
  if (!COGNITO) {
    const { token } = await localPost('register', { email, password });
    localStorage.setItem(LOCAL_KEY, token);
    return { confirmed: true };
  }
  const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email.trim().toLowerCase() })];
  const res = await call((ok, fail) => pool.signUp(email.trim().toLowerCase(), password, attrs, null, (e, r) => (e ? fail(e) : ok(r))));
  return { confirmed: res.userConfirmed };
}

export const confirmSignUp = (email, code) =>
  call((ok, fail) => cognitoUser(email).confirmRegistration(code.trim(), true, (e, r) => (e ? fail(e) : ok(r))));

export const resendCode = (email) => call((ok, fail) => cognitoUser(email).resendConfirmationCode((e, r) => (e ? fail(e) : ok(r))));

export const forgotPassword = (email) =>
  call((ok, fail) => cognitoUser(email).forgotPassword({ onSuccess: ok, onFailure: fail }));

export const resetPassword = (email, code, newPassword) =>
  call((ok, fail) => cognitoUser(email).confirmPassword(code.trim(), newPassword, { onSuccess: ok, onFailure: fail }));

export function changePassword(oldPassword, newPassword) {
  const user = pool.getCurrentUser();
  return call((ok, fail) =>
    user.getSession((err) => {
      if (err) return fail(err);
      user.changePassword(oldPassword, newPassword, (e, r) => (e ? fail(e) : ok(r)));
    }),
  );
}

// Verifies the password again (used before deleting the account); local mode checks it server-side
export async function reauthenticate(email, password) {
  if (!COGNITO) return;
  const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });
  await call((ok, fail) => cognitoUser(email).authenticateUser(details, { onSuccess: ok, onFailure: fail }));
}
