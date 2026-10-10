import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { unauthorized } from '../util/errors.js';

const key = () => new TextEncoder().encode(config.jwtSecret);
const ISSUER = 'smeter';

/**
 * role: 'landlord' (sub = landlord id) | 'tenant' (sub = meter id) |
 * 'staff' (sub = staff id; admin dashboard, short-lived).
 */
export async function signAccessToken({ role, sub }) {
  const ttl = role === 'tenant' ? '30d' : role === 'staff' ? '12h' : '7d';
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(sub))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key());
}

export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, algorithms: ['HS256'] });
    return { role: payload.role, sub: payload.sub };
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
}
