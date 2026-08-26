const db = require('./db');
const { hashPassword } = require('./auth');

const username = process.argv[2] || 'admin';
const newPassword = process.argv[3];

if (!newPassword) {
  console.error('Usage : node lib/reset-password.js <identifiant> <nouveau-mot-de-passe>');
  console.error('Exemple : node lib/reset-password.js admin MonNouveauMotDePasse123');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Le mot de passe doit faire au moins 8 caractères.');
  process.exit(1);
}

const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
if (!user) {
  console.error(`Aucun compte "${username}" trouvé. Comptes existants :`);
  db.prepare('SELECT username FROM admin_users').all().forEach((u) => console.error(' -', u.username));
  process.exit(1);
}

const { hash, salt } = hashPassword(newPassword);
db.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);
console.log(`Mot de passe mis à jour pour "${username}".`);
