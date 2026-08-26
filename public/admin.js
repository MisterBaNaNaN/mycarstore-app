/* ---------- utils ---------- */
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function todayStr(){
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function fmtFr(dateStr){
  if(!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'});
}
function eur(n){
  return (Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €';
}
function escapeHtml(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function docSubtotal(entry){
  return (entry.items || []).reduce(function(s, it){ return s + (it.qty || 0) * (it.price || 0); }, 0);
}
function docDiscountAmount(entry){
  var subtotal = docSubtotal(entry);
  if(entry.discountType === 'percent') return subtotal * ((entry.discountValue || 0) / 100);
  if(entry.discountType === 'fixed') return Math.min(subtotal, entry.discountValue || 0);
  return 0;
}
function docTotal(entry){
  return Math.max(0, docSubtotal(entry) - docDiscountAmount(entry));
}
function discountLabel(entry){
  if(entry.discountType === 'percent') return '-' + entry.discountValue + '%';
  if(entry.discountType === 'fixed') return '-' + eur(entry.discountValue);
  return '';
}
function findClient(id){
  id = parseInt(id, 10);
  for(var i = 0; i < STATE.clients.length; i++){ if(STATE.clients[i].id === id) return STATE.clients[i]; }
  return null;
}
function findAppt(id){
  id = parseInt(id, 10);
  for(var i = 0; i < STATE.appointments.length; i++){ if(STATE.appointments[i].id === id) return STATE.appointments[i]; }
  return null;
}

var APPT_STATUS_LABEL = {en_attente:'En attente', confirme:'Confirmé', annule:'Annulé'};
var APPT_STATUS_TONE = {en_attente:'tone-new', confirme:'tone-confirmed', annule:'tone-cancelled'};
function apptStatusChip(status){
  return '<span class="chip-status ' + (APPT_STATUS_TONE[status] || 'tone-new') + '"><span class="dot"></span>' + (APPT_STATUS_LABEL[status] || status) + '</span>';
}
function apptStatusActions(a){
  var html = '';
  if(a.status !== 'confirme') html += '<button type="button" class="btn btn-fill" data-action="confirm-appt" data-id="' + a.id + '">Confirmer</button>';
  if(a.status !== 'annule') html += '<button type="button" class="btn btn-line" data-action="cancel-appt" data-id="' + a.id + '">Annuler</button>';
  if(a.status !== 'en_attente') html += '<button type="button" class="btn btn-line" data-action="pending-appt" data-id="' + a.id + '">Remettre en attente</button>';
  return html;
}

/* ---------- API + state ---------- */
var STATE = {status:{mode:'open'}, appointments:[], clients:[]};
var adminState = {tab:'dashboard', clientId:null, calMonth:null};

function api(method, url, body){
  var opts = {method:method, credentials:'include'};
  if(body !== undefined){
    opts.headers = {'Content-Type':'application/json'};
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(function(r){
    if(r.status === 401){ showLoginGate(); throw new Error('unauthenticated'); }
    if(!r.ok){
      return r.json().catch(function(){ return {}; }).then(function(info){
        var err = new Error('api_error');
        err.info = info; err.status = r.status;
        throw err;
      });
    }
    if(r.status === 204) return null;
    return r.json();
  });
}

function refreshState(){
  return api('GET', '/api/admin/state').then(function(data){
    STATE = data;
    renderAdmin();
  });
}

var noticeTimer = null;
function notice(text, tone){
  var el = document.getElementById('adminNotice');
  if(!el){
    el = document.createElement('div');
    el.id = 'adminNotice';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = 'admin-notice show ' + (tone || '');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(function(){ el.classList.remove('show'); }, 3200);
}

function afterAction(promise, okMsg){
  return promise
    .then(function(){ return refreshState(); })
    .then(function(){ if(okMsg) notice(okMsg, 'ok'); })
    .catch(function(err){
      if(err && err.message === 'unauthenticated') return;
      notice('Échec de l\'enregistrement.', 'warn');
    });
}

/* ---------- login flow ---------- */
function showLoginGate(){
  document.getElementById('loginGate').hidden = false;
  document.getElementById('adminApp').hidden = true;
}
function startAdmin(){
  document.getElementById('loginGate').hidden = true;
  document.getElementById('adminApp').hidden = false;
  refreshState();
}

document.getElementById('loginForm').addEventListener('submit', function(e){
  e.preventDefault();
  var form = e.target;
  var errorEl = document.getElementById('loginError');
  errorEl.classList.remove('show');
  fetch('/api/login', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({username: form.username.value, password: form.password.value})
  }).then(function(r){
    if(!r.ok) throw new Error('bad_login');
    return r.json();
  }).then(function(){
    form.reset();
    startAdmin();
  }).catch(function(){
    errorEl.textContent = 'Identifiant ou mot de passe incorrect.';
    errorEl.classList.add('show');
  });
});

fetch('/api/me', {credentials:'include'}).then(function(r){
  if(r.ok) startAdmin(); else showLoginGate();
});

/* ---------- modal helpers ---------- */
function openModal(html){
  closeModal();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = '<div class="modal">' + html + '</div>';
  overlay.addEventListener('click', function(e){ if(e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}
function closeModal(){
  var el = document.getElementById('modalOverlay');
  if(el) el.remove();
}

function openClientForm(client){
  var isEdit = !!client;
  openModal(
    '<h3>' + (isEdit ? 'Modifier le client' : 'Nouveau client') + '</h3>' +
    '<form id="clientForm">' +
      '<div class="field-grid two">' +
        '<div class="field"><label>Nom<span class="req">*</span></label><input type="text" name="nom" required value="' + escapeHtml(client && client.nom || '') + '"></div>' +
        '<div class="field"><label>Téléphone</label><input type="tel" name="tel" value="' + escapeHtml(client && client.tel || '') + '"></div>' +
      '</div>' +
      '<div class="field-grid two">' +
        '<div class="field"><label>E-mail</label><input type="email" name="email" value="' + escapeHtml(client && client.email || '') + '"></div>' +
        '<div class="field"><label>Adresse</label><input type="text" name="adresse" value="' + escapeHtml(client && client.adresse || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>Étiquettes <span style="text-transform:none; letter-spacing:0;">(séparées par des virgules)</span></label><input type="text" name="tags" placeholder="Ex. Flotte pro, VIP" value="' + escapeHtml(client && client.tags ? client.tags.join(', ') : '') + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">' + (isEdit ? 'Enregistrer' : 'Créer le client') + '</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('clientForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var nom = form.nom.value.trim();
    if(!nom) return;
    var payload = {
      nom: nom, tel: form.tel.value.trim(), email: form.email.value.trim(), adresse: form.adresse.value.trim(),
      tags: form.tags.value.split(',').map(function(t){ return t.trim(); }).filter(Boolean)
    };
    var req = isEdit
      ? api('PATCH', '/api/admin/clients/' + client.id, payload)
      : api('POST', '/api/admin/clients', payload).then(function(res){
          adminState.tab = 'client';
          adminState.clientId = res.id;
        });
    afterAction(req);
    closeModal();
  });
}

function openVehicleForm(clientId, vehicle){
  var isEdit = !!vehicle;
  var v = vehicle || {};
  var carburants = ['', 'Essence', 'Diesel', 'Hybride', 'Électrique', 'GPL'];
  openModal(
    '<h3>' + (isEdit ? 'Modifier le véhicule' : 'Ajouter un véhicule') + '</h3>' +
    '<form id="vehForm">' +
      '<div class="field-grid two">' +
        '<div class="field"><label>Marque<span class="req">*</span></label><input type="text" name="marque" required value="' + escapeHtml(v.marque || '') + '"></div>' +
        '<div class="field"><label>Modèle</label><input type="text" name="modele" value="' + escapeHtml(v.modele || '') + '"></div>' +
      '</div>' +
      '<div class="field-grid two">' +
        '<div class="field"><label>Année</label><input type="number" name="annee" min="1970" max="2026" value="' + escapeHtml(v.annee || '') + '"></div>' +
        '<div class="field"><label>Kilométrage</label><input type="number" name="km" min="0" step="1" value="' + escapeHtml(v.km || '') + '"></div>' +
      '</div>' +
      '<div class="field-grid two">' +
        '<div class="field"><label>Immatriculation</label><input type="text" name="immat" value="' + escapeHtml(v.immat || '') + '"></div>' +
        '<div class="field"><label>Carburant</label><select name="carburant">' +
          carburants.map(function(c){ return '<option' + (c === v.carburant ? ' selected' : '') + ' value="' + escapeHtml(c) + '">' + (c || 'Non précisé') + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field-grid"><div class="field"><label>N° de série (VIN)</label><input type="text" name="vin" value="' + escapeHtml(v.vin || '') + '"></div></div>' +
      '<div class="field-grid two">' +
        '<div class="field"><label>Prochain contrôle technique</label><input type="date" name="prochainCT" value="' + escapeHtml(v.prochainCT || '') + '"></div>' +
        '<div class="field"><label>Dernière révision</label><input type="date" name="derniereRevision" value="' + escapeHtml(v.derniereRevision || '') + '"></div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">' + (isEdit ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('vehForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var marque = form.marque.value.trim();
    if(!marque) return;
    var payload = {
      marque: marque, modele: form.modele.value.trim(), annee: form.annee.value.trim(), km: form.km.value.trim(),
      immat: form.immat.value.trim(), carburant: form.carburant.value, vin: form.vin.value.trim(),
      prochainCT: form.prochainCT.value, derniereRevision: form.derniereRevision.value
    };
    var req = isEdit
      ? api('PATCH', '/api/admin/vehicules/' + vehicle.id, payload)
      : api('POST', '/api/admin/clients/' + clientId + '/vehicules', payload);
    afterAction(req);
    closeModal();
  });
}

function openDocForm(clientId, kind, entry){
  var isEdit = !!entry;
  var c = findClient(clientId);
  var title = isEdit ? (kind === 'quote' ? 'Modifier le devis' : 'Modifier la facture') : (kind === 'quote' ? 'Nouveau devis' : 'Nouvelle facture');
  var vehOptions = '<option value="">Aucun véhicule spécifique</option>' +
    (c ? c.vehicules.map(function(v){
      var label = [v.marque, v.modele].filter(Boolean).join(' ') + (v.immat ? ' · ' + v.immat : '');
      return '<option value="' + v.id + '"' + (isEdit && entry.vehiculeId === v.id ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('') : '');

  var hasDiscount = isEdit && entry.discountType;
  openModal(
    '<h3>' + title + '</h3>' +
    '<form id="docForm">' +
      '<div class="field" style="margin-bottom:16px;"><label>Véhicule concerné</label><select name="vehiculeId">' + vehOptions + '</select></div>' +
      '<div class="field" id="vehKmField" style="margin-bottom:16px; display:none;">' +
        '<label>Kilométrage relevé <span style="text-transform:none; letter-spacing:0;">(mettra à jour la fiche du véhicule)</span></label>' +
        '<input type="number" name="vehiculeKm" min="0" step="1">' +
      '</div>' +
      '<label style="display:block; margin-bottom:8px;">Lignes<span class="req">*</span></label>' +
      '<div id="docItems"></div>' +
      '<button type="button" id="addLineBtn" class="btn btn-line btn-sm" style="margin-top:6px;">+ Ajouter une ligne</button>' +
      '<div class="field-grid two" style="margin:18px 0 4px;">' +
        '<div class="field"><label>Remise</label><select name="discountType">' +
          '<option value=""' + (!hasDiscount ? ' selected' : '') + '>Aucune</option>' +
          '<option value="percent"' + (isEdit && entry.discountType === 'percent' ? ' selected' : '') + '>Pourcentage (%)</option>' +
          '<option value="fixed"' + (isEdit && entry.discountType === 'fixed' ? ' selected' : '') + '>Montant fixe (€)</option>' +
        '</select></div>' +
        '<div class="field"><label>Valeur de la remise</label><input type="number" name="discountValue" min="0" step="0.01" value="' + (hasDiscount ? entry.discountValue : '') + '" ' + (hasDiscount ? '' : 'disabled') + '></div>' +
      '</div>' +
      '<div class="doc-grand-total" id="docSubtotalRow" style="border-top:none; padding-top:0; margin-top:0; display:none;">Sous-total <strong id="docSubtotal">0,00 €</strong></div>' +
      '<div class="doc-grand-total" id="docDiscountRow" style="border-top:none; padding-top:0; margin-top:0; display:none; color:var(--warn);">Remise <strong id="docDiscountAmount">-0,00 €</strong></div>' +
      '<div class="doc-grand-total">Total <strong id="docGrandTotal">0,00 €</strong></div>' +
      '<div class="field" style="margin:18px 0 20px;"><label>Date</label><input type="date" name="date" value="' + (isEdit ? entry.date : todayStr()) + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">' + (isEdit ? 'Enregistrer' : 'Créer') + '</button>' +
      '</div>' +
    '</form>'
  );

  var form = document.getElementById('docForm');
  var itemsWrap = document.getElementById('docItems');
  var grandTotalEl = document.getElementById('docGrandTotal');
  var subtotalRow = document.getElementById('docSubtotalRow');
  var subtotalEl = document.getElementById('docSubtotal');
  var discountRow = document.getElementById('docDiscountRow');
  var discountAmountEl = document.getElementById('docDiscountAmount');
  var discountTypeSelect = form.discountType;
  var discountValueInput = form.discountValue;
  var vehSelect = form.vehiculeId;
  var vehKmField = document.getElementById('vehKmField');
  var vehKmInput = form.vehiculeKm;

  function syncVehKmField(){
    var vid = vehSelect.value ? parseInt(vehSelect.value, 10) : null;
    var veh = vid && c ? c.vehicules.find(function(v){ return v.id === vid; }) : null;
    if(veh){
      vehKmField.style.display = '';
      vehKmInput.value = veh.km || '';
    } else {
      vehKmField.style.display = 'none';
      vehKmInput.value = '';
    }
  }
  vehSelect.addEventListener('change', syncVehKmField);
  syncVehKmField();

  discountTypeSelect.addEventListener('change', function(){
    discountValueInput.disabled = !discountTypeSelect.value;
    if(!discountTypeSelect.value){ discountValueInput.value = ''; }
    updateGrandTotal();
  });
  discountValueInput.addEventListener('input', updateGrandTotal);

  function updateGrandTotal(){
    var sum = 0;
    itemsWrap.querySelectorAll('.doc-item-row').forEach(function(row){
      var q = parseFloat(row.querySelector('.di-qty').value) || 0;
      var p = parseFloat(row.querySelector('.di-price').value) || 0;
      sum += q * p;
    });
    var discountType = discountTypeSelect.value;
    var discountValue = parseFloat(discountValueInput.value) || 0;
    var discountAmount = 0;
    if(discountType === 'percent'){ discountAmount = sum * (Math.min(discountValue, 100) / 100); }
    else if(discountType === 'fixed'){ discountAmount = Math.min(sum, discountValue); }
    var total = Math.max(0, sum - discountAmount);

    if(discountType){
      subtotalRow.style.display = 'flex';
      discountRow.style.display = 'flex';
      subtotalEl.textContent = eur(sum);
      discountAmountEl.textContent = '-' + eur(discountAmount);
    } else {
      subtotalRow.style.display = 'none';
      discountRow.style.display = 'none';
    }
    grandTotalEl.textContent = eur(total);
  }

  function addRow(prefill){
    var row = document.createElement('div');
    row.className = 'doc-item-row';
    row.innerHTML =
      '<input type="text" class="di-label" placeholder="Désignation" value="' + (prefill ? escapeHtml(prefill.label) : '') + '">' +
      '<input type="number" class="di-qty" placeholder="Qté" value="' + (prefill ? prefill.qty : 1) + '" min="0" step="any">' +
      '<input type="number" class="di-price" placeholder="Prix unitaire €" min="0" step="0.01" value="' + (prefill ? prefill.price : '') + '">' +
      '<span class="di-total">' + eur(prefill ? prefill.qty * prefill.price : 0) + '</span>' +
      '<button type="button" class="di-remove" title="Retirer la ligne">×</button>';
    var qty = row.querySelector('.di-qty');
    var price = row.querySelector('.di-price');
    var totalSpan = row.querySelector('.di-total');
    var recompute = function(){
      var q = parseFloat(qty.value) || 0;
      var p = parseFloat(price.value) || 0;
      totalSpan.textContent = eur(q * p);
      updateGrandTotal();
    };
    qty.addEventListener('input', recompute);
    price.addEventListener('input', recompute);
    row.querySelector('.di-remove').addEventListener('click', function(){
      row.remove();
      updateGrandTotal();
    });
    itemsWrap.appendChild(row);
  }

  if(isEdit && entry.items.length){
    entry.items.forEach(function(it){ addRow(it); });
    updateGrandTotal();
  } else {
    addRow();
  }
  document.getElementById('addLineBtn').addEventListener('click', function(){ addRow(); });
  form.querySelector('[data-close]').onclick = closeModal;

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var items = [];
    itemsWrap.querySelectorAll('.doc-item-row').forEach(function(row){
      var label = row.querySelector('.di-label').value.trim();
      var qty = parseFloat(row.querySelector('.di-qty').value) || 0;
      var price = parseFloat(row.querySelector('.di-price').value) || 0;
      if(label && qty > 0){ items.push({label:label, qty:qty, price:price}); }
    });
    if(items.length === 0) return;
    var payload = {
      vehiculeId: form.vehiculeId.value || null,
      vehiculeKm: form.vehiculeId.value ? vehKmInput.value.trim() : '',
      date: form.date.value || todayStr(),
      items: items,
      discountType: discountTypeSelect.value || null,
      discountValue: parseFloat(discountValueInput.value) || 0
    };
    var req;
    if(isEdit){
      req = api('PATCH', '/api/admin/' + (kind === 'quote' ? 'quotes' : 'invoices') + '/' + entry.id, payload);
    } else {
      var endpoint = '/api/admin/clients/' + clientId + '/' + (kind === 'quote' ? 'quotes' : 'invoices');
      req = api('POST', endpoint, payload);
    }
    afterAction(req);
    closeModal();
  });
}

function openVacationForm(){
  openModal(
    '<h3>Partir en vacances</h3>' +
    '<p style="color:var(--steel); font-size:0.88rem; margin-bottom:18px; line-height:1.5;">Le site affichera « Fermeture exceptionnelle » jusqu\'à cette date incluse.</p>' +
    '<form id="vacForm">' +
      '<div class="field" style="margin-bottom:16px;"><label>Retour le<span class="req">*</span></label><input type="date" name="until" required min="' + todayStr() + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">Activer</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('vacForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var until = form.until.value;
    if(!until) return;
    afterAction(api('POST', '/api/admin/status', {mode:'vacation', vacationUntil:until}));
    closeModal();
  });
}

function openPasswordForm(){
  openModal(
    '<h3>Changer le mot de passe</h3>' +
    '<form id="pwForm">' +
      '<div class="field" style="margin-bottom:16px;"><label>Mot de passe actuel<span class="req">*</span></label><input type="password" name="current" required autocomplete="current-password"></div>' +
      '<div class="field" style="margin-bottom:16px;"><label>Nouveau mot de passe (8 caractères min.)<span class="req">*</span></label><input type="password" name="next" required minlength="8" autocomplete="new-password"></div>' +
      '<p class="login-error" id="pwError"></p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">Changer</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('pwForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var errorEl = document.getElementById('pwError');
    errorEl.classList.remove('show');
    api('POST', '/api/admin/change-password', {currentPassword: form.current.value, newPassword: form.next.value})
      .then(function(){ notice('Mot de passe changé.', 'ok'); closeModal(); })
      .catch(function(err){
        errorEl.textContent = err && err.status === 401 ? 'Mot de passe actuel incorrect.' : 'Le nouveau mot de passe doit faire au moins 8 caractères.';
        errorEl.classList.add('show');
      });
  });
}

/* ---------- printable devis/facture (PDF via impression navigateur) ---------- */
function openPrintableDoc(clientId, itemId, kind){
  var c = findClient(clientId);
  if(!c) return;
  var list = kind === 'quote' ? c.quotes : c.invoices;
  var entry = list.find(function(x){ return x.id === itemId; });
  if(!entry) return;

  var veh = entry.vehiculeId ? c.vehicules.find(function(v){ return v.id === entry.vehiculeId; }) : null;
  var subtotal = docSubtotal(entry);
  var total = docTotal(entry);
  var hasDiscount = entry.discountType && docDiscountAmount(entry) > 0;
  var docNumber = (kind === 'quote' ? 'DEVIS-' : 'FACT-') + entry.id;
  var docTitle = kind === 'quote' ? 'Devis' : 'Facture';

  var rowsHtml = entry.items.map(function(it){
    return '<tr><td>' + escapeHtml(it.label) + '</td><td class="num">' + it.qty + '</td><td class="num">' + eur(it.price) + '</td><td class="num">' + eur(it.qty * it.price) + '</td></tr>';
  }).join('');

  var html = '<!doctype html><html lang="fr"><head><meta charset="UTF-8"><title>' + docTitle + ' ' + docNumber + '</title>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&family=Manrope:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap">' +
    '<style>' +
      '*{box-sizing:border-box;} body{font-family:Manrope,system-ui,sans-serif; color:#111; margin:0; padding:48px; background:#fff;}' +
      '.head{display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #111; padding-bottom:20px; margin-bottom:28px;}' +
      '.brand{font-family:Oswald,sans-serif; font-weight:700; font-size:1.6rem; text-transform:uppercase; letter-spacing:0.02em;}' +
      '.brand .m{color:#8a9a00;}' +
      '.brand-meta{font-family:"Space Mono",monospace; font-size:0.75rem; color:#444; margin-top:8px; line-height:1.6;}' +
      '.doc-title{text-align:right;}' +
      '.doc-title h1{font-family:Oswald,sans-serif; font-size:1.8rem; text-transform:uppercase; margin:0;}' +
      '.doc-title .num{font-family:"Space Mono",monospace; font-size:0.85rem; color:#444; margin-top:6px;}' +
      '.parties{display:flex; justify-content:space-between; margin-bottom:32px; gap:24px;}' +
      '.party h3{font-family:"Space Mono",monospace; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em; color:#888; margin:0 0 8px;}' +
      '.party p{margin:0; line-height:1.6; font-size:0.92rem;}' +
      'table{width:100%; border-collapse:collapse; margin-bottom:24px;}' +
      'th{font-family:"Space Mono",monospace; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.06em; color:#888; text-align:left; padding:10px 8px; border-bottom:2px solid #111;}' +
      'td{padding:12px 8px; border-bottom:1px solid #ddd; font-size:0.92rem;}' +
      '.num{text-align:right; font-family:"Space Mono",monospace;}' +
      '.totals{margin-left:auto; width:280px;}' +
      '.totals .row{display:flex; justify-content:space-between; padding:8px 0; font-family:"Space Mono",monospace; font-size:0.9rem;}' +
      '.totals .grand{border-top:2px solid #111; margin-top:6px; padding-top:12px; font-weight:700; font-size:1.1rem;}' +
      '.footer{margin-top:48px; padding-top:16px; border-top:1px solid #ddd; font-size:0.72rem; color:#888; font-family:"Space Mono",monospace; line-height:1.6;}' +
      '.printbar{margin-bottom:24px;}' +
      '.printbar button{font-family:"Space Mono",monospace; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.06em; padding:10px 18px; background:#dcfa00; border:1px solid #111; border-radius:2px; cursor:pointer;}' +
      '@media print{ .printbar{display:none;} body{padding:0;} }' +
    '</style></head><body>' +
      '<div class="printbar"><button type="button" id="printBtn">Imprimer / Enregistrer en PDF</button></div>' +
      '<div class="head">' +
        '<div class="brand"><span class="m">MY</span>CARSTORE' +
          '<div class="brand-meta">434 rue de la Basinière, ZAC des Tourelles<br>90120 Morvillars<br>03 65 67 69 62 — contact@mycarstore.fr<br>SIRET 944 840 842 00016</div>' +
        '</div>' +
        '<div class="doc-title"><h1>' + docTitle + '</h1><div class="num">N° ' + docNumber + '<br>' + fmtFr(entry.date) + '</div></div>' +
      '</div>' +
      '<div class="parties">' +
        '<div class="party"><h3>Client</h3><p>' + escapeHtml(c.nom) + (c.adresse ? '<br>' + escapeHtml(c.adresse) : '') + (c.tel ? '<br>' + escapeHtml(c.tel) : '') + (c.email ? '<br>' + escapeHtml(c.email) : '') + '</p></div>' +
        (veh ? '<div class="party"><h3>Véhicule</h3><p>' + escapeHtml([veh.marque, veh.modele].filter(Boolean).join(' ')) + (veh.immat ? '<br>Immat. ' + escapeHtml(veh.immat) : '') + (veh.annee ? '<br>Année ' + escapeHtml(veh.annee) : '') + '</p></div>' : '') +
      '</div>' +
      '<table><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th class="num">Total</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '<div class="totals">' +
        (hasDiscount
          ? '<div class="row"><span>Sous-total</span><span>' + eur(subtotal) + '</span></div>' +
            '<div class="row"><span>Remise (' + escapeHtml(discountLabel(entry)) + ')</span><span>-' + eur(docDiscountAmount(entry)) + '</span></div>'
          : '') +
        '<div class="row grand"><span>Total ' + (kind === 'quote' ? 'devis' : 'TTC') + '</span><span>' + eur(total) + '</span></div>' +
      '</div>' +
      '<div class="footer">MyCarStore — SAS MYCARSTORE SERVICES — SIRET 944 840 842 00016<br>' +
        (kind === 'quote' ? 'Devis valable 30 jours à compter de sa date d\'émission. Sans engagement.' : 'Facture émise par SAS MYCARSTORE SERVICES.') +
      '</div>' +
    '</body></html>';

  var win = window.open('', '_blank');
  if(!win){
    notice('Autorisez les fenêtres pop-up pour générer le PDF.', 'warn');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  var printBtn = win.document.getElementById('printBtn');
  if(printBtn){ printBtn.addEventListener('click', function(){ win.print(); }); }
}

/* ---------- appointment detail (from agenda or list) ---------- */
function openApptDetail(apptId){
  var a = findAppt(apptId);
  if(!a) return;
  var vehicule = [a.marque, a.modele].filter(Boolean).join(' ') || '—';

  openModal(
    '<h3>' + escapeHtml(a.nom) + '</h3>' +
    '<p class="hint" style="margin-bottom:20px;">' + escapeHtml(fmtFr(a.date)) + ' · ' + escapeHtml(a.creneau || '') + '</p>' +
    '<div class="field-grid two" style="margin-bottom:4px;">' +
      '<div class="field"><label>Véhicule</label><div style="padding:8px 0; font-size:0.92rem;">' + escapeHtml(vehicule) + '</div></div>' +
      '<div class="field"><label>Téléphone</label><div style="padding:8px 0; font-size:0.92rem;"><a href="tel:' + escapeHtml((a.tel || '').replace(/\s+/g, '')) + '" style="color:var(--paper);">' + escapeHtml(a.tel) + '</a></div></div>' +
    '</div>' +
    '<div class="field" style="margin-bottom:4px;"><label>Intervention(s)</label><div style="padding:8px 0; font-size:0.92rem;">' + escapeHtml((a.services || []).join(', ') || '—') + '</div></div>' +
    (a.message ? '<div class="field" style="margin-bottom:16px;"><label>Détails</label><div style="padding:8px 0; font-size:0.9rem; color:var(--steel);">' + escapeHtml(a.message) + '</div></div>' : '<div style="margin-bottom:12px;"></div>') +
    '<div class="modal-actions" style="justify-content:flex-start; flex-wrap:wrap;" id="apptModalActions"></div>'
  );

  function renderActions(){
    var wrap = document.getElementById('apptModalActions');
    if(!wrap) return;
    wrap.innerHTML = apptStatusActions(a) + (a.clientId
      ? '<button type="button" class="btn btn-line" id="ma-client">Voir la fiche client</button>'
      : '<button type="button" class="btn btn-line" id="ma-convert">Créer la fiche client</button>') +
      '<button type="button" class="btn btn-line" id="ma-edit">Modifier</button>' +
      '<button type="button" class="btn btn-line" id="ma-delete">Supprimer</button>';

    wrap.querySelectorAll('[data-action]').forEach(function(btn){
      var act = btn.getAttribute('data-action');
      btn.onclick = function(){
        var status = act === 'confirm-appt' ? 'confirme' : act === 'cancel-appt' ? 'annule' : 'en_attente';
        api('PATCH', '/api/admin/appointments/' + apptId, {status: status}).then(function(){
          a.status = status;
          return refreshState();
        }).then(renderActions).catch(function(){});
      };
    });

    var clientBtn = document.getElementById('ma-client');
    if(clientBtn) clientBtn.onclick = function(){
      adminState.tab = 'client';
      adminState.clientId = a.clientId;
      closeModal();
      renderAdmin();
    };
    var convertBtn = document.getElementById('ma-convert');
    if(convertBtn) convertBtn.onclick = function(){
      api('POST', '/api/admin/appointments/' + apptId + '/convert-to-client').then(function(res){
        adminState.tab = 'client';
        adminState.clientId = res.clientId;
        return refreshState();
      }).catch(function(){});
      closeModal();
    };
    document.getElementById('ma-edit').onclick = function(){
      openApptForm(a);
    };
    document.getElementById('ma-delete').onclick = function(){
      if(!confirm('Supprimer définitivement ce rendez-vous ?')) return;
      afterAction(api('DELETE', '/api/admin/appointments/' + apptId));
      closeModal();
    };
  }
  renderActions();
}

function openApptForm(existing){
  var isEdit = !!existing;
  var serviceOptions = ['Entretien / révision','Diagnostic panne','Pneumatiques','Pièces & accessoires','Multimédia / LED','Contre-visite','Autre'];
  var selected = isEdit ? (existing.services || []) : [];

  openModal(
    '<h3>' + (isEdit ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous') + '</h3>' +
    '<form id="apptForm">' +
      '<div class="field-grid two" style="margin-bottom:16px;">' +
        '<div class="field"><label>Nom<span class="req">*</span></label><input type="text" name="nom" required value="' + escapeHtml(existing && existing.nom || '') + '"></div>' +
        '<div class="field"><label>Téléphone<span class="req">*</span></label><input type="tel" name="tel" required value="' + escapeHtml(existing && existing.tel || '') + '"></div>' +
      '</div>' +
      '<div class="field-grid two" style="margin-bottom:16px;">' +
        '<div class="field"><label>E-mail</label><input type="email" name="email" value="' + escapeHtml(existing && existing.email || '') + '"></div>' +
        '<div class="field"><label>Contact préféré</label><select name="contactpref">' +
          ['Téléphone','E-mail','SMS'].map(function(o){ return '<option' + (existing && existing.contactpref === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field-grid two" style="margin-bottom:16px;">' +
        '<div class="field"><label>Marque</label><input type="text" name="marque" value="' + escapeHtml(existing && existing.marque || '') + '"></div>' +
        '<div class="field"><label>Modèle</label><input type="text" name="modele" value="' + escapeHtml(existing && existing.modele || '') + '"></div>' +
      '</div>' +
      '<div class="field-grid two" style="margin-bottom:16px;">' +
        '<div class="field"><label>Année</label><input type="number" name="annee" min="1970" max="2026" value="' + escapeHtml(existing && existing.annee || '') + '"></div>' +
        '<div class="field"><label>Kilométrage</label><input type="number" name="km" min="0" step="1" value="' + escapeHtml(existing && existing.km || '') + '"></div>' +
      '</div>' +
      '<div class="field" style="margin-bottom:16px;"><label>Immatriculation</label><input type="text" name="immat" value="' + escapeHtml(existing && existing.immat || '') + '"></div>' +
      '<div class="field" style="margin-bottom:16px;">' +
        '<label>Intervention(s)<span class="req">*</span></label>' +
        '<div class="chip-group" id="apptServiceChips">' +
          serviceOptions.map(function(s){
            return '<label class="chip"><input type="checkbox" name="service" value="' + escapeHtml(s) + '"' + (selected.indexOf(s) !== -1 ? ' checked' : '') + '><span>' + escapeHtml(s) + '</span></label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="field" style="margin-bottom:16px;"><label>Détails</label><textarea name="message">' + escapeHtml(existing && existing.message || '') + '</textarea></div>' +
      '<div class="field-grid two" style="margin-bottom:20px;">' +
        '<div class="field"><label>Date<span class="req">*</span></label><input type="date" name="date" required value="' + escapeHtml(existing && existing.date || '') + '"></div>' +
        '<div class="field"><label>Créneau<span class="req">*</span></label><input type="text" name="creneau" required placeholder="Ex. 9h – 10h" value="' + escapeHtml(existing && existing.creneau || '') + '"></div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">' + (isEdit ? 'Enregistrer' : 'Créer le rendez-vous') + '</button>' +
      '</div>' +
    '</form>'
  );

  var form = document.getElementById('apptForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var services = Array.prototype.slice.call(form.querySelectorAll('input[name="service"]:checked')).map(function(i){ return i.value; });
    if(services.length === 0){
      document.getElementById('apptServiceChips').scrollIntoView({behavior:'smooth', block:'center'});
      return;
    }
    if(!form.checkValidity()){ form.reportValidity(); return; }
    var payload = {
      nom: form.nom.value.trim(), tel: form.tel.value.trim(), email: form.email.value.trim(),
      marque: form.marque.value.trim(), modele: form.modele.value.trim(), annee: form.annee.value.trim(),
      km: form.km.value.trim(), immat: form.immat.value.trim(), services: services,
      message: form.message.value.trim(), date: form.date.value, creneau: form.creneau.value.trim(),
      contactpref: form.contactpref.value
    };
    var req = isEdit
      ? api('PATCH', '/api/admin/appointments/' + existing.id + '/details', payload)
      : api('POST', '/api/admin/appointments', payload);
    if(!isEdit){
      req.then(function(res){
        if(res && res.matchedClientId){ notice('Rendez-vous créé — client existant relié automatiquement.', 'ok'); }
      }).catch(function(){});
    }
    afterAction(req);
    closeModal();
  });
}

/* ---------- render: dashboard ---------- */
function renderDashboard(){
  var newCount = STATE.appointments.filter(function(a){ return a.status === 'en_attente'; }).length;
  var totalUnpaid = 0;
  STATE.clients.forEach(function(c){
    c.invoices.forEach(function(inv){ if(inv.statut === 'impayée') totalUnpaid += docTotal(inv); });
  });
  var st = STATE.status || {mode:'open'};

  var statusCards =
    '<div class="status-opt' + (st.mode === 'open' ? ' current' : '') + '" data-action="set-status-open">' +
      '<div class="t">Ouvert</div><div class="d">Horaires habituels affichés sur le site.</div>' +
    '</div>' +
    '<div class="status-opt' + (st.mode === 'vacation' ? ' current' : '') + '" data-action="open-vacation-modal">' +
      '<div class="t">Vacances</div><div class="d">' + (st.mode === 'vacation' && st.vacationUntil ? 'Jusqu\'au ' + fmtFr(st.vacationUntil) : 'Ferme jusqu\'à une date à définir.') + '</div>' +
    '</div>' +
    '<div class="status-opt' + (st.mode === 'closed_today' ? ' current' : '') + '" data-action="set-status-closed-today">' +
      '<div class="t">Fermé aujourd\'hui</div><div class="d">Rouvre automatiquement demain aux horaires habituels.</div>' +
    '</div>';

  return '' +
    '<div class="admin-section-title">Tableau de bord</div>' +
    '<div class="admin-section-sub">Vue d\'ensemble de l\'activité et statut de l\'atelier.</div>' +
    '<div class="admin-grid">' +
      '<div class="stat-card"><div class="label">Nouvelles demandes</div><div class="value' + (newCount > 0 ? ' warn' : '') + '">' + newCount + '</div></div>' +
      '<div class="stat-card"><div class="label">Clients enregistrés</div><div class="value">' + STATE.clients.length + '</div></div>' +
      '<div class="stat-card"><div class="label">Total impayé</div><div class="value' + (totalUnpaid > 0 ? ' warn' : ' ok') + '">' + eur(totalUnpaid) + '</div></div>' +
    '</div>' +
    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Statut de l\'atelier</h3></div>' +
      '<div class="status-options">' + statusCards + '</div>' +
    '</div>';
}

/* ---------- render: agenda ---------- */
function renderAgenda(){
  if(!adminState.calMonth) adminState.calMonth = todayStr().slice(0, 7) + '-01';
  var monthStart = new Date(adminState.calMonth + 'T00:00:00');
  var year = monthStart.getFullYear();
  var month = monthStart.getMonth();
  var firstOfMonth = new Date(year, month, 1);
  var startOffset = (firstOfMonth.getDay() + 6) % 7;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var todayIso = todayStr();

  var apptsByDate = {};
  STATE.appointments.forEach(function(a){
    apptsByDate[a.date] = apptsByDate[a.date] || [];
    apptsByDate[a.date].push(a);
  });

  var monthLabel = monthStart.toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
  monthLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  var cells = '';
  for(var i = 0; i < startOffset; i++){ cells += '<div class="cal-day empty"></div>'; }
  for(var d = 1; d <= daysInMonth; d++){
    var iso = year + '-' + pad2(month + 1) + '-' + pad2(d);
    var dayAppts = (apptsByDate[iso] || []).slice().sort(function(a, b){ return (a.creneau || '').localeCompare(b.creneau || ''); });
    var isToday = iso === todayIso;
    cells += '<div class="cal-day' + (isToday ? ' today' : '') + '">' +
      '<div class="cal-day-num">' + d + '</div>' +
      '<div class="cal-appts">' +
        dayAppts.slice(0, 4).map(function(a){
          var toneClass = a.status === 'confirme' ? 'cal-confirme' : a.status === 'annule' ? 'cal-annule' : 'cal-attente';
          return '<button type="button" class="cal-appt ' + toneClass + '" data-action="open-appt" data-id="' + a.id + '">' +
            '<span class="cal-appt-time">' + escapeHtml((a.creneau || '').split(' –')[0]) + '</span>' + escapeHtml(a.nom) +
          '</button>';
        }).join('') +
        (dayAppts.length > 4 ? '<div class="cal-more">+' + (dayAppts.length - 4) + ' de plus</div>' : '') +
      '</div>' +
    '</div>';
  }

  return '' +
    '<div class="admin-section-title">Agenda</div>' +
    '<div class="admin-section-sub">Synchronisé avec les demandes de rendez-vous du site — en attente, confirmées et annulées.</div>' +
    '<div class="admin-panel">' +
      '<div class="cal-header">' +
        '<button type="button" class="btn btn-line btn-sm" data-action="cal-prev">← Précédent</button>' +
        '<div class="cal-month-label">' + escapeHtml(monthLabel) + '</div>' +
        '<button type="button" class="btn btn-line btn-sm" data-action="cal-next">Suivant →</button>' +
        '<button type="button" class="btn btn-line btn-sm" data-action="cal-today">Aujourd\'hui</button>' +
        '<button type="button" class="btn btn-fill btn-sm" data-action="new-appt" style="margin-left:auto;">+ Nouveau rendez-vous</button>' +
      '</div>' +
      '<div class="cal-legend">' +
        '<span class="cal-legend-item"><span class="dot cal-attente"></span>En attente</span>' +
        '<span class="cal-legend-item"><span class="dot cal-confirme"></span>Confirmé</span>' +
        '<span class="cal-legend-item"><span class="dot cal-annule"></span>Annulé</span>' +
      '</div>' +
      '<div class="cal-scroll"><div class="cal-inner">' +
        '<div class="cal-weekdays"><div>Lun</div><div>Mar</div><div>Mer</div><div>Jeu</div><div>Ven</div><div>Sam</div><div>Dim</div></div>' +
        '<div class="cal-grid">' + cells + '</div>' +
      '</div></div>' +
    '</div>';
}

/* ---------- render: appointments list ---------- */
function renderAppointments(){
  var list = STATE.appointments.slice().sort(function(a, b){ return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  var rows = list.map(function(a){
    var vehicule = [a.marque, a.modele].filter(Boolean).join(' ') || '—';
    return '<tr>' +
      '<td><strong>' + escapeHtml(a.nom) + '</strong><br><span class="muted">' + escapeHtml(a.tel) + '</span></td>' +
      '<td>' + escapeHtml(vehicule) + '</td>' +
      '<td>' + escapeHtml(fmtFr(a.date)) + '<br><span class="muted">' + escapeHtml(a.creneau || '') + '</span></td>' +
      '<td>' + escapeHtml((a.services || []).join(', ')) + '</td>' +
      '<td>' + apptStatusChip(a.status) + '</td>' +
      '<td><div class="row-actions">' +
        apptStatusActions(a) +
        (a.clientId
          ? '<button type="button" class="btn btn-line" data-action="open-client" data-id="' + a.clientId + '">Voir la fiche</button>'
          : '<button type="button" class="btn btn-line" data-action="convert-to-client" data-id="' + a.id + '">Créer la fiche client</button>'
        ) +
      '</div></td>' +
    '</tr>';
  }).join('');

  return '' +
    '<div class="admin-panel-head" style="margin-bottom:24px;">' +
      '<div><div class="admin-section-title" style="margin-bottom:6px;">Demandes de rendez-vous</div><div class="admin-section-sub" style="margin-bottom:0;">Envoyées depuis le formulaire du site, ou ajoutées ici directement.</div></div>' +
      '<button type="button" class="btn btn-fill" data-action="new-appt">+ Nouveau rendez-vous</button>' +
    '</div>' +
    '<div class="admin-panel">' +
      (list.length
        ? '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Client</th><th>Véhicule</th><th>Créneau souhaité</th><th>Intervention(s)</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="admin-empty">Aucune demande pour le moment.</div>'
      ) +
    '</div>';
}

/* ---------- render: clients list ---------- */
function renderClients(){
  var rows = STATE.clients.map(function(c){
    var unpaid = c.invoices.filter(function(i){ return i.statut === 'impayée'; }).reduce(function(s, i){ return s + docTotal(i); }, 0);
    var search = (c.nom + ' ' + c.tel + ' ' + c.email).toLowerCase();
    return '<tr class="clickable" data-action="open-client" data-id="' + c.id + '" data-search="' + escapeHtml(search) + '">' +
      '<td><strong>' + escapeHtml(c.nom) + '</strong></td>' +
      '<td class="muted">' + escapeHtml(c.tel || '—') + '</td>' +
      '<td class="muted">' + escapeHtml(c.email || '—') + '</td>' +
      '<td>' + c.vehicules.length + '</td>' +
      '<td>' + (unpaid > 0
        ? '<span class="chip-status tone-unpaid"><span class="dot"></span>' + eur(unpaid) + '</span>'
        : '<span class="chip-status tone-paid"><span class="dot"></span>À jour</span>') +
      '</td>' +
    '</tr>';
  }).join('');

  return '' +
    '<div class="admin-panel-head" style="margin-bottom:24px;">' +
      '<div><div class="admin-section-title" style="margin-bottom:6px;">Clients</div><div class="admin-section-sub" style="margin-bottom:0;">' + STATE.clients.length + ' fiche(s) enregistrée(s).</div></div>' +
      '<button type="button" class="btn btn-fill" data-action="new-client">+ Nouveau client</button>' +
    '</div>' +
    '<div class="admin-panel">' +
      '<input type="text" id="clientSearch" placeholder="Rechercher un client (nom, téléphone, e-mail)…" style="margin-bottom:18px;">' +
      (STATE.clients.length
        ? '<div style="overflow-x:auto;"><table class="admin-table" id="clientsTable"><thead><tr><th>Nom</th><th>Téléphone</th><th>E-mail</th><th>Véhicules</th><th>Facturation</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="admin-empty">Aucun client pour le moment. Convertissez une demande de rendez-vous ou créez une fiche.</div>'
      ) +
    '</div>';
}

/* ---------- render: client detail ---------- */
function renderClientDetail(id){
  var c = findClient(id);
  if(!c){
    adminState.tab = 'clients';
    return renderClients();
  }

  var totalUnpaid = c.invoices.filter(function(i){ return i.statut === 'impayée'; }).reduce(function(s, i){ return s + docTotal(i); }, 0);

  var tagsHtml = (c.tags && c.tags.length)
    ? '<div class="veh-tags" style="margin-top:10px;">' + c.tags.map(function(t){ return '<span class="chip-status tone-sent">' + escapeHtml(t) + '</span>'; }).join('') + '</div>'
    : '';

  var vehTable = c.vehicules.length
    ? '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Véhicule</th><th>Année</th><th>Carburant</th><th>Immat.</th><th>Kilométrage</th><th>Prochain CT</th><th>Dernière révision</th><th></th></tr></thead><tbody>' +
      c.vehicules.map(function(v){
        return '<tr>' +
          '<td><strong>' + escapeHtml([v.marque, v.modele].filter(Boolean).join(' ')) + '</strong>' + (v.vin ? '<br><span class="muted">VIN ' + escapeHtml(v.vin) + '</span>' : '') + '</td>' +
          '<td class="muted">' + escapeHtml(v.annee || '—') + '</td>' +
          '<td class="muted">' + escapeHtml(v.carburant || '—') + '</td>' +
          '<td class="muted">' + escapeHtml(v.immat || '—') + '</td>' +
          '<td class="muted">' + escapeHtml(v.km ? v.km + ' km' : '—') + '</td>' +
          '<td class="muted">' + escapeHtml(v.prochainCT ? fmtFr(v.prochainCT) : '—') + '</td>' +
          '<td class="muted">' + escapeHtml(v.derniereRevision ? fmtFr(v.derniereRevision) : '—') + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-line" data-action="edit-vehicle" data-id="' + c.id + '" data-did="' + v.id + '">Modifier</button>' +
            '<button type="button" class="btn btn-line" data-action="remove-vehicle" data-id="' + c.id + '" data-did="' + v.id + '">Retirer</button>' +
          '</div></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>'
    : '<div class="admin-empty">Aucun véhicule enregistré.</div>';

  var linkedAppts = STATE.appointments.filter(function(a){ return a.clientId === c.id; });
  var possibleAppts = STATE.appointments.filter(function(a){
    if(a.clientId) return false;
    var telMatch = c.tel && a.tel && a.tel.replace(/\s+/g,'') === c.tel.replace(/\s+/g,'');
    var emailMatch = c.email && a.email && a.email.toLowerCase() === c.email.toLowerCase();
    var nomMatch = c.nom && a.nom && c.nom.trim().toLowerCase() === a.nom.trim().toLowerCase();
    return telMatch || emailMatch || nomMatch;
  });

  function apptRow(a, showLink){
    var vehicule = [a.marque, a.modele].filter(Boolean).join(' ') || '—';
    return '<tr>' +
      '<td>' + escapeHtml(fmtFr(a.date)) + '<br><span class="muted">' + escapeHtml(a.creneau || '') + '</span></td>' +
      '<td>' + escapeHtml(vehicule) + '</td>' +
      '<td>' + escapeHtml((a.services || []).join(', ')) + '</td>' +
      '<td>' + apptStatusChip(a.status) + '</td>' +
      (showLink ? '<td><button type="button" class="btn btn-fill" data-action="link-appt" data-id="' + a.id + '" data-did="' + c.id + '">Rattacher à ce client</button></td>' : '') +
    '</tr>';
  }

  function docRows(list, kind){
    if(!list.length) return '<div class="admin-empty">Aucun ' + (kind === 'quote' ? 'devis' : 'facture') + ' pour le moment.</div>';
    var statutOptions = kind === 'quote' ? ['envoyé','accepté','refusé'] : ['impayée','payée'];
    return '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Description</th><th>Véhicule</th><th>Date</th><th>Total</th><th>Statut</th><th></th></tr></thead><tbody>' +
      list.slice().sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); }).map(function(entry){
        var subtotal = docSubtotal(entry);
        var total = docTotal(entry);
        var hasDiscount = entry.discountType && docDiscountAmount(entry) > 0;
        var veh = entry.vehiculeId ? c.vehicules.find(function(v){ return v.id === entry.vehiculeId; }) : null;
        var itemsText = entry.items.map(function(it){ return it.label + ' (×' + it.qty + ')'; }).join(', ');
        var discountLine = hasDiscount ? '\nSous-total : ' + eur(subtotal) + '\nRemise (' + discountLabel(entry) + ') : -' + eur(docDiscountAmount(entry)) : '';
        var mailBody = kind === 'quote'
          ? 'Bonjour ' + c.nom + ',\n\nVoici le devis établi par MyCarStore :\n\n' + entry.items.map(function(it){ return '- ' + it.label + ' × ' + it.qty + ' — ' + eur(it.price) + ' l\'unité'; }).join('\n') + discountLine + '\n\nTotal : ' + eur(total) + '\n\nUn PDF détaillé peut être généré depuis l\'atelier sur demande.\n\nMyCarStore — 03 65 67 69 62'
          : 'Bonjour ' + c.nom + ',\n\nVoici la facture MyCarStore :\n\n' + entry.items.map(function(it){ return '- ' + it.label + ' × ' + it.qty + ' — ' + eur(it.price) + ' l\'unité'; }).join('\n') + discountLine + '\n\nTotal : ' + eur(total) + '\nStatut : ' + entry.statut + '\n\nMyCarStore — 03 65 67 69 62';
        var smsBody = (kind === 'quote' ? 'Devis MyCarStore: ' : 'Facture MyCarStore: ') + itemsText + (hasDiscount ? ' - Remise ' + discountLabel(entry) : '') + ' - Total ' + eur(total);
        var mailHref = 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent((kind === 'quote' ? 'Devis' : 'Facture') + ' MyCarStore') + '&body=' + encodeURIComponent(mailBody);
        var smsHref = 'sms:' + (c.tel ? c.tel.replace(/\s+/g, '') : '') + '?&body=' + encodeURIComponent(smsBody);
        var tone = kind === 'quote'
          ? (entry.statut === 'accepté' ? 'tone-accepted' : entry.statut === 'refusé' ? 'tone-declined' : 'tone-sent')
          : (entry.statut === 'payée' ? 'tone-paid' : 'tone-unpaid');
        return '<tr>' +
          '<td>' + escapeHtml(itemsText) + '</td>' +
          '<td class="muted">' + (veh ? escapeHtml([veh.marque, veh.modele].filter(Boolean).join(' ')) : '—') + '</td>' +
          '<td class="muted">' + escapeHtml(fmtFr(entry.date)) + '</td>' +
          '<td>' + eur(total) + (hasDiscount ? '<br><span class="muted" style="font-size:0.72rem;">' + escapeHtml(discountLabel(entry)) + '</span>' : '') + '</td>' +
          '<td><span class="chip-status ' + tone + '"><span class="dot"></span>' + escapeHtml(entry.statut) + '</span></td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-fill" data-action="print-pdf" data-id="' + c.id + '" data-did="' + entry.id + '" data-kind="' + kind + '">PDF</button>' +
            '<a class="btn btn-line" href="' + mailHref + '">E-mail</a>' +
            '<a class="btn btn-line" href="' + smsHref + '">SMS</a>' +
            '<select data-change="set-' + kind + '-status" data-id="' + c.id + '" data-did="' + entry.id + '" style="width:auto; padding:7px 10px; font-size:0.7rem;">' +
              statutOptions.map(function(o){ return '<option value="' + o + '"' + (o === entry.statut ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
            '</select>' +
            '<button type="button" class="btn btn-line" data-action="edit-' + kind + '" data-id="' + c.id + '" data-did="' + entry.id + '">Modifier</button>' +
            '<button type="button" class="btn btn-line" data-action="delete-' + kind + '" data-id="' + c.id + '" data-did="' + entry.id + '">Suppr.</button>' +
          '</div></td>' +
        '</tr>';
      }).join('') +
    '</tbody></table></div>';
  }

  return '' +
    '<button type="button" class="back-link" data-action="back-to-clients">← Tous les clients</button>' +
    '<div class="client-header">' +
      '<div>' +
        '<h2>' + escapeHtml(c.nom) + '</h2>' +
        '<div class="meta-line">' +
          (c.tel ? '<a href="tel:' + escapeHtml(c.tel.replace(/\s+/g, '')) + '">' + escapeHtml(c.tel) + '</a>' : '<span>Pas de téléphone</span>') +
          (c.email ? '<a href="mailto:' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + '</a>' : '') +
          (c.adresse ? '<span>' + escapeHtml(c.adresse) + '</span>' : '') +
          '<span>Client depuis le ' + fmtFr((c.createdAt || '').slice(0, 10)) + '</span>' +
        '</div>' +
        tagsHtml +
      '</div>' +
      '<div class="row-actions">' +
        '<button type="button" class="btn btn-line" data-action="edit-client" data-id="' + c.id + '">Modifier</button>' +
        '<button type="button" class="btn btn-line" data-action="delete-client" data-id="' + c.id + '">Supprimer</button>' +
      '</div>' +
    '</div>' +

    '<div class="admin-grid" style="grid-template-columns:repeat(3,1fr);">' +
      '<div class="stat-card"><div class="label">Total impayé</div><div class="value' + (totalUnpaid > 0 ? ' warn' : ' ok') + '">' + eur(totalUnpaid) + '</div></div>' +
      '<div class="stat-card"><div class="label">Véhicules</div><div class="value">' + c.vehicules.length + '</div></div>' +
      '<div class="stat-card"><div class="label">Rendez-vous liés</div><div class="value">' + linkedAppts.length + '</div></div>' +
    '</div>' +

    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Véhicules</h3><button type="button" class="btn btn-line" data-action="add-vehicle" data-id="' + c.id + '">+ Ajouter</button></div>' +
      vehTable +
    '</div>' +

    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Notes</h3></div>' +
      '<textarea id="clientNotes" style="min-height:80px;" placeholder="Notes internes sur ce client…">' + escapeHtml(c.notes || '') + '</textarea>' +
      '<div style="margin-top:12px;"><button type="button" class="btn btn-line" data-action="save-notes" data-id="' + c.id + '">Enregistrer les notes</button></div>' +
    '</div>' +

    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Devis</h3><button type="button" class="btn btn-fill" data-action="add-devis" data-id="' + c.id + '">+ Nouveau devis</button></div>' +
      docRows(c.quotes, 'quote') +
    '</div>' +

    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Factures</h3><button type="button" class="btn btn-fill" data-action="add-facture" data-id="' + c.id + '">+ Nouvelle facture</button></div>' +
      docRows(c.invoices, 'invoice') +
    '</div>' +

    (linkedAppts.length || possibleAppts.length
      ? '<div class="admin-panel">' +
          '<div class="admin-panel-head"><h3>Rendez-vous</h3></div>' +
          (linkedAppts.length
            ? '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Créneau souhaité</th><th>Véhicule</th><th>Intervention(s)</th><th>Statut</th></tr></thead><tbody>' + linkedAppts.map(function(a){ return apptRow(a, false); }).join('') + '</tbody></table></div>'
            : '') +
          (possibleAppts.length
            ? '<p class="hint" style="margin:16px 0 10px;">Autres demandes reçues avec le même téléphone ou e-mail, pas encore rattachées :</p>' +
              '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Créneau souhaité</th><th>Véhicule</th><th>Intervention(s)</th><th>Statut</th><th></th></tr></thead><tbody>' + possibleAppts.map(function(a){ return apptRow(a, true); }).join('') + '</tbody></table></div>'
            : '') +
        '</div>'
      : '');
}

/* ---------- shell / router ---------- */
function renderAdmin(){
  var el = document.getElementById('adminApp');
  if(!el || el.hidden) return;
  var newCount = STATE.appointments.filter(function(a){ return a.status === 'en_attente'; }).length;

  function tabBtn(key, label){
    var active = adminState.tab === key || (key === 'clients' && adminState.tab === 'client');
    return '<button type="button" class="admin-tab' + (active ? ' active' : '') + '" data-action="tab" data-tab="' + key + '">' + label + '</button>';
  }

  var content;
  if(adminState.tab === 'agenda') content = renderAgenda();
  else if(adminState.tab === 'appointments') content = renderAppointments();
  else if(adminState.tab === 'clients') content = renderClients();
  else if(adminState.tab === 'client') content = renderClientDetail(adminState.clientId);
  else content = renderDashboard();

  el.innerHTML =
    '<div class="admin-topbar"><div class="wrap bar">' +
      '<span class="logo"><span class="m">MY</span>CARSTORE<span style="color:var(--steel); font-family:var(--font-mono); font-size:0.65rem; margin-left:10px; letter-spacing:0.1em;">ADMIN</span></span>' +
      '<div class="admin-tabs">' +
        tabBtn('dashboard', 'Tableau de bord') +
        tabBtn('agenda', 'Agenda') +
        tabBtn('appointments', 'Rendez-vous' + (newCount ? ' · ' + newCount : '')) +
        tabBtn('clients', 'Clients') +
      '</div>' +
      '<div class="row-actions">' +
        '<a class="btn btn-line btn-sm" href="/">Voir le site public</a>' +
        '<button type="button" class="btn btn-line btn-sm" data-action="change-password">Mot de passe</button>' +
        '<button type="button" class="btn btn-line btn-sm" data-action="logout">Déconnexion</button>' +
      '</div>' +
    '</div></div>' +
    '<div class="admin-shell">' + content + '</div>';

  if(adminState.tab === 'clients'){
    var search = document.getElementById('clientSearch');
    var table = document.getElementById('clientsTable');
    if(search && table){
      search.addEventListener('input', function(){
        var q = search.value.trim().toLowerCase();
        table.querySelectorAll('tbody tr').forEach(function(tr){
          var hay = tr.getAttribute('data-search') || '';
          tr.style.display = hay.indexOf(q) === -1 ? 'none' : '';
        });
      });
    }
  }
}

/* ---------- delegated actions ---------- */
document.getElementById('adminApp').addEventListener('click', function(e){
  var target = e.target.closest('[data-action]');
  if(!target) return;
  var action = target.getAttribute('data-action');
  var id = target.getAttribute('data-id');
  var did = target.getAttribute('data-did');

  if(action === 'tab'){
    adminState.tab = target.getAttribute('data-tab');
    adminState.clientId = null;
    renderAdmin();
  } else if(action === 'logout'){
    api('POST', '/api/logout').then(function(){ showLoginGate(); }).catch(function(){});
  } else if(action === 'change-password'){
    openPasswordForm();
  } else if(action === 'set-status-open'){
    afterAction(api('POST', '/api/admin/status', {mode:'open'}));
  } else if(action === 'set-status-closed-today'){
    afterAction(api('POST', '/api/admin/status', {mode:'closed_today', closedTodayDate: todayStr()}));
  } else if(action === 'open-vacation-modal'){
    openVacationForm();
  } else if(action === 'confirm-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id, {status:'confirme'}));
  } else if(action === 'cancel-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id, {status:'annule'}));
  } else if(action === 'pending-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id, {status:'en_attente'}));
  } else if(action === 'convert-to-client'){
    api('POST', '/api/admin/appointments/' + id + '/convert-to-client').then(function(res){
      adminState.tab = 'client';
      adminState.clientId = res.clientId;
      return refreshState();
    }).catch(function(){ notice('Échec de la création.', 'warn'); });
  } else if(action === 'link-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id + '/link', {clientId: did}));
  } else if(action === 'print-pdf'){
    openPrintableDoc(id, parseInt(did, 10), target.getAttribute('data-kind'));
  } else if(action === 'cal-prev' || action === 'cal-next'){
    var cm = new Date(adminState.calMonth + 'T00:00:00');
    cm.setMonth(cm.getMonth() + (action === 'cal-next' ? 1 : -1));
    adminState.calMonth = cm.getFullYear() + '-' + pad2(cm.getMonth() + 1) + '-01';
    renderAdmin();
  } else if(action === 'cal-today'){
    adminState.calMonth = todayStr().slice(0, 7) + '-01';
    renderAdmin();
  } else if(action === 'open-appt'){
    openApptDetail(parseInt(id, 10));
  } else if(action === 'new-appt'){
    openApptForm(null);
  } else if(action === 'open-client'){
    adminState.tab = 'client';
    adminState.clientId = parseInt(id, 10);
    renderAdmin();
  } else if(action === 'back-to-clients'){
    adminState.tab = 'clients';
    adminState.clientId = null;
    renderAdmin();
  } else if(action === 'new-client'){
    openClientForm(null);
  } else if(action === 'edit-client'){
    openClientForm(findClient(id));
  } else if(action === 'delete-client'){
    if(confirm('Supprimer définitivement cette fiche client ?')){
      var delId = parseInt(id, 10);
      afterAction(api('DELETE', '/api/admin/clients/' + delId));
      adminState.tab = 'clients';
      adminState.clientId = null;
    }
  } else if(action === 'add-vehicle'){
    openVehicleForm(id);
  } else if(action === 'edit-vehicle'){
    var c = findClient(id);
    var veh = c && c.vehicules.find(function(v){ return v.id === parseInt(did, 10); });
    if(veh) openVehicleForm(id, veh);
  } else if(action === 'remove-vehicle'){
    afterAction(api('DELETE', '/api/admin/vehicules/' + did));
  } else if(action === 'add-devis'){
    openDocForm(id, 'quote');
  } else if(action === 'add-facture'){
    openDocForm(id, 'invoice');
  } else if(action === 'edit-quote' || action === 'edit-invoice'){
    var kind = action === 'edit-quote' ? 'quote' : 'invoice';
    var cl = findClient(id);
    var list = kind === 'quote' ? (cl && cl.quotes) : (cl && cl.invoices);
    var entry = list && list.find(function(x){ return x.id === parseInt(did, 10); });
    if(entry) openDocForm(id, kind, entry);
  } else if(action === 'delete-quote'){
    if(confirm('Supprimer ce devis ?')) afterAction(api('DELETE', '/api/admin/quotes/' + did));
  } else if(action === 'delete-invoice'){
    if(confirm('Supprimer cette facture ?')) afterAction(api('DELETE', '/api/admin/invoices/' + did));
  } else if(action === 'save-notes'){
    var val = document.getElementById('clientNotes').value;
    afterAction(api('PATCH', '/api/admin/clients/' + id + '/notes', {notes: val}));
  }
});

document.getElementById('adminApp').addEventListener('change', function(e){
  var target = e.target.closest('[data-change]');
  if(!target) return;
  var action = target.getAttribute('data-change');
  var did = target.getAttribute('data-did');
  var value = target.value;

  if(action === 'set-quote-status'){
    afterAction(api('PATCH', '/api/admin/quotes/' + did, {statut: value}));
  } else if(action === 'set-invoice-status'){
    afterAction(api('PATCH', '/api/admin/invoices/' + did, {statut: value}));
  }
});
