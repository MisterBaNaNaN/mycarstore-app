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
function fmtFrDateTime(isoStr){
  if(!isoStr) return '—';
  return new Date(isoStr).toLocaleString('fr-FR', {day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'});
}
function creneauStartMinutes(creneau){
  var m = /(\d{1,2})h(\d{2})?/.exec(creneau || '');
  if(!m) return 9999;
  var h = parseInt(m[1], 10);
  var mi = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + mi;
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
var STATE = {status:{mode:'open'}, appointments:[], clients:[], alerts:[], testimonials:[], adminUsers:[], fidelity:{threshold:5, reward:'une remise fidélité'}, docTemplates:[], overloadThreshold:6};
var CURRENT_USERNAME = null;
var adminState = {tab:'dashboard', clientId:null, calMonth:null};
var REPORTS = null;

/* ---------- notifications navigateur (nouvelles demandes / avis) ---------- */
var pollTimer = null;
var NEGATIVE_REVIEW_THRESHOLD = 2;
var notifyBaseline = {initialized:false, pendingAppointments:0, pendingTestimonials:0, negativeIds:[]};

function pendingCounts(){
  return {
    pendingAppointments: STATE.appointments.filter(function(a){ return a.status === 'en_attente'; }).length,
    pendingTestimonials: (STATE.testimonials || []).filter(function(t){ return !t.published; }).length,
    negativeIds: (STATE.testimonials || []).filter(function(t){ return t.note <= NEGATIVE_REVIEW_THRESHOLD; }).map(function(t){ return t.id; })
  };
}

function syncNotifyBaseline(){
  var c = pendingCounts();
  notifyBaseline.pendingAppointments = c.pendingAppointments;
  notifyBaseline.pendingTestimonials = c.pendingTestimonials;
  notifyBaseline.negativeIds = c.negativeIds;
  notifyBaseline.initialized = true;
}

function notifyBrowser(title, body){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    var n = new Notification(title, {body: body, tag: title});
    n.onclick = function(){ window.focus(); n.close(); };
  } catch(e){}
}

function pollForUpdates(){
  api('GET', '/api/admin/state').then(function(data){
    STATE = data;
    var c = pendingCounts();
    if(notifyBaseline.initialized){
      if(c.pendingAppointments > notifyBaseline.pendingAppointments){
        notifyBrowser('Nouvelle demande de rendez-vous', (c.pendingAppointments - notifyBaseline.pendingAppointments) + ' nouvelle(s) demande(s) en attente.');
      }
      if(c.pendingTestimonials > notifyBaseline.pendingTestimonials){
        notifyBrowser('Nouvel avis client', 'Un avis est en attente de modération.');
      }
      var newNegatives = c.negativeIds.filter(function(id){ return notifyBaseline.negativeIds.indexOf(id) === -1; });
      newNegatives.forEach(function(id){
        var t = (STATE.testimonials || []).find(function(x){ return x.id === id; });
        if(t) notifyBrowser('⚠️ Avis négatif reçu', t.nom + ' — ' + t.note + ' étoile(s)');
      });
    }
    notifyBaseline.pendingAppointments = c.pendingAppointments;
    notifyBaseline.pendingTestimonials = c.pendingTestimonials;
    notifyBaseline.negativeIds = c.negativeIds;
    notifyBaseline.initialized = true;

    var modalOpen = !!document.getElementById('modalOverlay');
    if(!modalOpen && adminState.tab !== 'client'){
      renderAdmin();
    }
  }).catch(function(){});
}

function notificationButtonHtml(){
  if(!('Notification' in window)) return '';
  var perm = Notification.permission;
  if(perm === 'granted') return '<span class="btn btn-line btn-sm" style="opacity:0.65; cursor:default;">🔔 Notifications activées</span>';
  if(perm === 'denied') return '<span class="btn btn-line btn-sm" style="opacity:0.65; cursor:default;" title="Autorisez les notifications dans les réglages de votre navigateur pour ce site">🔕 Notifications bloquées</span>';
  return '<button type="button" class="btn btn-line btn-sm" data-action="enable-notifications">🔔 Activer les notifications</button>';
}

function loadReports(){
  return api('GET', '/api/admin/reports').then(function(data){
    REPORTS = data;
    renderAdmin();
  }).catch(function(err){
    if(err && err.message === 'unauthenticated') return;
    notice('Impossible de charger les rapports.', 'warn');
  });
}

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
    .then(function(res){ return refreshState().then(function(){ return res; }); })
    .then(function(res){
      var msg = typeof okMsg === 'function' ? okMsg(res) : okMsg;
      if(msg) notice(msg, 'ok');
    })
    .catch(function(err){
      if(err && err.message === 'unauthenticated') return;
      notice('Échec de l\'enregistrement.', 'warn');
    });
}

function notifiedSummary(res){
  var n = res && res.notified;
  if(!n) return null;
  var sent = [];
  if(n.email && n.email.ok) sent.push('e-mail');
  if(n.sms && n.sms.ok) sent.push('SMS');
  if(sent.length) return 'Client prévenu par ' + sent.join(' et ') + '.';
  var failed = (n.email && n.email.error) || (n.sms && n.sms.error);
  if(failed) return 'Échec de la notification au client (vérifiez la config e-mail/SMS).';
  return null;
}

/* ---------- login flow ---------- */
function showLoginGate(){
  document.getElementById('loginGate').hidden = false;
  document.getElementById('adminApp').hidden = true;
}
function startAdmin(){
  document.getElementById('loginGate').hidden = true;
  document.getElementById('adminApp').hidden = false;
  refreshState().then(syncNotifyBaseline);
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollForUpdates, 25000);
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
  }).then(function(data){
    CURRENT_USERNAME = data.username;
    form.reset();
    startAdmin();
  }).catch(function(){
    errorEl.textContent = 'Identifiant ou mot de passe incorrect.';
    errorEl.classList.add('show');
  });
});

fetch('/api/me', {credentials:'include'}).then(function(r){
  if(!r.ok){ showLoginGate(); return; }
  r.json().then(function(data){
    CURRENT_USERNAME = data.username;
    startAdmin();
  });
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
      (STATE.docTemplates.length
        ? '<div class="field" style="margin-bottom:16px;"><label>Charger un modèle</label><select id="templateSelect">' +
            '<option value="">— Choisir un modèle —</option>' +
            STATE.docTemplates.map(function(t){ return '<option value="' + t.id + '">' + escapeHtml(t.nom) + '</option>'; }).join('') +
          '</select></div>'
        : '') +
      '<label style="display:block; margin-bottom:8px;">Lignes<span class="req">*</span></label>' +
      '<div id="docItems"></div>' +
      '<div class="row-actions" style="margin-top:6px;">' +
        '<button type="button" id="addLineBtn" class="btn btn-line btn-sm">+ Ajouter une ligne</button>' +
        '<button type="button" id="saveTemplateBtn" class="btn btn-line btn-sm">Enregistrer comme modèle</button>' +
        (STATE.docTemplates.length ? '<button type="button" id="manageTemplatesBtn" class="btn btn-line btn-sm">Gérer les modèles</button>' : '') +
      '</div>' +
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
      (kind === 'quote' ? '<label class="di-deferred-label" title="Le client n\'a pas retenu cette ligne — la proposer au prochain passage"><input type="checkbox" class="di-deferred"' + (prefill && prefill.deferred ? ' checked' : '') + '> Reporté</label>' : '') +
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

  var templateSelect = document.getElementById('templateSelect');
  if(templateSelect){
    templateSelect.addEventListener('change', function(){
      var tpl = STATE.docTemplates.find(function(t){ return t.id === parseInt(templateSelect.value, 10); });
      if(!tpl) return;
      var rows = itemsWrap.querySelectorAll('.doc-item-row');
      if(rows.length === 1 && !rows[0].querySelector('.di-label').value.trim()){ rows[0].remove(); }
      tpl.items.forEach(function(it){ addRow(it); });
      updateGrandTotal();
      templateSelect.value = '';
    });
  }

  document.getElementById('saveTemplateBtn').addEventListener('click', function(){
    var items = [];
    itemsWrap.querySelectorAll('.doc-item-row').forEach(function(row){
      var label = row.querySelector('.di-label').value.trim();
      var qty = parseFloat(row.querySelector('.di-qty').value) || 0;
      var price = parseFloat(row.querySelector('.di-price').value) || 0;
      if(label && qty > 0){ items.push({label:label, qty:qty, price:price}); }
    });
    if(items.length === 0){ notice('Ajoutez au moins une ligne avant d\'enregistrer un modèle.', 'warn'); return; }
    var nom = prompt('Nom du modèle (ex. « Vidange standard ») :', '');
    if(!nom || !nom.trim()) return;
    afterAction(api('POST', '/api/admin/templates', {nom: nom.trim(), items: items}), 'Modèle enregistré.');
  });

  var manageTemplatesBtn = document.getElementById('manageTemplatesBtn');
  if(manageTemplatesBtn){
    manageTemplatesBtn.addEventListener('click', openTemplatesManager);
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var items = [];
    itemsWrap.querySelectorAll('.doc-item-row').forEach(function(row){
      var label = row.querySelector('.di-label').value.trim();
      var qty = parseFloat(row.querySelector('.di-qty').value) || 0;
      var price = parseFloat(row.querySelector('.di-price').value) || 0;
      var deferredBox = row.querySelector('.di-deferred');
      if(label && qty > 0){ items.push({label:label, qty:qty, price:price, deferred: deferredBox ? deferredBox.checked : false}); }
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

function openTemplatesManager(){
  if(!confirm('Ouvrir la gestion des modèles ? Le formulaire en cours sera fermé (les lignes non enregistrées seront perdues).')) return;
  renderTemplatesManagerModal();
}

function renderTemplatesManagerModal(){
  var rows = STATE.docTemplates.map(function(t){
    return '<tr><td>' + escapeHtml(t.nom) + '</td><td class="muted">' + t.items.length + ' ligne(s)</td>' +
      '<td><button type="button" class="btn btn-line" data-tpl-id="' + t.id + '">Supprimer</button></td></tr>';
  }).join('');
  openModal(
    '<h3>Modèles de devis/factures</h3>' +
    (STATE.docTemplates.length
      ? '<div style="overflow-x:auto; margin-bottom:16px;"><table class="admin-table"><thead><tr><th>Nom</th><th>Lignes</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="admin-empty" style="margin-bottom:16px;">Aucun modèle enregistré. Créez-en un depuis un devis ou une facture, avec « Enregistrer comme modèle ».</div>') +
    '<div class="modal-actions"><button type="button" class="btn btn-line" data-close>Fermer</button></div>'
  );
  document.querySelectorAll('[data-tpl-id]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!confirm('Supprimer ce modèle ?')) return;
      api('DELETE', '/api/admin/templates/' + btn.getAttribute('data-tpl-id'))
        .then(refreshState)
        .then(renderTemplatesManagerModal)
        .catch(function(){ notice('Échec de la suppression.', 'warn'); });
    });
  });
  document.querySelector('[data-close]').onclick = closeModal;
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

function openFidelityForm(){
  var f = STATE.fidelity || {threshold:5, reward:'une remise fidélité'};
  openModal(
    '<h3>Programme de fidélité</h3>' +
    '<form id="fidForm">' +
      '<div class="field" style="margin-bottom:16px;"><label>Récompense tous les X entretiens payés<span class="req">*</span></label><input type="number" name="threshold" min="1" max="100" step="1" required value="' + escapeHtml(f.threshold) + '"></div>' +
      '<div class="field" style="margin-bottom:16px;"><label>Récompense offerte<span class="req">*</span></label><input type="text" name="reward" required placeholder="Ex. une vidange offerte" value="' + escapeHtml(f.reward) + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">Enregistrer</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('fidForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var threshold = parseInt(form.threshold.value, 10);
    var reward = form.reward.value.trim();
    if(!(threshold >= 1) || !reward) return;
    afterAction(api('POST', '/api/admin/fidelity', {threshold: threshold, reward: reward}));
    closeModal();
  });
}

function openOverloadForm(){
  var threshold = STATE.overloadThreshold || 6;
  openModal(
    '<h3>Alerte de surcharge</h3>' +
    '<p style="color:var(--steel); font-size:0.88rem; margin-bottom:18px; line-height:1.5;">Un jour est signalé sur le tableau de bord dès qu\'il atteint ce nombre de rendez-vous (annulés exclus).</p>' +
    '<form id="overloadForm">' +
      '<div class="field" style="margin-bottom:16px;"><label>Seuil (RDV / jour)<span class="req">*</span></label><input type="number" name="threshold" min="1" max="50" step="1" required value="' + escapeHtml(threshold) + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">Enregistrer</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('overloadForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var val = parseInt(form.threshold.value, 10);
    if(!(val >= 1)) return;
    afterAction(api('POST', '/api/admin/overload-threshold', {threshold: val}));
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
        (veh ? '<div class="party"><h3>Véhicule</h3><p>' + escapeHtml([veh.marque, veh.modele].filter(Boolean).join(' ')) + (veh.immat ? '<br>Immat. ' + escapeHtml(veh.immat) : '') + (veh.annee ? '<br>Année ' + escapeHtml(veh.annee) : '') + (veh.km ? '<br>Kilométrage : ' + escapeHtml(veh.km) + ' km' : '') + '</p></div>' : '') +
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
    '<p class="hint" style="margin-bottom:20px;">' + escapeHtml(fmtFr(a.date)) + ' · ' + escapeHtml(a.creneau || '') +
      (a.reminderSent ? ' · <span style="color:var(--lime);">Rappel envoyé ✓</span>' : '') +
    '</p>' +
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
        api('PATCH', '/api/admin/appointments/' + apptId, {status: status}).then(function(res){
          a.status = status;
          var msg = notifiedSummary(res);
          if(msg) notice(msg, 'ok');
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
      '<div class="field-grid two" style="margin-bottom:8px;">' +
        '<div class="field"><label>Date<span class="req">*</span></label><input type="date" name="date" required value="' + escapeHtml(existing && existing.date || '') + '"></div>' +
        '<div class="field"><label>Créneau<span class="req">*</span></label><input type="text" name="creneau" required placeholder="Ex. 9h – 10h" value="' + escapeHtml(existing && existing.creneau || '') + '"></div>' +
      '</div>' +
      '<p class="hint" id="apptOverlapWarning" style="display:none; color:var(--warn); margin-bottom:16px;"></p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">' + (isEdit ? 'Enregistrer' : 'Créer le rendez-vous') + '</button>' +
      '</div>' +
    '</form>'
  );

  var form = document.getElementById('apptForm');
  form.querySelector('[data-close]').onclick = closeModal;

  var overlapWarning = document.getElementById('apptOverlapWarning');
  function findOverlap(){
    var date = form.date.value;
    var creneau = form.creneau.value.trim().toLowerCase();
    if(!date || !creneau) return null;
    return STATE.appointments.find(function(a){
      return a.date === date && a.creneau.trim().toLowerCase() === creneau && a.status !== 'annule' && (!isEdit || a.id !== existing.id);
    });
  }
  function checkOverlap(){
    var conflict = findOverlap();
    if(conflict){
      overlapWarning.textContent = '⚠️ Ce créneau est déjà pris par ' + conflict.nom + ' (' + (APPT_STATUS_LABEL[conflict.status] || conflict.status) + ').';
      overlapWarning.style.display = 'block';
    } else {
      overlapWarning.style.display = 'none';
    }
  }
  form.date.addEventListener('change', checkOverlap);
  form.creneau.addEventListener('input', checkOverlap);
  checkOverlap();

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var services = Array.prototype.slice.call(form.querySelectorAll('input[name="service"]:checked')).map(function(i){ return i.value; });
    if(services.length === 0){
      document.getElementById('apptServiceChips').scrollIntoView({behavior:'smooth', block:'center'});
      return;
    }
    if(!form.checkValidity()){ form.reportValidity(); return; }
    if(findOverlap() && !confirm('Ce créneau est déjà pris. Créer quand même le rendez-vous ?')) return;
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
    afterAction(req, isEdit ? notifiedSummary : null);
    closeModal();
  });
}

/* ---------- render: dashboard ---------- */
var COMM_KIND_LABEL = {confirme:'Confirmation RDV', annule:'Annulation RDV', en_attente:'Remise en attente', modifie:'Modification RDV', rappel:'Rappel RDV (veille)', nps:'Sondage satisfaction (NPS)'};
var COMM_CHANNEL_LABEL = {email:'E-mail', sms:'SMS'};
var COMM_DETAIL_LABEL = {not_configured:'service non configuré', no_recipient:'pas de coordonnée valide', send_failed:"échec de l'envoi", exception:'erreur technique'};

function commLogHtml(list){
  if(!list || !list.length) return '<div class="admin-empty">Aucune communication envoyée pour le moment.</div>';
  var rows = list.map(function(c){
    var statusHtml = c.status === 'sent'
      ? '<span class="chip-status tone-paid"><span class="dot"></span>Envoyé</span>'
      : c.status === 'failed'
        ? '<span class="chip-status tone-overdue"><span class="dot"></span>Échec' + (COMM_DETAIL_LABEL[c.detail] ? ' — ' + COMM_DETAIL_LABEL[c.detail] : '') + '</span>'
        : '<span class="chip-status tone-sent"><span class="dot"></span>Non envoyé' + (COMM_DETAIL_LABEL[c.detail] ? ' — ' + COMM_DETAIL_LABEL[c.detail] : '') + '</span>';
    return '<tr>' +
      '<td class="muted">' + escapeHtml(fmtFrDateTime(c.createdAt)) + '</td>' +
      '<td>' + escapeHtml(COMM_CHANNEL_LABEL[c.channel] || c.channel) + '</td>' +
      '<td>' + escapeHtml(COMM_KIND_LABEL[c.kind] || c.kind) + '</td>' +
      '<td class="muted">' + escapeHtml(c.recipient || '—') + '</td>' +
      '<td>' + statusHtml + '</td>' +
    '</tr>';
  }).join('');
  return '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Date</th><th>Canal</th><th>Type</th><th>Destinataire</th><th>Statut</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function alertRows(alerts){
  if(!alerts.length) return '<div class="admin-empty">Aucune échéance CT ou révision à venir.</div>';
  var typeLabel = {ct:'Contrôle technique', revision:'Révision'};
  return '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Client</th><th>Véhicule</th><th>Type</th><th>Échéance</th><th></th></tr></thead><tbody>' +
    alerts.map(function(a){
      return '<tr>' +
        '<td>' + escapeHtml(a.clientNom) + '</td>' +
        '<td class="muted">' + escapeHtml(a.vehicule) + '</td>' +
        '<td>' + escapeHtml(typeLabel[a.type] || a.type) + '</td>' +
        '<td><span class="chip-status ' + (a.urgency === 'overdue' ? 'tone-overdue' : 'tone-soon') + '"><span class="dot"></span>' +
          (a.urgency === 'overdue' ? 'Dépassé — ' : 'Prévu ') + escapeHtml(fmtFr(a.dueDate)) +
        '</span></td>' +
        '<td><button type="button" class="btn btn-line" data-action="open-client" data-id="' + a.clientId + '">Voir la fiche</button></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

function renderDashboard(){
  var newCount = STATE.appointments.filter(function(a){ return a.status === 'en_attente'; }).length;
  var totalUnpaid = 0;
  STATE.clients.forEach(function(c){
    c.invoices.forEach(function(inv){ if(inv.statut === 'impayée') totalUnpaid += docTotal(inv); });
  });
  var st = STATE.status || {mode:'open'};
  var alerts = STATE.alerts || [];
  var overloadThreshold = STATE.overloadThreshold || 6;
  var overloadDays = [];
  (function(){
    var countsByDate = {};
    STATE.appointments.forEach(function(a){
      if(a.status === 'annule') return;
      countsByDate[a.date] = (countsByDate[a.date] || 0) + 1;
    });
    var today = new Date();
    for(var i = 0; i < 14; i++){
      var d = new Date(today);
      d.setDate(today.getDate() + i);
      var iso = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      if((countsByDate[iso] || 0) >= overloadThreshold){
        overloadDays.push({date: iso, count: countsByDate[iso]});
      }
    }
  })();

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
    '</div>' +
    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Alertes CT / Révision' + (alerts.length ? ' · ' + alerts.length : '') + '</h3></div>' +
      alertRows(alerts) +
    '</div>' +
    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Alerte de surcharge' + (overloadDays.length ? ' · ' + overloadDays.length : '') + '</h3><button type="button" class="btn btn-line" data-action="configure-overload">Configurer</button></div>' +
      (overloadDays.length
        ? '<p class="hint" style="margin-bottom:14px;">Seuil actuel : ' + overloadThreshold + ' RDV/jour.</p>' +
          '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Jour</th><th>RDV prévus</th></tr></thead><tbody>' +
            overloadDays.map(function(d){ return '<tr><td>' + escapeHtml(fmtFr(d.date)) + '</td><td><span class="chip-status tone-soon"><span class="dot"></span>' + d.count + '</span></td></tr>'; }).join('') +
          '</tbody></table></div>'
        : '<div class="admin-empty">Aucune journée surchargée dans les 14 prochains jours (seuil : ' + overloadThreshold + ' RDV/jour).</div>') +
    '</div>' +
    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Programme de fidélité</h3><button type="button" class="btn btn-line" data-action="configure-fidelity">Configurer</button></div>' +
      '<p class="hint" style="margin:0;">Récompense tous les <strong style="color:var(--paper);">' + (STATE.fidelity ? STATE.fidelity.threshold : 5) + '</strong> entretiens payés — « ' + escapeHtml(STATE.fidelity ? STATE.fidelity.reward : 'une remise fidélité') + ' ».</p>' +
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
    var dayAppts = (apptsByDate[iso] || []).slice().sort(function(a, b){ return creneauStartMinutes(a.creneau) - creneauStartMinutes(b.creneau); });
    var isToday = iso === todayIso;
    cells += '<div class="cal-day' + (isToday ? ' today' : '') + '">' +
      '<div class="cal-day-num">' + d + '</div>' +
      '<div class="cal-appts">' +
        dayAppts.map(function(a){
          var toneClass = a.status === 'confirme' ? 'cal-confirme' : a.status === 'annule' ? 'cal-annule' : 'cal-attente';
          return '<button type="button" class="cal-appt ' + toneClass + '" data-action="open-appt" data-id="' + a.id + '">' +
            '<span class="cal-appt-time">' + escapeHtml(a.creneau || '') + '</span> ' + escapeHtml(a.nom) +
          '</button>';
        }).join('') +
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
        '<button type="button" class="btn btn-line btn-sm" data-action="open-atelier" style="margin-left:auto;">Mode atelier</button>' +
        '<button type="button" class="btn btn-fill btn-sm" data-action="new-appt">+ Nouveau rendez-vous</button>' +
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

/* ---------- render: vue technicien / mode atelier ---------- */
function renderAtelier(){
  var dateIso = adminState.atelierDate || todayStr();
  var dayAppts = STATE.appointments.filter(function(a){ return a.date === dateIso && a.status !== 'annule'; })
    .slice().sort(function(a, b){ return creneauStartMinutes(a.creneau) - creneauStartMinutes(b.creneau); });

  var dateObj = new Date(dateIso + 'T00:00:00');
  var dateLabel = dateObj.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  dateLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  var cards = dayAppts.length
    ? dayAppts.map(function(a){
        var vehicule = [a.marque, a.modele].filter(Boolean).join(' ') || '—';
        var toneClass = a.status === 'confirme' ? 'atelier-confirme' : 'atelier-attente';
        return '<div class="atelier-card ' + toneClass + '">' +
          '<div class="atelier-time">' + escapeHtml(a.creneau || '') + '</div>' +
          '<div class="atelier-info">' +
            '<div class="atelier-nom">' + escapeHtml(a.nom) + '</div>' +
            '<div class="atelier-veh">' + escapeHtml(vehicule) + '</div>' +
            '<div class="atelier-services">' + escapeHtml((a.services || []).join(', ')) + '</div>' +
          '</div>' +
          apptStatusChip(a.status) +
        '</div>';
      }).join('')
    : '<div class="atelier-empty">Aucun rendez-vous ce jour-là.</div>';

  return '' +
    '<div class="atelier-view">' +
      '<div class="atelier-head">' +
        '<button type="button" class="btn btn-line" data-action="atelier-prev">← Veille</button>' +
        '<div class="atelier-date">' + escapeHtml(dateLabel) + (dateIso === todayStr() ? ' <span class="atelier-today-tag">Aujourd\'hui</span>' : '') + '</div>' +
        '<button type="button" class="btn btn-line" data-action="atelier-next">Lendemain →</button>' +
        '<button type="button" class="btn btn-fill" data-action="tab" data-tab="agenda" style="margin-left:auto;">Quitter le mode atelier</button>' +
      '</div>' +
      '<div class="atelier-list">' + cards + '</div>' +
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

  var fidelitySettings = STATE.fidelity || {threshold:5, reward:'une remise fidélité'};
  var FIDELITY_THRESHOLD = fidelitySettings.threshold || 5;
  var paidCount = c.invoices.filter(function(i){ return i.statut === 'payée'; }).length;
  var fidelityMod = paidCount % FIDELITY_THRESHOLD;
  var fidelityReady = paidCount > 0 && fidelityMod === 0;
  var fidelityRemaining = fidelityReady ? 0 : FIDELITY_THRESHOLD - fidelityMod;
  var fidelityPct = fidelityReady ? 100 : Math.round((fidelityMod / FIDELITY_THRESHOLD) * 100);

  var deferredItems = [];
  c.quotes.forEach(function(q){
    (q.items || []).forEach(function(it){
      if(it.deferred){ deferredItems.push({label: it.label, qty: it.qty, price: it.price, date: q.date}); }
    });
  });
  deferredItems.sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); });

  var linkedAppts = STATE.appointments.filter(function(a){ return a.clientId === c.id; });
  var possibleAppts = STATE.appointments.filter(function(a){
    if(a.clientId) return false;
    var telMatch = c.tel && a.tel && a.tel.replace(/\s+/g,'') === c.tel.replace(/\s+/g,'');
    var emailMatch = c.email && a.email && a.email.toLowerCase() === c.email.toLowerCase();
    var nomMatch = c.nom && a.nom && c.nom.trim().toLowerCase() === a.nom.trim().toLowerCase();
    return telMatch || emailMatch || nomMatch;
  });

  var timelineEvents = [];
  linkedAppts.forEach(function(a){
    timelineEvents.push({date: a.date, label: 'RDV — ' + (a.services || []).join(', '), sub: a.creneau, statusHtml: apptStatusChip(a.status)});
  });
  c.quotes.forEach(function(q){
    var toneQ = q.statut === 'accepté' ? 'tone-accepted' : q.statut === 'refusé' ? 'tone-declined' : 'tone-sent';
    timelineEvents.push({date: q.date, label: 'Devis — ' + q.items.map(function(it){ return it.label; }).join(', '), sub: eur(docTotal(q)), statusHtml: '<span class="chip-status ' + toneQ + '"><span class="dot"></span>' + escapeHtml(q.statut) + '</span>'});
  });
  c.invoices.forEach(function(inv){
    var toneI = inv.statut === 'payée' ? 'tone-paid' : 'tone-unpaid';
    timelineEvents.push({date: inv.date, label: 'Facture — ' + inv.items.map(function(it){ return it.label; }).join(', '), sub: eur(docTotal(inv)), statusHtml: '<span class="chip-status ' + toneI + '"><span class="dot"></span>' + escapeHtml(inv.statut) + '</span>'});
  });
  timelineEvents.sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); });
  var timelineHtml = timelineEvents.length
    ? '<div class="timeline">' + timelineEvents.map(function(ev){
        return '<div class="timeline-item">' +
          '<div class="timeline-dot"></div>' +
          '<div class="timeline-body">' +
            '<div class="timeline-head"><span class="timeline-date">' + escapeHtml(fmtFr(ev.date)) + '</span>' + ev.statusHtml + '</div>' +
            '<div class="timeline-label">' + escapeHtml(ev.label) + (ev.sub ? ' <span class="muted">· ' + escapeHtml(ev.sub) + '</span>' : '') + '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>'
    : '<div class="admin-empty">Aucun historique pour le moment.</div>';

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
      '<div class="admin-panel-head"><h3>Fidélité</h3></div>' +
      '<p class="hint" style="margin-bottom:14px;">' + paidCount + ' facture(s) payée(s) au total — une remise fidélité tous les ' + FIDELITY_THRESHOLD + ' entretiens.</p>' +
      '<div class="fidelity-track"><div class="fidelity-fill" style="width:' + fidelityPct + '%;"></div></div>' +
      '<p class="hint" style="margin-top:10px; margin-bottom:0;">' + (fidelityReady ? '🎉 Ce client a mérité : ' + escapeHtml(fidelitySettings.reward) + ' !' : 'Encore ' + fidelityRemaining + ' entretien(s) avant : ' + escapeHtml(fidelitySettings.reward) + '.') + '</p>' +
    '</div>' +

    (deferredItems.length
      ? '<div class="admin-panel">' +
          '<div class="admin-panel-head"><h3>Interventions recommandées mais reportées</h3></div>' +
          '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Intervention</th><th>Devis du</th><th>Montant</th></tr></thead><tbody>' +
            deferredItems.map(function(it){
              return '<tr><td>' + escapeHtml(it.label) + (it.qty > 1 ? ' (×' + it.qty + ')' : '') + '</td><td class="muted">' + escapeHtml(fmtFr(it.date)) + '</td><td>' + eur(it.qty * it.price) + '</td></tr>';
            }).join('') +
          '</tbody></table></div>' +
        '</div>'
      : '') +

    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Historique d\'activité</h3></div>' +
      timelineHtml +
    '</div>' +

    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Journal des communications</h3></div>' +
      commLogHtml(c.communications) +
      (c.npsResponses && c.npsResponses.length
        ? '<div style="margin-top:20px; padding-top:18px; border-top:1px solid var(--line);">' +
            '<h4 style="font-size:0.85rem; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:12px; color:var(--steel);">Réponses au sondage de satisfaction</h4>' +
            '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Date</th><th>Note</th><th>Message</th></tr></thead><tbody>' +
              c.npsResponses.map(function(n){
                return '<tr><td class="muted">' + escapeHtml(fmtFrDateTime(n.createdAt)) + '</td>' +
                  '<td>' + (n.score ? '<span class="chip-status ' + (n.score <= 2 ? 'tone-overdue' : n.score >= 4 ? 'tone-paid' : 'tone-sent') + '"><span class="dot"></span>' + n.score + ' / 5</span>' : '<span class="muted">Non reconnue</span>') + '</td>' +
                  '<td class="muted">' + escapeHtml(n.rawMessage) + '</td></tr>';
              }).join('') +
            '</tbody></table></div>' +
          '</div>'
        : '') +
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

/* ---------- render: reports ---------- */
function renderReports(){
  if(!REPORTS){
    return '' +
      '<div class="admin-section-title">Rapports</div>' +
      '<div class="admin-section-sub">Chargement…</div>';
  }
  var r = REPORTS;

  function monthLabel(m){
    var l = new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', {month:'short', year:'2-digit'});
    return l.charAt(0).toUpperCase() + l.slice(1);
  }
  function bars(values, formatValue){
    var max = Math.max.apply(null, values.concat([1]));
    return r.months.map(function(m, i){
      var v = values[i];
      var pct = max > 0 ? Math.round((v / max) * 100) : 0;
      return '<div class="bar-col">' +
        '<div class="bar-track"><div class="bar-fill" style="height:' + Math.max(pct, v > 0 ? 3 : 0) + '%;"></div></div>' +
        '<div class="bar-value">' + formatValue(v) + '</div>' +
        '<div class="bar-label">' + monthLabel(m) + '</div>' +
      '</div>';
    }).join('');
  }

  var apptsValues = r.months.map(function(m){ return r.apptsByMonth[m]; });
  var newClientsValues = r.months.map(function(m){ return r.newClientsByMonth[m]; });

  var topServicesRows = r.topServices.length
    ? r.topServices.map(function(s){ return '<tr><td>' + escapeHtml(s.label) + '</td><td>' + s.count + '</td></tr>'; }).join('')
    : '<tr><td colspan="2" class="admin-empty">Aucune donnée pour le moment.</td></tr>';

  var topBrandsRows = r.topBrands.length
    ? r.topBrands.map(function(s){ return '<tr><td>' + escapeHtml(s.label) + '</td><td>' + s.count + '</td></tr>'; }).join('')
    : '<tr><td colspan="2" class="admin-empty">Aucune donnée pour le moment.</td></tr>';

  var unpaidRows = r.unpaidInvoices.length
    ? r.unpaidInvoices.map(function(inv){
        return '<tr><td>' + escapeHtml(inv.clientNom) + '</td><td>' + escapeHtml(fmtFr(inv.date)) + '</td><td>' + eur(inv.total) + '</td>' +
          '<td><button type="button" class="btn btn-line" data-action="open-client" data-id="' + inv.clientId + '">Voir la fiche</button></td></tr>';
      }).join('')
    : '<tr><td colspan="4" class="admin-empty">Aucune facture impayée.</td></tr>';

  return '' +
    '<div class="admin-section-title">Rapports</div>' +
    '<div class="admin-section-sub">Activité de l\'atelier sur les 6 derniers mois.</div>' +
    '<div class="admin-grid">' +
      '<div class="stat-card"><div class="label">Taux de confirmation</div><div class="value ok">' + r.confirmationRate + ' %</div></div>' +
      '<div class="stat-card"><div class="label">Total impayé</div><div class="value' + (r.totalUnpaid > 0 ? ' warn' : ' ok') + '">' + eur(r.totalUnpaid) + '</div></div>' +
      '<div class="stat-card"><div class="label">Clients enregistrés</div><div class="value">' + r.clientCount + '</div></div>' +
    '</div>' +
    '<div class="admin-grid-2">' +
      '<div class="admin-panel">' +
        '<div class="admin-panel-head"><h3>Rendez-vous / mois</h3></div>' +
        '<div class="bar-chart">' + bars(apptsValues, function(v){ return String(v); }) + '</div>' +
      '</div>' +
      '<div class="admin-panel">' +
        '<div class="admin-panel-head"><h3>Nouveaux clients / mois</h3></div>' +
        '<div class="bar-chart">' + bars(newClientsValues, function(v){ return String(v); }) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Statuts des rendez-vous</h3></div>' +
      '<div class="admin-grid" style="margin-bottom:0;">' +
        '<div class="stat-card"><div class="label">En attente</div><div class="value warn">' + r.statusCounts.en_attente + '</div></div>' +
        '<div class="stat-card"><div class="label">Confirmés</div><div class="value ok">' + r.statusCounts.confirme + '</div></div>' +
        '<div class="stat-card"><div class="label">Annulés</div><div class="value">' + r.statusCounts.annule + '</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="admin-grid-2">' +
      '<div class="admin-panel">' +
        '<div class="admin-panel-head"><h3>Interventions les plus demandées</h3></div>' +
        '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Intervention</th><th>Nombre</th></tr></thead><tbody>' + topServicesRows + '</tbody></table></div>' +
      '</div>' +
      '<div class="admin-panel">' +
        '<div class="admin-panel-head"><h3>Marques les plus fréquentes</h3></div>' +
        '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Marque</th><th>Nombre</th></tr></thead><tbody>' + topBrandsRows + '</tbody></table></div>' +
      '</div>' +
    '</div>' +
    '<div class="admin-panel">' +
      '<div class="admin-panel-head"><h3>Factures impayées</h3></div>' +
      '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Client</th><th>Date</th><th>Montant</th><th></th></tr></thead><tbody>' + unpaidRows + '</tbody></table></div>' +
    '</div>';
}

/* ---------- render: testimonials (avis) ---------- */
function starsHtml(note){
  var s = '';
  for(var i = 1; i <= 5; i++){ s += i <= note ? '★' : '☆'; }
  return s;
}

function renderTestimonials(){
  var list = (STATE.testimonials || []).slice().sort(function(a, b){
    var aNeg = a.note <= NEGATIVE_REVIEW_THRESHOLD ? 0 : 1;
    var bNeg = b.note <= NEGATIVE_REVIEW_THRESHOLD ? 0 : 1;
    return aNeg - bNeg;
  });
  var negativeCount = list.filter(function(t){ return t.note <= NEGATIVE_REVIEW_THRESHOLD; }).length;
  var rows = list.map(function(t){
    var isNegative = t.note <= NEGATIVE_REVIEW_THRESHOLD;
    return '<tr' + (isNegative ? ' style="border-left:3px solid #ff5c5c;"' : '') + '>' +
      '<td><strong>' + escapeHtml(t.nom) + '</strong></td>' +
      '<td><span class="stars">' + starsHtml(t.note) + '</span>' + (isNegative ? ' <span class="chip-status tone-overdue"><span class="dot"></span>Négatif</span>' : '') + '</td>' +
      '<td class="muted" style="max-width:360px;">' + escapeHtml(t.texte) + '</td>' +
      '<td>' + (t.published
        ? '<span class="chip-status tone-paid"><span class="dot"></span>Publié</span>'
        : '<span class="chip-status tone-sent"><span class="dot"></span>Masqué</span>') + '</td>' +
      '<td><div class="row-actions">' +
        '<button type="button" class="btn btn-line" data-action="toggle-testimonial" data-id="' + t.id + '">' + (t.published ? 'Masquer' : 'Publier') + '</button>' +
        '<button type="button" class="btn btn-line" data-action="edit-testimonial" data-id="' + t.id + '">Modifier</button>' +
        '<button type="button" class="btn btn-line" data-action="delete-testimonial" data-id="' + t.id + '">Suppr.</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

  return '' +
    '<div class="admin-panel-head" style="margin-bottom:24px;">' +
      '<div><div class="admin-section-title" style="margin-bottom:6px;">Avis clients</div><div class="admin-section-sub" style="margin-bottom:0;">Les avis publiés apparaissent sur le site public.' + (negativeCount ? ' — <span style="color:#ff5c5c;">' + negativeCount + ' avis négatif' + (negativeCount > 1 ? 's' : '') + ' (2 étoiles ou moins) à traiter</span>' : '') + '</div></div>' +
      '<button type="button" class="btn btn-fill" data-action="new-testimonial">+ Ajouter un avis</button>' +
    '</div>' +
    '<div class="admin-panel">' +
      (list.length
        ? '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Client</th><th>Note</th><th>Avis</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="admin-empty">Aucun avis pour le moment.</div>') +
    '</div>';
}

function openTestimonialForm(existing){
  var isEdit = !!existing;
  var t = existing || {note:5, published:true};
  openModal(
    '<h3>' + (isEdit ? 'Modifier l\'avis' : 'Ajouter un avis') + '</h3>' +
    '<form id="testiForm">' +
      '<div class="field-grid two">' +
        '<div class="field"><label>Nom du client<span class="req">*</span></label><input type="text" name="nom" required value="' + escapeHtml(t.nom || '') + '"></div>' +
        '<div class="field"><label>Note</label><select name="note">' +
          [1,2,3,4,5].map(function(n){ return '<option value="' + n + '"' + (n === t.note ? ' selected' : '') + '>' + n + ' étoile' + (n > 1 ? 's' : '') + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>Avis<span class="req">*</span></label><textarea name="texte" required style="min-height:100px;">' + escapeHtml(t.texte || '') + '</textarea></div>' +
      '<div class="field"><label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:0.88rem;"><input type="checkbox" name="published" style="width:auto;"' + (t.published !== false ? ' checked' : '') + '> Visible sur le site public</label></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">' + (isEdit ? 'Enregistrer' : 'Ajouter') + '</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('testiForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var nom = form.nom.value.trim();
    var texte = form.texte.value.trim();
    if(!nom || !texte) return;
    var payload = {nom: nom, note: parseInt(form.note.value, 10), texte: texte, published: form.published.checked};
    var req = isEdit
      ? api('PATCH', '/api/admin/testimonials/' + t.id, payload)
      : api('POST', '/api/admin/testimonials', payload);
    afterAction(req);
    closeModal();
  });
}

/* ---------- render: comptes admin ---------- */
function renderAccounts(){
  var list = STATE.adminUsers || [];
  var rows = list.map(function(u){
    var isSelf = CURRENT_USERNAME && u.username === CURRENT_USERNAME;
    return '<tr>' +
      '<td><strong>' + escapeHtml(u.username) + '</strong>' + (isSelf ? ' <span class="muted">(vous)</span>' : '') + '</td>' +
      '<td class="muted">' + escapeHtml(fmtFr((u.createdAt || '').slice(0, 10))) + '</td>' +
      '<td>' + (list.length > 1 && !isSelf
        ? '<button type="button" class="btn btn-line" data-action="delete-account" data-id="' + u.id + '">Supprimer</button>'
        : '') + '</td>' +
    '</tr>';
  }).join('');

  return '' +
    '<div class="admin-panel-head" style="margin-bottom:24px;">' +
      '<div><div class="admin-section-title" style="margin-bottom:6px;">Comptes admin</div><div class="admin-section-sub" style="margin-bottom:0;">Personnes ayant accès à cet espace atelier.</div></div>' +
      '<button type="button" class="btn btn-fill" data-action="new-account">+ Nouveau compte</button>' +
    '</div>' +
    '<div class="admin-panel">' +
      '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Identifiant</th><th>Créé le</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '</div>';
}

function openAccountForm(){
  openModal(
    '<h3>Nouveau compte admin</h3>' +
    '<form id="accForm">' +
      '<div class="field" style="margin-bottom:16px;"><label>Identifiant<span class="req">*</span></label><input type="text" name="username" required autocomplete="off"></div>' +
      '<div class="field" style="margin-bottom:16px;"><label>Mot de passe (8 caractères min.)<span class="req">*</span></label><input type="password" name="password" required minlength="8" autocomplete="new-password"></div>' +
      '<p class="login-error" id="accError"></p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-line" data-close>Annuler</button>' +
        '<button type="submit" class="btn btn-fill">Créer le compte</button>' +
      '</div>' +
    '</form>'
  );
  var form = document.getElementById('accForm');
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var errorEl = document.getElementById('accError');
    errorEl.classList.remove('show');
    api('POST', '/api/admin/users', {username: form.username.value.trim(), password: form.password.value})
      .then(function(){ return refreshState(); })
      .then(function(){ notice('Compte créé.', 'ok'); closeModal(); })
      .catch(function(err){
        errorEl.textContent = err && err.status === 409 ? 'Cet identifiant est déjà utilisé.' : 'Identifiant ou mot de passe invalide (8 caractères min.).';
        errorEl.classList.add('show');
      });
  });
}

/* ---------- shell / router ---------- */
function renderAdmin(){
  var el = document.getElementById('adminApp');
  if(!el || el.hidden) return;

  if(adminState.tab === 'atelier'){
    el.innerHTML = renderAtelier();
    return;
  }

  var newCount = STATE.appointments.filter(function(a){ return a.status === 'en_attente'; }).length;
  var attentionTestimonials = (STATE.testimonials || []).filter(function(t){ return !t.published || t.note <= NEGATIVE_REVIEW_THRESHOLD; }).length;

  function tabBtn(key, label){
    var active = adminState.tab === key || (key === 'clients' && adminState.tab === 'client');
    return '<button type="button" class="admin-tab' + (active ? ' active' : '') + '" data-action="tab" data-tab="' + key + '">' + label + '</button>';
  }

  var content;
  if(adminState.tab === 'agenda') content = renderAgenda();
  else if(adminState.tab === 'appointments') content = renderAppointments();
  else if(adminState.tab === 'clients') content = renderClients();
  else if(adminState.tab === 'client') content = renderClientDetail(adminState.clientId);
  else if(adminState.tab === 'reports') content = renderReports();
  else if(adminState.tab === 'testimonials') content = renderTestimonials();
  else if(adminState.tab === 'accounts') content = renderAccounts();
  else content = renderDashboard();

  el.innerHTML =
    '<div class="admin-topbar"><div class="wrap bar">' +
      '<span class="logo"><span class="m">MY</span>CARSTORE<span style="color:var(--steel); font-family:var(--font-mono); font-size:0.65rem; margin-left:10px; letter-spacing:0.1em;">ADMIN</span></span>' +
      '<div class="admin-tabs">' +
        tabBtn('dashboard', 'Tableau de bord') +
        tabBtn('agenda', 'Agenda') +
        tabBtn('appointments', 'Rendez-vous' + (newCount ? ' · ' + newCount : '')) +
        tabBtn('clients', 'Clients') +
        tabBtn('reports', 'Rapports') +
        tabBtn('testimonials', 'Avis' + (attentionTestimonials ? ' · ' + attentionTestimonials : '')) +
        tabBtn('accounts', 'Comptes') +
      '</div>' +
      '<div class="row-actions">' +
        notificationButtonHtml() +
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
    if(adminState.tab === 'reports') loadReports();
  } else if(action === 'logout'){
    if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
    api('POST', '/api/logout').then(function(){ showLoginGate(); }).catch(function(){});
  } else if(action === 'enable-notifications'){
    if('Notification' in window) Notification.requestPermission().then(function(){ renderAdmin(); });
  } else if(action === 'change-password'){
    openPasswordForm();
  } else if(action === 'set-status-open'){
    afterAction(api('POST', '/api/admin/status', {mode:'open'}));
  } else if(action === 'set-status-closed-today'){
    afterAction(api('POST', '/api/admin/status', {mode:'closed_today', closedTodayDate: todayStr()}));
  } else if(action === 'open-vacation-modal'){
    openVacationForm();
  } else if(action === 'configure-fidelity'){
    openFidelityForm();
  } else if(action === 'configure-overload'){
    openOverloadForm();
  } else if(action === 'confirm-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id, {status:'confirme'}), notifiedSummary);
  } else if(action === 'cancel-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id, {status:'annule'}), notifiedSummary);
  } else if(action === 'pending-appt'){
    afterAction(api('PATCH', '/api/admin/appointments/' + id, {status:'en_attente'}), notifiedSummary);
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
  } else if(action === 'open-atelier'){
    adminState.atelierDate = todayStr();
    adminState.tab = 'atelier';
    renderAdmin();
  } else if(action === 'atelier-prev' || action === 'atelier-next'){
    var ad = new Date((adminState.atelierDate || todayStr()) + 'T00:00:00');
    ad.setDate(ad.getDate() + (action === 'atelier-next' ? 1 : -1));
    adminState.atelierDate = ad.getFullYear() + '-' + pad2(ad.getMonth() + 1) + '-' + pad2(ad.getDate());
    renderAdmin();
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
  } else if(action === 'new-testimonial'){
    openTestimonialForm(null);
  } else if(action === 'edit-testimonial'){
    var testi = (STATE.testimonials || []).find(function(t){ return t.id === parseInt(id, 10); });
    if(testi) openTestimonialForm(testi);
  } else if(action === 'toggle-testimonial'){
    var toToggle = (STATE.testimonials || []).find(function(t){ return t.id === parseInt(id, 10); });
    if(toToggle) afterAction(api('PATCH', '/api/admin/testimonials/' + id, {nom: toToggle.nom, note: toToggle.note, texte: toToggle.texte, published: !toToggle.published}));
  } else if(action === 'delete-testimonial'){
    if(confirm('Supprimer cet avis ?')) afterAction(api('DELETE', '/api/admin/testimonials/' + id));
  } else if(action === 'new-account'){
    openAccountForm();
  } else if(action === 'delete-account'){
    if(confirm('Supprimer ce compte admin ?')) afterAction(api('DELETE', '/api/admin/users/' + id));
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
    afterAction(api('PATCH', '/api/admin/invoices/' + did, {statut: value}), notifiedSummary);
  }
});
