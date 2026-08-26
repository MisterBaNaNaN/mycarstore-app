const path = require('node:path');
const express = require('express');
const db = require('./lib/db');
const state = require('./lib/state');
const auth = require('./lib/auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

function toJsonArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}
function toItemsArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((it) => it && typeof it.label === 'string' && it.label.trim())
    .map((it) => ({
      label: String(it.label).trim(),
      qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
      price: Number(it.price) >= 0 ? Number(it.price) : 0
    }));
}
function str(v) { return typeof v === 'string' ? v : ''; }

/* ---------------------------------------------------------------------- */
/* Public endpoints                                                       */
/* ---------------------------------------------------------------------- */

app.get('/api/public-status', (req, res) => {
  res.json(state.getSiteStatus());
});

app.post('/api/appointments', (req, res) => {
  const b = req.body || {};
  if (!str(b.nom).trim() || !str(b.tel).trim() || !str(b.email).trim() || !str(b.date).trim() || !str(b.creneau).trim()) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }
  const services = toJsonArray(b.services);
  if (services.length === 0) {
    res.status(400).json({ error: 'missing_services' });
    return;
  }
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO appointments
      (created_at, nom, tel, email, marque, modele, annee, km, immat, services, message, pret, date, creneau, flexible, contactpref, status, client_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', NULL)
  `).run(
    createdAt, str(b.nom).trim(), str(b.tel).trim(), str(b.email).trim(),
    str(b.marque).trim(), str(b.modele).trim(), str(b.annee).trim(), str(b.km).trim(), str(b.immat).trim(),
    JSON.stringify(services), str(b.message).trim(), b.pret ? 1 : 0,
    str(b.date).trim(), str(b.creneau).trim(), b.flexible ? 1 : 0, str(b.contactpref).trim()
  );
  state.bumpVersion();
  res.status(201).json({ id: result.lastInsertRowid });
});

/* ---------------------------------------------------------------------- */
/* Auth endpoints                                                         */
/* ---------------------------------------------------------------------- */

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'missing_fields' }); return; }
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !auth.verifyPassword(password, user.password_salt, user.password_hash)) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const { token } = auth.createSessionToken(user.id);
  auth.setSessionCookie(res, token, isProd);
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const cookies = auth.parseCookies(req.headers.cookie);
  auth.destroySession(cookies[auth.COOKIE_NAME]);
  auth.clearSessionCookie(res, isProd);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const cookies = auth.parseCookies(req.headers.cookie);
  const user = auth.getUserForToken(cookies[auth.COOKIE_NAME]);
  if (!user) { res.status(401).json({ error: 'unauthenticated' }); return; }
  res.json({ username: user.username });
});

/* ---------------------------------------------------------------------- */
/* Admin endpoints (auth required)                                        */
/* ---------------------------------------------------------------------- */

const adminRouter = express.Router();
adminRouter.use(auth.requireAuth);

adminRouter.get('/state', (req, res) => {
  res.json(state.getAdminState());
});

adminRouter.post('/status', (req, res) => {
  const b = req.body || {};
  const mode = ['open', 'vacation', 'closed_today'].includes(b.mode) ? b.mode : 'open';
  const vacationUntil = mode === 'vacation' ? str(b.vacationUntil).trim() || null : null;
  const closedTodayDate = mode === 'closed_today' ? str(b.closedTodayDate).trim() || null : null;
  db.prepare('UPDATE site_state SET mode = ?, vacation_until = ?, closed_today_date = ?, version = version + 1 WHERE id = 1')
    .run(mode, vacationUntil, closedTodayDate);
  res.json({ ok: true });
});

adminRouter.patch('/appointments/:id', (req, res) => {
  const id = Number(req.params.id);
  const status = req.body && req.body.status;
  if (!['en_attente', 'confirme', 'annule'].includes(status)) { res.status(400).json({ error: 'bad_status' }); return; }
  const info = db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.patch('/appointments/:id/link', (req, res) => {
  const id = Number(req.params.id);
  const clientId = Number(req.body && req.body.clientId);
  if (!clientId) { res.status(400).json({ error: 'bad_client_id' }); return; }
  const info = db.prepare('UPDATE appointments SET client_id = ? WHERE id = ?').run(clientId, id);
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.post('/appointments/:id/convert-to-client', (req, res) => {
  const id = Number(req.params.id);
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) { res.status(404).json({ error: 'not_found' }); return; }
  const createdAt = new Date().toISOString();
  const clientResult = db.prepare(`
    INSERT INTO clients (created_at, nom, tel, email, adresse, tags, notes)
    VALUES (?, ?, ?, ?, '', '[]', ?)
  `).run(createdAt, appt.nom, appt.tel, appt.email, appt.message || '');
  const clientId = clientResult.lastInsertRowid;
  if (appt.marque || appt.modele) {
    db.prepare(`
      INSERT INTO vehicules (client_id, marque, modele, annee, km, immat, carburant, vin, prochain_ct, derniere_revision)
      VALUES (?, ?, ?, ?, ?, ?, '', '', '', '')
    `).run(clientId, appt.marque || '', appt.modele || '', appt.annee || '', appt.km || '', appt.immat || '');
  }
  db.prepare('UPDATE appointments SET client_id = ? WHERE id = ?').run(clientId, id);
  res.status(201).json({ clientId });
});

adminRouter.post('/clients', (req, res) => {
  const b = req.body || {};
  if (!str(b.nom).trim()) { res.status(400).json({ error: 'missing_nom' }); return; }
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO clients (created_at, nom, tel, email, adresse, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?, '')
  `).run(createdAt, str(b.nom).trim(), str(b.tel).trim(), str(b.email).trim(), str(b.adresse).trim(), JSON.stringify(toJsonArray(b.tags)));
  res.status(201).json({ id: result.lastInsertRowid });
});

adminRouter.patch('/clients/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (!str(b.nom).trim()) { res.status(400).json({ error: 'missing_nom' }); return; }
  const info = db.prepare(`
    UPDATE clients SET nom = ?, tel = ?, email = ?, adresse = ?, tags = ? WHERE id = ?
  `).run(str(b.nom).trim(), str(b.tel).trim(), str(b.email).trim(), str(b.adresse).trim(), JSON.stringify(toJsonArray(b.tags)), id);
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.patch('/clients/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('UPDATE clients SET notes = ? WHERE id = ?').run(str(req.body && req.body.notes), id);
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.delete('/clients/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE appointments SET client_id = NULL WHERE client_id = ?').run(id);
  const info = db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.post('/clients/:id/vehicules', (req, res) => {
  const clientId = Number(req.params.id);
  const b = req.body || {};
  if (!str(b.marque).trim()) { res.status(400).json({ error: 'missing_marque' }); return; }
  const result = db.prepare(`
    INSERT INTO vehicules (client_id, marque, modele, annee, km, immat, carburant, vin, prochain_ct, derniere_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(clientId, str(b.marque).trim(), str(b.modele).trim(), str(b.annee).trim(), str(b.km).trim(), str(b.immat).trim(), str(b.carburant).trim(), str(b.vin).trim(), str(b.prochainCT).trim(), str(b.derniereRevision).trim());
  res.status(201).json({ id: result.lastInsertRowid });
});

adminRouter.delete('/vehicules/:id', (req, res) => {
  const info = db.prepare('DELETE FROM vehicules WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

function createDoc(table, req, res, defaultStatut) {
  const clientId = Number(req.params.id);
  const b = req.body || {};
  const items = toItemsArray(b.items);
  if (items.length === 0) { res.status(400).json({ error: 'missing_items' }); return; }
  const vehiculeId = b.vehiculeId ? Number(b.vehiculeId) : null;
  const date = str(b.date).trim() || new Date().toISOString().slice(0, 10);
  const result = db.prepare(`
    INSERT INTO ${table} (client_id, vehicule_id, date, statut, items) VALUES (?, ?, ?, ?, ?)
  `).run(clientId, vehiculeId, date, defaultStatut, JSON.stringify(items));
  res.status(201).json({ id: result.lastInsertRowid });
}

adminRouter.post('/clients/:id/quotes', (req, res) => createDoc('quotes', req, res, 'envoyé'));
adminRouter.post('/clients/:id/invoices', (req, res) => createDoc('invoices', req, res, 'impayée'));

adminRouter.patch('/quotes/:id', (req, res) => {
  const statut = req.body && req.body.statut;
  if (!['envoyé', 'accepté', 'refusé'].includes(statut)) { res.status(400).json({ error: 'bad_statut' }); return; }
  const info = db.prepare('UPDATE quotes SET statut = ? WHERE id = ?').run(statut, Number(req.params.id));
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});
adminRouter.delete('/quotes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM quotes WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.patch('/invoices/:id', (req, res) => {
  const statut = req.body && req.body.statut;
  if (!['impayée', 'payée'].includes(statut)) { res.status(400).json({ error: 'bad_statut' }); return; }
  const info = db.prepare('UPDATE invoices SET statut = ? WHERE id = ?').run(statut, Number(req.params.id));
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});
adminRouter.delete('/invoices/:id', (req, res) => {
  const info = db.prepare('DELETE FROM invoices WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

adminRouter.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const userRow = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(currentPassword, userRow.password_salt, userRow.password_hash)) {
    res.status(401).json({ error: 'wrong_password' });
    return;
  }
  const { hash, salt } = auth.hashPassword(newPassword);
  db.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, req.user.id);
  res.json({ ok: true });
});

app.use('/api/admin', adminRouter);

/* ---------------------------------------------------------------------- */

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`MyCarStore en écoute sur http://localhost:${PORT}`);
});
