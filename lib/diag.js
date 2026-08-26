const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
const users = db.prepare('SELECT username, created_at FROM admin_users').all();
const clients = db.prepare('SELECT COUNT(*) n FROM clients').get().n;
const appointments = db.prepare('SELECT COUNT(*) n FROM appointments').get().n;

console.log('--- Diagnostic MyCarStore ---');
console.log('DB_PATH utilisé   :', dbPath);
console.log('Fichier existe    :', fs.existsSync(dbPath));
console.log('NODE_ENV          :', process.env.NODE_ENV || '(non défini)');
console.log('Comptes admin     :', users.length);
users.forEach((u) => console.log('  -', u.username, '(créé le', u.created_at + ')'));
console.log('Clients en base   :', clients);
console.log('RDV en base       :', appointments);
console.log('------------------------------');
if (!process.env.DB_PATH) {
  console.log('ATTENTION : DB_PATH n\'est pas défini — la base est dans le dossier du projet, donc PAS persistante entre les déploiements sur un hébergeur comme Railway.');
}
