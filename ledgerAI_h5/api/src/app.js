import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import multer from 'multer';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError } from './auth.js';
import authRoutes from './routes/auth.js';
import receiptRoutes from './routes/receipts.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import profileRoutes, { publicCountries } from './routes/profile.js';
import { readLocalImage, verifySignedUrl } from './services/storage.js';
import { aiConfigured } from './services/gemini.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxyHops); // so rate limits see the real client IP
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '200kb' }));

  // Only CloudFront (which injects the secret) may reach the API; /api/health stays open for the local container check
  if (config.originVerifySecret) {
    const expected = Buffer.from(config.originVerifySecret);
    app.use((req, res, next) => {
      if (req.path === '/api/health') return next();
      const got = Buffer.from(String(req.headers['x-origin-verify'] ?? ''));
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) return res.status(403).json({ error: 'Forbidden' });
      next();
    });
  }

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', ai: aiConfigured() });
  });

  app.use(
    '/api/auth',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: 'Too many attempts, try later' } }),
    authRoutes,
  );
  // Local-driver image serving via short-lived HMAC-signed URLs (S3 driver uses presigned URLs instead)
  app.get('/api/files', async (req, res) => {
    const { key, exp, sig } = req.query;
    if (config.storage.driver !== 'local' || !verifySignedUrl(String(key), exp, sig)) {
      throw new HttpError(403, 'Invalid or expired link');
    }
    const ext = String(key).split('.').pop();
    res.type({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }[ext] ?? 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=600');
    res.send(await readLocalImage(String(key)));
  });

  app.use('/api/countries', publicCountries);
  app.use('/api/profile', profileRoutes);
  app.use('/api/admin', adminRoutes); // before analyticsRoutes, which requires auth for every /api path
  app.use('/api/receipts', receiptRoutes);
  app.use('/api', analyticsRoutes);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
