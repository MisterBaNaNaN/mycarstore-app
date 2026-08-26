const db = require('./db');
const notify = require('./notify');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** Sends a reminder for every confirmed appointment happening tomorrow that hasn't had one yet. */
async function checkAndSendReminders() {
  const tomorrow = tomorrowStr();
  const rows = db.prepare(
    "SELECT * FROM appointments WHERE date = ? AND status = 'confirme' AND reminder_sent = 0"
  ).all(tomorrow);

  for (const row of rows) {
    let result;
    try {
      result = await notify.notifyAppointment(row, 'rappel');
    } catch (err) {
      console.error('[reminders] notifyAppointment threw', err);
      continue;
    }
    // Mark as sent once we've attempted delivery and neither channel hit a real error
    // (both "sent" and "not configured / no recipient" count as handled — nothing to retry).
    const emailDone = result.email.ok || result.email.skipped;
    const smsDone = result.sms.ok || result.sms.skipped;
    if (emailDone && smsDone) {
      db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(row.id);
    }
  }

  return rows.length;
}

function startReminderLoop(intervalMs) {
  setTimeout(() => { checkAndSendReminders().catch((err) => console.error('[reminders] check failed', err)); }, 15000);
  setInterval(() => { checkAndSendReminders().catch((err) => console.error('[reminders] check failed', err)); }, intervalMs);
}

module.exports = { checkAndSendReminders, startReminderLoop, tomorrowStr };
