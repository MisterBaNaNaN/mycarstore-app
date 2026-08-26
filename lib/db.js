const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS site_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'open',
    vacation_until TEXT,
    closed_today_date TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    nom TEXT NOT NULL,
    tel TEXT NOT NULL,
    email TEXT NOT NULL,
    marque TEXT DEFAULT '',
    modele TEXT DEFAULT '',
    annee TEXT DEFAULT '',
    km TEXT DEFAULT '',
    immat TEXT DEFAULT '',
    services TEXT NOT NULL DEFAULT '[]',
    message TEXT DEFAULT '',
    pret INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    creneau TEXT NOT NULL,
    flexible INTEGER NOT NULL DEFAULT 0,
    contactpref TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'en_attente',
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    nom TEXT NOT NULL,
    tel TEXT DEFAULT '',
    email TEXT DEFAULT '',
    adresse TEXT DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS vehicules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    marque TEXT DEFAULT '',
    modele TEXT DEFAULT '',
    annee TEXT DEFAULT '',
    km TEXT DEFAULT '',
    immat TEXT DEFAULT '',
    carburant TEXT DEFAULT '',
    vin TEXT DEFAULT '',
    prochain_ct TEXT DEFAULT '',
    derniere_revision TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    vehicule_id INTEGER REFERENCES vehicules(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'envoyé',
    items TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    vehicule_id INTEGER REFERENCES vehicules(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'impayée',
    items TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    nom TEXT NOT NULL,
    note INTEGER NOT NULL DEFAULT 5,
    texte TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 1
  );
`);

db.exec(`
  INSERT INTO site_state (id, mode, vacation_until, closed_today_date, version)
  SELECT 1, 'open', NULL, NULL, 1
  WHERE NOT EXISTS (SELECT 1 FROM site_state WHERE id = 1);
`);

/* migrations: add columns that may not exist yet on an older database file */
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
addColumnIfMissing('quotes', 'discount_type', "discount_type TEXT");
addColumnIfMissing('quotes', 'discount_value', "discount_value REAL NOT NULL DEFAULT 0");
addColumnIfMissing('invoices', 'discount_type', "discount_type TEXT");
addColumnIfMissing('invoices', 'discount_value', "discount_value REAL NOT NULL DEFAULT 0");
addColumnIfMissing('appointments', 'reminder_sent', "reminder_sent INTEGER NOT NULL DEFAULT 0");

module.exports = db;
