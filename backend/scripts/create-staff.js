// Create an admin-dashboard account:
//   npm run staff:create -- <email> <name> <password> [owner|editor]
// Uses DATABASE_URL when set (e.g. Neon), otherwise the local PGlite database.
import { closeDb, db } from '../src/db.js';
import { hashPassword } from '../src/auth/password.js';

const [email, name, password, role = 'owner'] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('usage: npm run staff:create -- <email> <name> <password> [owner|editor]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Password must be at least 10 characters');
  process.exit(1);
}
if (!['owner', 'editor'].includes(role)) {
  console.error('Role must be owner or editor');
  process.exit(1);
}
const hash = await hashPassword(password);
const existing = await db().get('SELECT id FROM staff WHERE email = ?', email.toLowerCase());
if (existing) {
  await db().run('UPDATE staff SET name = ?, password_hash = ?, role = ? WHERE id = ?', name, hash, role, existing.id);
  console.log(`Updated ${email} (${role})`);
} else {
  await db().run('INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, ?)', email.toLowerCase(), name, hash, role);
  console.log(`Created ${email} (${role})`);
}
await closeDb();
