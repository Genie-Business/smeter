import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { authRoutes } from './routes/auth.js';
import { landlordRoutes } from './routes/landlord.js';
import { payPages, webhookRoutes } from './routes/payments.js';
import { publicRoutes } from './routes/public.js';
import { serveUpload, staffRoutes } from './routes/staff.js';
import { supportRoutes } from './routes/support.js';
import { tenantRoutes } from './routes/tenant.js';
import { sweepOnce } from './services/sweeper.js';
import { AppError } from './util/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.get('origin');
    // Auth is bearer tokens (no cookies), so '*' is safe to reflect.
    if (origin && (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*'))) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  // Webhooks need the raw body, so they mount before the JSON parser.
  app.use('/v1/webhooks', webhookRoutes);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    await db().get('SELECT 1');
    res.json({ ok: true, geni: config.geni.mode, payments: config.payments.provider, email: config.email.provider });
  });

  // Payment reconciliation for serverless hosts, called by Vercel Cron with
  // `Authorization: Bearer $CRON_SECRET` (long-running servers use a timer).
  app.get('/internal/sweep', async (req, res) => {
    if (!config.cronSecret || req.get('authorization') !== `Bearer ${config.cronSecret}`) {
      throw new AppError(401, 'unauthorized', 'Unauthorized');
    }
    await sweepOnce();
    res.json({ ok: true });
  });

  app.use('/v1/auth', authRoutes);
  app.use('/v1/landlord', landlordRoutes);
  app.use('/v1/tenant', tenantRoutes);
  app.use('/v1/support', supportRoutes);
  app.use('/v1/public', publicRoutes);
  app.use('/v1/staff', staffRoutes);
  app.use('/pay', payPages);

  // Images uploaded from the admin dashboard (stored in the database).
  app.get('/uploads/:name', serveUpload);

  // Optional static hosting for the website (the admin dashboard lives at /admin).
  // Clean URLs: /product serves product.html, and old /product.html links redirect.
  if (config.siteDir) {
    app.use((req, res, next) => {
      const m = req.method === 'GET' && req.path.match(/^(.*?)(index)?\.html$/);
      if (!m) return next();
      const qs = req.originalUrl.slice(req.path.length);
      res.redirect(301, (m[2] ? m[1] || '/' : m[1]) + qs);
    });
  }
  if (config.siteDir) app.use('/', express.static(config.siteDir, { extensions: ['html'] }));

  app.use((_req, _res, next) => next(new AppError(404, 'not_found', 'Route not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'too_large', message: 'That upload is too large' } });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}
