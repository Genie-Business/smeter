// Support tickets (SM-SUP-001), open to tenants and property owners.
import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { badRequest, unauthorized } from '../util/errors.js';
import { parse } from '../util/http.js';

export const supportRoutes = Router();

export const CATEGORIES = {
  payment: { label: 'Payment or vending', department: 'finance' },
  billing: { label: 'Billing or pricing', department: 'finance' },
  hardware: { label: 'Meter hardware', department: 'technical' },
  connectivity: { label: 'Meter offline / no data', department: 'technical' },
  tamper: { label: 'Tampering or safety', department: 'technical' },
  other: { label: 'Something else', department: 'technical' },
};

supportRoutes.use(async (req, _res, next) => {
  try {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    req.claims = await verifyAccessToken(token);
    if (req.claims.role !== 'tenant' && req.claims.role !== 'landlord') throw unauthorized();
    next();
  } catch (err) {
    next(err);
  }
});

supportRoutes.get('/categories', (_req, res) => {
  res.json({ categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c })) });
});

supportRoutes.post('/tickets', async (req, res) => {
  const body = parse(
    z.object({
      category: z.enum(Object.keys(CATEGORIES)),
      meterId: z.string().trim().optional(),
      description: z.string().trim().min(10, 'Tell us a little more about the issue').max(2000),
    }),
    req.body,
  );
  const { role, sub } = req.claims;
  // Tenants report on their own meter; owners must name one of theirs.
  const meterId = role === 'tenant' ? sub : body.meterId;
  if (!meterId) throw badRequest('Select the meter this is about', { meterId: 'Required' });
  if (role === 'landlord') {
    const owned = await db().get(
      "SELECT 1 FROM meters WHERE meter_id = ? AND landlord_id = ? AND status != 'removed'",
      meterId, Number(sub),
    );
    if (!owned) throw badRequest('That meter is not on your account', { meterId: 'Unknown meter' });
  }
  const ticketRef = `SMT-${new Date().getFullYear()}-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  const department = CATEGORIES[body.category].department;
  await db().run(
    `INSERT INTO support_tickets (ticket_ref, reporter_type, reporter_id, meter_id, category, department, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ticketRef, role, String(sub), meterId, body.category, department, body.description,
  );
  res.status(201).json({ ticket: { ticketRef, meterId, category: body.category, department, status: 'open' } });
});

supportRoutes.get('/tickets', async (req, res) => {
  const { role, sub } = req.claims;
  const rows = await db().all(
    `SELECT ticket_ref, meter_id, category, department, description, status, created_at FROM support_tickets
     WHERE reporter_type = ? AND reporter_id = ? ORDER BY id DESC LIMIT 50`,
    role, String(sub),
  );
  res.json({
    data: rows.map((t) => ({
      ticketRef: t.ticket_ref,
      meterId: t.meter_id,
      category: t.category,
      department: t.department,
      description: t.description,
      status: t.status,
      createdAt: t.created_at,
    })),
  });
});
