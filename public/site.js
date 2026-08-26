document.getElementById('year').textContent = new Date().getFullYear();

var header = document.getElementById('siteHeader');
var onScroll = function(){
  if(window.scrollY > 24){ header.classList.add('scrolled'); }
  else{ header.classList.remove('scrolled'); }
};
onScroll();
window.addEventListener('scroll', onScroll, {passive:true});

var toggle = document.getElementById('navToggle');
var nav = document.getElementById('primaryNav');
toggle.addEventListener('click', function(){
  var open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});
nav.querySelectorAll('a').forEach(function(a){
  a.addEventListener('click', function(){
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  });
});

var days = ['row-dim','row-lun','row-mar','row-mer','row-jeu','row-ven','row-sam'];
document.querySelectorAll('.hours-table tr').forEach(function(tr){ tr.classList.remove('today'); });
var todayRow = document.getElementById(days[new Date().getDay()]);
if(todayRow && !todayRow.classList.contains('closed')){ todayRow.classList.add('today'); }

/* ---------- live open/closed status ---------- */
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function todayStr(){
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function fmtFr(dateStr){
  if(!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'});
}

var dayNames = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
function hoursForDay(dow){
  if(dow >= 1 && dow <= 5) return {start:9, end:18.5};
  if(dow === 6) return {start:9, end:14};
  return null;
}
function computeOpenStatus(siteStatus){
  var st = siteStatus || {mode:'open'};
  var today = todayStr();

  if(st.mode === 'vacation' && st.vacationUntil && today <= st.vacationUntil){
    var untilFmt = fmtFr(st.vacationUntil);
    return {open:false, override:true, text:'Fermeture exceptionnelle — retour le ' + untilFmt, bannerText:'Fermeture exceptionnelle : l\'atelier est fermé jusqu\'au ' + untilFmt + '.'};
  }
  if(st.mode === 'closed_today' && st.closedTodayDate === today){
    return {open:false, override:true, text:"Fermé aujourd'hui", bannerText:"Fermé aujourd'hui — réouverture demain aux horaires habituels."};
  }

  var now = new Date();
  var dow = now.getDay();
  var hourFloat = now.getHours() + now.getMinutes() / 60;
  var todayHours = hoursForDay(dow);

  if(todayHours && hourFloat >= todayHours.start && hourFloat < todayHours.end){
    return {open:true, text:'Ouvert actuellement'};
  }
  if(todayHours && hourFloat < todayHours.start){
    return {open:false, text:"Ouvre aujourd'hui à 9h"};
  }
  for(var i = 1; i <= 7; i++){
    var nd = (dow + i) % 7;
    if(hoursForDay(nd)){
      var label = i === 1 ? 'demain' : dayNames[nd];
      return {open:false, text:'Fermé — ouvre ' + label + ' à 9h'};
    }
  }
  return {open:false, text:'Fermé'};
}

function renderOpenStatus(siteStatus){
  var s = computeOpenStatus(siteStatus);
  var pill = document.getElementById('statusPill');
  var pillText = document.getElementById('statusPillText');
  var heroText = document.getElementById('heroStatusText');
  var banner = document.getElementById('closureBanner');
  var bannerText = document.getElementById('closureBannerText');
  if(pill){ pill.classList.toggle('open', s.open); }
  if(pillText){ pillText.textContent = s.open ? 'Ouvert' : 'Fermé'; }
  if(heroText){ heroText.textContent = s.text; }
  if(banner){
    banner.hidden = !s.override;
    if(s.override && bannerText){ bannerText.textContent = s.bannerText || s.text; }
  }
}

function refreshPublicStatus(){
  fetch('/api/public-status')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){ if(data) renderOpenStatus(data); })
    .catch(function(){ renderOpenStatus({mode:'open'}); });
}
refreshPublicStatus();
setInterval(refreshPublicStatus, 60000);

/* ---------- rendez-vous form ---------- */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function slotsForDay(day){
  if(day === 0) return null;
  if(day === 6) return ['9h – 10h','10h – 11h','11h – 12h','12h – 13h','13h – 14h'];
  return ['9h – 10h','10h – 11h','11h – 12h','12h – 13h','13h – 14h','14h – 15h','15h – 16h','16h – 17h','17h – 18h30'];
}

var rdvForm = document.getElementById('rdvForm');
if(rdvForm){
  var dateInput = document.getElementById('f-date');
  var creneauSelect = document.getElementById('f-creneau');
  var dateHint = document.getElementById('dateHint');
  var formStatusEl = document.getElementById('formStatus');

  var todayDate = new Date();
  dateInput.min = todayDate.getFullYear() + '-' + pad2(todayDate.getMonth() + 1) + '-' + pad2(todayDate.getDate());

  function refreshSlots(){
    var val = dateInput.value;
    creneauSelect.innerHTML = '';

    if(!val){
      var ph0 = document.createElement('option');
      ph0.value = ''; ph0.disabled = true; ph0.selected = true;
      ph0.textContent = "Choisir une date d'abord";
      creneauSelect.appendChild(ph0);
      dateInput.setCustomValidity('');
      dateHint.textContent = 'Lun–ven 9h–18h30 · sam 9h–14h · fermé le dimanche.';
      dateHint.classList.remove('warn');
      return;
    }

    var d = new Date(val + 'T00:00:00');
    var day = d.getDay();
    var slots = slotsForDay(day);

    if(!slots){
      dateInput.setCustomValidity('Fermé le dimanche — merci de choisir un autre jour.');
      dateHint.textContent = 'Fermé le dimanche : choisissez un autre jour.';
      dateHint.classList.add('warn');
      var phClosed = document.createElement('option');
      phClosed.value = ''; phClosed.disabled = true; phClosed.selected = true;
      phClosed.textContent = 'Atelier fermé ce jour';
      creneauSelect.appendChild(phClosed);
      return;
    }

    dateInput.setCustomValidity('');
    dateHint.classList.remove('warn');
    dateHint.textContent = day === 6
      ? 'Samedi : atelier ouvert 9h – 14h.'
      : 'Jour ouvré : atelier ouvert 9h – 18h30.';

    var ph = document.createElement('option');
    ph.value = ''; ph.disabled = true; ph.selected = true;
    ph.textContent = 'Choisir un créneau';
    creneauSelect.appendChild(ph);
    slots.forEach(function(s){
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      creneauSelect.appendChild(o);
    });
  }
  dateInput.addEventListener('change', refreshSlots);
  refreshSlots();

  rdvForm.addEventListener('submit', function(e){
    e.preventDefault();

    var services = Array.prototype.slice.call(rdvForm.querySelectorAll('input[name="service"]:checked'))
      .map(function(i){ return i.value; });

    if(services.length === 0){
      formStatusEl.textContent = "Merci de sélectionner au moins un type d'intervention.";
      formStatusEl.classList.add('show');
      document.getElementById('serviceChips').scrollIntoView({behavior:'smooth', block:'center'});
      return;
    }

    if(!rdvForm.checkValidity()){
      rdvForm.reportValidity();
      formStatusEl.textContent = "Merci de vérifier les champs marqués d'un astérisque.";
      formStatusEl.classList.add('show');
      return;
    }

    formStatusEl.classList.remove('show');

    var nom = rdvForm.nom.value.trim();
    var tel = rdvForm.tel.value.trim();
    var email = rdvForm.email.value.trim();
    var marque = rdvForm.marque.value.trim();
    var modele = rdvForm.modele.value.trim();
    var annee = rdvForm.annee.value.trim();
    var km = rdvForm.km.value.trim();
    var immat = rdvForm.immat.value.trim();
    var message = rdvForm.message.value.trim();
    var pret = rdvForm.pret.checked;
    var dateVal = rdvForm.date.value;
    var creneau = rdvForm.creneau.value;
    var flexible = rdvForm.flexible.checked;
    var contactpref = rdvForm.querySelector('input[name="contactpref"]:checked').value;

    var submitBtn = rdvForm.querySelector('.form-submit');
    var originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi en cours…';

    fetch('/api/appointments', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({nom, tel, email, marque, modele, annee, km, immat, services, message, pret, date: dateVal, creneau, flexible, contactpref})
    }).then(function(r){
      if(!r.ok) throw new Error('request_failed');
      return r.json();
    }).then(function(){
      renderSummary();
    }).catch(function(){
      formStatusEl.textContent = "L'envoi a échoué — vérifiez votre connexion et réessayez, ou appelez directement l'atelier.";
      formStatusEl.classList.add('show');
    }).finally(function(){
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    });

    function renderSummary(){
      var dateObj = new Date(dateVal + 'T00:00:00');
      var dateFmt = dateObj.toLocaleDateString('fr-FR', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
      var vehicule = [marque, modele].filter(Boolean).join(' ');

      var rows = [];
      rows.push(['Nom', nom]);
      rows.push(['Téléphone', tel]);
      rows.push(['E-mail', email]);
      rows.push(['Véhicule', vehicule || '—']);
      if(annee) rows.push(['Année', annee]);
      if(km) rows.push(['Kilométrage', km + ' km']);
      if(immat) rows.push(['Immat.', immat]);
      rows.push(['Intervention', services.join(', ')]);
      if(message) rows.push(['Détails', message]);
      rows.push(['Date souhaitée', dateFmt]);
      rows.push(['Créneau', creneau]);
      if(flexible) rows.push(['Flexible', 'Oui']);
      if(pret) rows.push(['Véhicule de prêt', 'Souhaité']);
      rows.push(['Contact préféré', contactpref]);

      var refNum = 'RDV-' + Date.now().toString().slice(-6);
      document.getElementById('summaryNum').textContent = refNum;
      document.getElementById('summaryEmpty').style.display = 'none';
      var list = document.getElementById('summaryList');
      list.style.display = 'block';
      list.innerHTML = rows.map(function(r){
        return '<div class="ticket-row"><dt>' + escapeHtml(r[0]) + '</dt><dd>' + escapeHtml(r[1]) + '</dd></div>';
      }).join('');

      var fullLines = [
        'Nouvelle demande de rendez-vous — MyCarStore (réf. ' + refNum + ')',
        '', 'CLIENT',
        'Nom : ' + nom, 'Téléphone : ' + tel, 'E-mail : ' + email,
        '', 'VÉHICULE', 'Véhicule : ' + (vehicule || 'non précisé')
      ];
      if(annee) fullLines.push('Année : ' + annee);
      if(km) fullLines.push('Kilométrage : ' + km + ' km');
      if(immat) fullLines.push('Immatriculation : ' + immat);
      fullLines.push('', 'DEMANDE', 'Intervention(s) : ' + services.join(', '));
      if(message) fullLines.push('Détails : ' + message);
      if(pret) fullLines.push('Véhicule de prêt souhaité (sous réserve de disponibilité)');
      fullLines.push('', 'CRÉNEAU SOUHAITÉ', 'Date : ' + dateFmt, 'Heure : ' + creneau, 'Flexible : ' + (flexible ? 'oui' : 'non'));
      fullLines.push('', 'Contact préféré : ' + contactpref);
      var fullSummary = fullLines.join('\n');

      var smsSummary = 'RDV MyCarStore - ' + nom + ' (' + tel + ') - ' +
        (vehicule || 'véhicule non précisé') + ' - ' + services.join('/') +
        ' - souhaité ' + dateFmt + ' ' + creneau + (message ? ' - Détails: ' + message : '');
      if(smsSummary.length > 480) smsSummary = smsSummary.slice(0, 477) + '…';

      var mailSubject = 'Demande de rendez-vous — ' + nom + ' (' + refNum + ')';
      document.getElementById('btnMail').href =
        'mailto:contact@mycarstore.fr?subject=' + encodeURIComponent(mailSubject) + '&body=' + encodeURIComponent(fullSummary);
      document.getElementById('btnSms').href =
        'sms:0640658409?&body=' + encodeURIComponent(smsSummary);

      var creneauMatch = creneau.match(/(\d{1,2})h(\d{2})?\s*–\s*(\d{1,2})h(\d{2})?/);
      if(creneauMatch){
        var sH = parseInt(creneauMatch[1], 10), sM = creneauMatch[2] ? parseInt(creneauMatch[2], 10) : 0;
        var eH = parseInt(creneauMatch[3], 10), eM = creneauMatch[4] ? parseInt(creneauMatch[4], 10) : 0;
        var fmtDate = function(h, mi){
          return '' + dateObj.getFullYear() + pad2(dateObj.getMonth() + 1) + pad2(dateObj.getDate()) + 'T' + pad2(h) + pad2(mi) + '00';
        };
        var calUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
          + '&text=' + encodeURIComponent('RDV MyCarStore' + (vehicule ? ' — ' + vehicule : ''))
          + '&dates=' + fmtDate(sH, sM) + '/' + fmtDate(eH, eM)
          + '&details=' + encodeURIComponent(fullSummary)
          + '&location=' + encodeURIComponent('434 rue de la Basinière, ZAC des Tourelles, 90120 Morvillars')
          + '&ctz=Europe/Paris';
        document.getElementById('btnCal').href = calUrl;
      }

      document.getElementById('summaryActions').classList.add('show');

      var copyBtn = document.getElementById('btnCopy');
      copyBtn.onclick = function(){
        var btn = this;
        var restore = function(){ btn.textContent = 'Copier le récapitulatif'; btn.classList.remove('copied'); };
        navigator.clipboard.writeText(fullSummary).then(function(){
          btn.textContent = 'Copié ✓';
          btn.classList.add('copied');
          setTimeout(restore, 2000);
        }).catch(function(){
          btn.textContent = 'Copie impossible — sélectionnez le texte';
          setTimeout(restore, 2500);
        });
      };

      document.querySelector('.rdv-summary').scrollIntoView({behavior:'smooth', block:'start'});
    }
  });
}
