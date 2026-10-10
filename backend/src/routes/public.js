// Unauthenticated endpoints used by the marketing website and the app shell.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { getContent } from '../services/content.js';
import { parse } from '../util/http.js';
import { normalizePhone } from '../util/phone.js';
import { rateLimit } from '../util/rateLimit.js';

export const publicRoutes = Router();

// Website + app copy (defaults merged with admin edits). Short cache so edits
// show up within a minute without hammering the API.
publicRoutes.get('/content/:key', (req, res) => {
  const { data, version, updatedAt } = getContent(req.params.key);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ data, version, updatedAt });
});

const leadLimiter = rateLimit({ key: 'lead', limit: 6, windowMs: 60 * 60 * 1000 });

// "Book a free site survey" on the property-owner onboarding page.
publicRoutes.post('/owner-leads', leadLimiter, (req, res) => {
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2, 'Enter your name').max(120),
      phone: z.string().trim(),
      email: z.union([z.string().trim().toLowerCase().email('Enter a valid email'), z.literal('')]).optional(),
      city: z.string().trim().max(80).optional(),
      propertyType: z.enum(['apartments', 'estate', 'commercial', 'house', 'other']).optional(),
      units: z.coerce.number().int().min(1).max(10000).optional(),
      message: z.string().trim().max(1000).optional(),
      // Honeypot: real visitors never fill this hidden field.
      website: z.string().max(0, 'Spam detected').optional(),
    }),
    req.body,
  );
  const phone = normalizePhone(body.phone);
  if (!phone) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Enter a valid phone number', details: { phone: 'Invalid' } } });
  }
  db()
    .prepare(
      `INSERT INTO owner_leads (full_name, phone, email, city, property_type, units, message) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(body.fullName, phone, body.email || null, body.city ?? null, body.propertyType ?? null, body.units ?? null, body.message ?? null);
  res.status(201).json({ ok: true });
});

const notifyLimiter = rateLimit({ key: 'notify', limit: 10, windowMs: 60 * 60 * 1000 });

// "Tell me when the app is in the stores."
publicRoutes.post('/notify', notifyLimiter, (req, res) => {
  const body = parse(
    z.object({
      contact: z.string().trim().min(5, 'Enter a phone number or email').max(120),
      platform: z.enum(['android', 'ios', 'any']).default('any'),
      website: z.string().max(0).optional(),
    }),
    req.body,
  );
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.contact);
  const contact = isEmail ? body.contact.toLowerCase() : normalizePhone(body.contact);
  if (!contact) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Enter a valid phone number or email' } });
  }
  db().prepare('INSERT OR IGNORE INTO notify_requests (contact, platform) VALUES (?, ?)').run(contact, body.platform);
  res.status(201).json({ ok: true });
});
