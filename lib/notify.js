/* Best-effort transactional email (Resend) and SMS (Twilio) sending.
   Every function resolves to {ok, skipped, error} — never throws — so a
   notification failure never blocks the admin action that triggered it. */

const db = require('./db');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'MyCarStore <onboarding@resend.dev>';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

async function sendEmail({ to, subject, text }) {
  if (!to) return { ok: false, skipped: 'no_recipient' };
  if (!RESEND_API_KEY) return { ok: false, skipped: 'not_configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, text })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[notify] Resend error', res.status, body);
      return { ok: false, error: 'send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[notify] Resend exception', err);
    return { ok: false, error: 'exception' };
  }
}

/** Converts a French local number (06...) to E.164 (+336...) for Twilio; leaves already-international numbers alone. */
function toE164FR(tel) {
  const digits = (tel || '').replace(/\D/g, '');
  if (!digits) return null;
  if (tel.trim().startsWith('+')) return '+' + digits;
  if (digits.length === 10 && digits.startsWith('0')) return '+33' + digits.slice(1);
  if (digits.length === 11 && digits.startsWith('33')) return '+' + digits;
  return null;
}

async function sendSms({ to, body }) {
  const formatted = toE164FR(to);
  if (!formatted) return { ok: false, skipped: 'no_recipient' };
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { ok: false, skipped: 'not_configured' };
  }
  try {
    const params = new URLSearchParams({ To: formatted, From: TWILIO_FROM_NUMBER, Body: body });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    if (!res.ok) {
      const body2 = await res.text().catch(() => '');
      console.error('[notify] Twilio error', res.status, body2);
      return { ok: false, error: 'send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[notify] Twilio exception', err);
    return { ok: false, error: 'exception' };
  }
}

/** Sends both channels available for an appointment; never throws. Returns {email, sms} result summaries. */
async function notifyAppointment(appt, kind) {
  const dateFmt = new Date(appt.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const messages = {
    confirme: {
      subject: 'Votre rendez-vous MyCarStore est confirmé',
      body: `Bonjour ${appt.nom},\n\nVotre rendez-vous chez MyCarStore est confirmé :\n${dateFmt}, créneau ${appt.creneau}.\n\nÀ bientôt !\nMyCarStore — 03 65 67 69 62`
    },
    annule: {
      subject: 'Votre rendez-vous MyCarStore a été annulé',
      body: `Bonjour ${appt.nom},\n\nVotre rendez-vous du ${dateFmt} (${appt.creneau}) chez MyCarStore a été annulé.\n\nContactez-nous au 03 65 67 69 62 pour reprogrammer si besoin.\nMyCarStore`
    },
    en_attente: {
      subject: 'Votre rendez-vous MyCarStore est de nouveau en attente',
      body: `Bonjour ${appt.nom},\n\nVotre demande de rendez-vous du ${dateFmt} (${appt.creneau}) est repassée en attente de confirmation.\n\nNous revenons vers vous rapidement.\nMyCarStore — 03 65 67 69 62`
    },
    rappel: {
      subject: 'Rappel : rendez-vous demain chez MyCarStore',
      body: `Bonjour ${appt.nom},\n\nPetit rappel : vous avez rendez-vous demain chez MyCarStore.\n${dateFmt}, créneau ${appt.creneau}.\n\n434 rue de la Basinière, ZAC des Tourelles, 90120 Morvillars.\n\nÀ demain !\nMyCarStore — 03 65 67 69 62`
    },
    modifie: {
      subject: 'Votre rendez-vous MyCarStore a été modifié',
      body: `Bonjour ${appt.nom},\n\nVotre rendez-vous chez MyCarStore a été mis à jour. Voici les informations actuelles :\n${dateFmt}, créneau ${appt.creneau}.\nIntervention(s) : ${(JSON.parse(appt.services || '[]')).join(', ')}\n\nMyCarStore — 03 65 67 69 62`
    }
  };
  const msg = messages[kind];
  if (!msg) return { email: { ok: false, skipped: 'unknown_kind' }, sms: { ok: false, skipped: 'unknown_kind' } };

  const [email, sms] = await Promise.all([
    sendEmail({ to: appt.email, subject: msg.subject, text: msg.body }),
    sendSms({ to: appt.tel, body: msg.body })
  ]);
  logCommunication(appt, kind, 'email', appt.email, email);
  logCommunication(appt, kind, 'sms', appt.tel, sms);
  return { email, sms };
}

function logCommunication(appt, kind, channel, recipient, result) {
  let status = 'sent';
  if (result.skipped) status = 'skipped';
  else if (!result.ok) status = 'failed';
  try {
    db.prepare(`
      INSERT INTO communications (created_at, client_id, appointment_id, channel, kind, recipient, status, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      appt.client_id || null,
      appt.id || null,
      channel,
      kind,
      recipient || '',
      status,
      result.skipped || result.error || ''
    );
  } catch (err) {
    console.error('[notify] failed to log communication', err);
  }
}

module.exports = { sendEmail, sendSms, notifyAppointment, toE164FR };
