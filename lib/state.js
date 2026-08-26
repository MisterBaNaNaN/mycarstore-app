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
    clientId: a.client_id,
    reminderSent: !!a.reminder_sent
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

function docTotalFromRow(entry) {
  const items = parseJsonSafe(entry.items, []);
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  let discount = 0;
  if (entry.discount_type === 'percent') discount = subtotal * ((entry.discount_value || 0) / 100);
  else if (entry.discount_type === 'fixed') discount = Math.min(subtotal, entry.discount_value || 0);
  return Math.max(0, subtotal - discount);
}

function monthKey(dateStr) {
  return (dateStr || '').slice(0, 7);
}

/** Last 6 months (oldest first) of revenue, RDV volume, unpaid invoices and top services. */
function getReports() {
  const today = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }

  const revenueByMonth = {};
  months.forEach((m) => { revenueByMonth[m] = 0; });
  let totalRevenueAllTime = 0;
  let totalUnpaid = 0;
  const unpaidRows = [];

  db.prepare('SELECT * FROM invoices').all().forEach((inv) => {
    const total = docTotalFromRow(inv);
    if (inv.statut === 'payée') {
      totalRevenueAllTime += total;
      const m = monthKey(inv.date);
      if (m in revenueByMonth) revenueByMonth[m] += total;
    } else {
      totalUnpaid += total;
      unpaidRows.push({ id: inv.id, clientId: inv.client_id, date: inv.date, total });
    }
  });

  const clientStmt = db.prepare('SELECT nom FROM clients WHERE id = ?');
  const unpaidInvoices = unpaidRows
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map((inv) => ({ ...inv, clientNom: (clientStmt.get(inv.clientId) || {}).nom || '—' }));

  const apptsByMonth = {};
  months.forEach((m) => { apptsByMonth[m] = 0; });
  const statusCounts = { en_attente: 0, confirme: 0, annule: 0 };
  const serviceCounts = {};

  db.prepare('SELECT * FROM appointments').all().forEach((a) => {
    const m = monthKey(a.date);
    if (m in apptsByMonth) apptsByMonth[m] += 1;
    if (a.status in statusCounts) statusCounts[a.status] += 1;
    if (a.status !== 'annule') {
      parseJsonSafe(a.services, []).forEach((s) => { serviceCounts[s] = (serviceCounts[s] || 0) + 1; });
    }
  });

  const topServices = Object.entries(serviceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));

  return {
    months,
    revenueByMonth,
    apptsByMonth,
    totalRevenueAllTime,
    totalUnpaid,
    unpaidInvoices,
    statusCounts,
    topServices,
    clientCount: db.prepare('SELECT COUNT(*) n FROM clients').get().n
  };
}

module.exports = {
  getSiteStatus,
  getAdminState,
  bumpVersion,
  parseJsonSafe,
  findMatchingClient,
  getTakenSlots,
  getReports
};
