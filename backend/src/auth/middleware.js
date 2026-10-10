import { db } from '../db.js';
import { forbidden, unauthorized } from '../util/errors.js';
import { verifyAccessToken } from './tokens.js';

async function authenticate(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  return verifyAccessToken(token);
}

export function requireLandlord() {
  return async (req, _res, next) => {
    try {
      const claims = await authenticate(req);
      if (claims.role !== 'landlord') throw forbidden();
      const landlord = await db().get('SELECT * FROM landlords WHERE id = ?', Number(claims.sub));
      if (!landlord) throw unauthorized();
      req.landlord = landlord;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** smeter team member (admin dashboard). `role: 'owner'` limits to account owners. */
export function requireStaff({ role } = {}) {
  return async (req, _res, next) => {
    try {
      const claims = await authenticate(req);
      if (claims.role !== 'staff') throw forbidden();
      const staff = await db().get('SELECT id, email, name, role FROM staff WHERE id = ?', Number(claims.sub));
      if (!staff) throw unauthorized();
      if (role && staff.role !== role) throw forbidden('Only account owners can do this');
      req.staff = staff;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireTenant() {
  return async (req, _res, next) => {
    try {
      const claims = await authenticate(req);
      if (claims.role !== 'tenant') throw forbidden();
      const meter = await db().get("SELECT * FROM meters WHERE meter_id = ? AND status = 'active'", claims.sub);
      if (!meter) throw unauthorized('This meter is no longer linked to your account');
      req.meter = meter;
      next();
    } catch (err) {
      next(err);
    }
  };
}
