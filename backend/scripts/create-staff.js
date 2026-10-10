// Create an admin-dashboard account:
//   npm run staff:create -- <email> <name> <password> [owner|editor]
import { db } from '../src/db.js';
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
const existing = db().prepare('SELECT id FROM staff WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db().prepare('UPDATE staff SET name = ?, password_hash = ?, role = ? WHERE id = ?').run(name, await hashPassword(password), role, existing.id);
  console.log(`Updated ${email} (${role})`);
} else {
  db().prepare('INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(email.toLowerCase(), name, await hashPassword(password), role);
  console.log(`Created ${email} (${role})`);
}
