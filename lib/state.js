const db = require('./db');

function parseJsonSafe(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function getSiteStatus() {
  const row = db.prepare('SELECT mode, vacation_until, closed_today_date FROM site_state WHERE id = 1').get();
  return {
    mode: row.mode,
    vacationUntil: row.vacation_until,
    closedTodayDate: row.closed_today_date
  };
}

function bumpVersion() {
  db.prepare('UPDATE site_state SET version = version + 1 WHERE id = 1').run();
}

function rowToVehicule(v) {
  return {
    id: v.id,
    marque: v.marque, modele: v.modele, annee: v.annee, km: v.km, immat: v.immat,
    carburant: v.carburant, vin: v.vin, prochainCT: v.prochain_ct, derniereRevision: v.derniere_revision
  };
}

function rowToDoc(d) {
  return {
    id: d.id,
    vehiculeId: d.vehicule_id,
    date: d.date,
    statut: d.statut,
    items: parseJsonSafe(d.items, []),
    discountType: d.discount_type || null,
    discountValue: d.discount_value || 0
  };
}

function getAppointments() {
  const rows = db.prepare('SELECT * FROM appointments ORDER BY created_at DESC').all();
  return rows.map((a) => ({
    id: a.id,
    createdAt: a.created_at,
    nom: a.nom, tel: a.tel, email: a.email,
    marque: a.marque, modele: a.modele, annee: a.annee, km: a.km, immat: a.immat,
    services: parseJsonSafe(a.services, []),
    message: a.message,
    pret: !!a.pret,
    date: a.date, creneau: a.creneau,
    flexible: !!a.flexible,
    contactpref: a.contactpref,
    status: a.status,
    clientId: a.client_id
  }));
}

function getClients() {
  const clientRows = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  const vehStmt = db.prepare('SELECT * FROM vehicules WHERE client_id = ?');
  const quoteStmt = db.prepare('SELECT * FROM quotes WHERE client_id = ? ORDER BY date DESC');
  const invoiceStmt = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY date DESC');

  return clientRows.map((c) => ({
    id: c.id,
    createdAt: c.created_at,
    nom: c.nom, tel: c.tel, email: c.email, adresse: c.adresse,
    tags: parseJsonSafe(c.tags, []),
    notes: c.notes,
    vehicules: vehStmt.all(c.id).map(rowToVehicule),
    quotes: quoteStmt.all(c.id).map(rowToDoc),
    invoices: invoiceStmt.all(c.id).map(rowToDoc)
  }));
}

function getAdminState() {
  return {
    status: getSiteStatus(),
    appointments: getAppointments(),
    clients: getClients()
  };
}

function normTel(tel) {
  return (tel || '').replace(/\s+/g, '');
}
function normText(text) {
  return (text || '').trim().toLowerCase();
}

/** Finds an existing client matching by phone, e-mail or exact name. Returns the client row (raw db shape) or null. */
function findMatchingClient(tel, email, nom) {
  const wantTel = normTel(tel);
  const wantEmail = normText(email);
  const wantNom = normText(nom);
  const clients = db.prepare('SELECT * FROM clients').all();
  return clients.find((c) => {
    if (wantTel && normTel(c.tel) === wantTel) return true;
    if (wantEmail && normText(c.email) === wantEmail) return true;
    if (wantNom && normText(c.nom) === wantNom) return true;
    return false;
  }) || null;
}

/** Créneaux already used on a given date by appointments that are not cancelled. */
function getTakenSlots(date) {
  const rows = db.prepare("SELECT creneau FROM appointments WHERE date = ? AND status != 'annule'").all(date);
  return rows.map((r) => r.creneau);
}

module.exports = {
  getSiteStatus,
  getAdminState,
  bumpVersion,
  parseJsonSafe,
  findMatchingClient,
  getTakenSlots
};
