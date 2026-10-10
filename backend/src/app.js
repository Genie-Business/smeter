import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { authRoutes } from './routes/auth.js';
import { landlordRoutes } from './routes/landlord.js';
import { payPages, webhookRoutes } from './routes/payments.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';
import { supportRoutes } from './routes/support.js';
import { tenantRoutes } from './routes/tenant.js';
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

  app.get('/health', (_req, res) => {
    db().prepare('SELECT 1').get();
    res.json({ ok: true, geni: config.geni.mode, payments: config.payments.provider, sms: config.sms.provider });
  });

  app.use('/v1/auth', authRoutes);
  app.use('/v1/landlord', landlordRoutes);
  app.use('/v1/tenant', tenantRoutes);
  app.use('/v1/support', supportRoutes);
  app.use('/v1/public', publicRoutes);
  app.use('/v1/staff', staffRoutes);
  app.use('/pay', payPages);

  // Images uploaded from the admin dashboard (immutable, random names).
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, index: false }));

  // Optional static hosting for the website (the admin dashboard lives at /admin).
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
