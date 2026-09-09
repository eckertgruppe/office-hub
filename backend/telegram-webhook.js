// Handles incoming Telegram updates (via long-poll or webhook).
// We use long polling (getUpdates) — simple and no public URL setup needed beyond Railway's.
const { sendMessage } = require('./telegram');

let lastUpdateId = 0;
let running = false;

async function pollLoop(db) {
  if (running) return;
  running = true;
  console.log('📱 Telegram long-poll gestartet');

  while (running) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.log('⚠️ TELEGRAM_BOT_TOKEN fehlt, poll pausiert 60s');
      await sleep(60_000);
      continue;
    }
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?timeout=30&offset=${lastUpdateId + 1}`
      );
      const data = await r.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const upd of data.result) {
          lastUpdateId = upd.update_id;
          try { await handleUpdate(upd, db); }
          catch (e) { console.error('handleUpdate error:', e.message); }
        }
      } else if (!data.ok) {
        console.error('Telegram getUpdates error:', data.description);
        await sleep(5_000);
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await sleep(5_000);
    }
  }
}

async function handleUpdate(upd, db) {
  const msg = upd.message;
  if (!msg || !msg.text) return;
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const from = msg.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Unbekannt';

  if (text.startsWith('/start')) {
    // Suche nach Mitarbeiter mit passendem Namen (Fallback) oder frisch erstellen
    const existing = db.employees.all().find(e => String(e.telegram_chat_id) === chatId);
    if (existing) {
      await sendMessage(chatId, `✅ Hallo ${existing.name}, du bist bereits registriert.\nDu bekommst tägliche Erinnerungen um 8:00 Uhr.`);
      return;
    }
    // Try to link by name
    const byName = db.employees.all().find(e => e.name.toLowerCase() === name.toLowerCase());
    if (byName) {
      db.employees.update(byName.id, { telegram_chat_id: chatId });
      await sendMessage(chatId, `✅ Registriert als *${byName.name}*.\nDu bekommst tägliche Erinnerungen um 8:00 Uhr.\n\n👉 [Zum Hub](${process.env.PUBLIC_URL || ''})`);
    } else {
      await sendMessage(chatId, `👋 Willkommen!\n\nDein Name in Telegram: *${name}*\nDeine Chat-ID: \`${chatId}\`\n\nGib deinem Admin diese Chat-ID, damit er dich mit dem Office Hub verbinden kann.`);
    }
    return;
  }

  if (text === '/mychatid' || text === '/id') {
    await sendMessage(chatId, `Deine Chat-ID: \`${chatId}\``);
    return;
  }

  if (text === '/status' || text === '/offen') {
    const emp = db.employees.all().find(e => String(e.telegram_chat_id) === chatId);
    if (!emp) { await sendMessage(chatId, '⚠️ Du bist nicht mit einem Mitarbeiter verknüpft. Sende /start.'); return; }
    const items = db.items.all().filter(i => i.assignee_id === emp.id && i.status !== 'erledigt');
    if (!items.length) { await sendMessage(chatId, '🎉 Du hast keine offenen Punkte!'); return; }
    const { formatReminderMessage } = require('./telegram');
    await sendMessage(chatId, formatReminderMessage(emp.name, items));
    return;
  }

  // Default: help
  await sendMessage(chatId,
    `Hi ${name}! 👋\n\nVerfügbare Kommandos:\n/start – Registrieren\n/status – Meine offenen Punkte\n/id – Meine Chat-ID`
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function start(db) { pollLoop(db).catch(e => console.error('poll fatal:', e)); }

module.exports = { start };
