const env = process.env;
const isProd = env.NODE_ENV === 'production';

// local = built-in email/password + self-signed JWT (dev & tests); cognito = Amazon Cognito user pool
const authMode = env.AUTH_MODE || 'local';

if (authMode === 'local' && isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET (>= 32 chars) is required in production with AUTH_MODE=local');
}
if (authMode === 'cognito' && (!env.COGNITO_USER_POOL_ID || !env.COGNITO_CLIENT_ID?.trim())) {
  throw new Error('COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required with AUTH_MODE=cognito');
}

export const config = {
  isProd,
  authMode,
  cognito: {
    userPoolId: env.COGNITO_USER_POOL_ID || '',
    clientIds: (env.COGNITO_CLIENT_ID || '').split(',').map((s) => s.trim()).filter(Boolean), // web + iOS app clients
    region: env.AWS_REGION || 'us-east-1',
  },
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  // CloudFront adds this header to origin requests; when set, direct hits on the EC2 are rejected
  originVerifySecret: env.ORIGIN_VERIFY_SECRET || '',
  port: Number(env.PORT) || 4000,
  trustProxyHops: Number(env.TRUST_PROXY_HOPS ?? 1), // CloudFront -> api = 1
  databaseUrl: env.DATABASE_URL || 'postgres://ledger:ledger@localhost:5432/ledgerai',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  corsOrigin: env.CORS_ORIGIN || '', // empty = same-origin only (Vite proxy / CloudFront serve /api)
  storage: {
    driver: env.STORAGE_DRIVER || 'local', // local | s3
    localDir: env.LOCAL_UPLOAD_DIR || './uploads',
    s3Bucket: env.S3_BUCKET || '',
    s3Region: env.AWS_REGION || 'us-east-1',
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.5-flash',
    fallbackModel: env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite', // used if the primary is overloaded
    timeoutMs: Number(env.GEMINI_TIMEOUT_MS) || 20000,
    mock: env.MOCK_AI === 'true',
  },
  maxUploadBytes: 8 * 1024 * 1024,
  defaultCurrency: env.DEFAULT_CURRENCY || 'GBP',
};

export const CATEGORIES = [
  'Groceries',
  'Dining',
  'Transport',
  'Utilities',
  'Entertainment',
  'Shopping',
  'Other',
];
