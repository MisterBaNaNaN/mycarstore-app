const crypto = require('node:crypto');
const db = require('./db');
const { hashPassword } = require('./auth');

function randomPassword(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  if (count > 0) {
    console.log('Un compte admin existe déjà — seed ignoré.');
    return;
  }
  const username = process.env.SEED_ADMIN_USER || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || randomPassword(12);
  const { hash, salt } = hashPassword(password);
  db.prepare('INSERT INTO admin_users (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, salt, new Date().toISOString());

  console.log('Compte admin créé :');
  console.log('  Identifiant :', username);
  console.log('  Mot de passe :', password);
  console.log('Notez ce mot de passe — il ne sera pas réaffiché. Vous pourrez le changer depuis l\'admin.');
}

seed();
