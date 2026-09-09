require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { employees, items, saveSync } = require('./db');
const { sendWhatsApp, formatReminderMessage } = require('./whatsapp');
const telegram = require('./telegram');
const telegramWebhook = require('./telegram-webhook');
const db = { employees, items };

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- EMPLOYEES ----------
app.get('/api/employees', (req, res) => res.json(employees.all()));

app.post('/api/employees', (req, res) => {
  const { name, email, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  res.json(employees.create({ name, email, phone }));
});

app.put('/api/employees/:id', (req, res) => {
  const { name, email, phone, whatsapp_key, telegram_chat_id, active } = req.body;
  const emp = employees.update(req.params.id, {
    name, email, phone, whatsapp_key, telegram_chat_id,
    active: active !== undefined ? !!active : true,
  });
  if (!emp) return res.status(404).json({ error: 'not found' });
  res.json(emp);
});

// Test-Nachricht via Telegram
app.post('/api/employees/:id/test-telegram', async (req, res) => {
  const emp = employees.get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  if (!emp.telegram_chat_id) return res.status(400).json({ error: 'Telegram Chat-ID fehlt (Mitarbeiter muss /start beim Bot senden)' });
  try {
    await telegram.sendMessage(emp.telegram_chat_id,
      `✅ *Test von Office Hub*\nHallo ${emp.name}! Wenn du das liest, funktioniert Telegram. 🎉`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test-Nachricht an Mitarbeiter senden
app.post('/api/employees/:id/test-whatsapp', async (req, res) => {
  const emp = employees.get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  if (!emp.phone || !emp.whatsapp_key) {
    return res.status(400).json({ error: 'Telefonnummer und WhatsApp-Key erforderlich' });
  }
  try {
    const result = await sendWhatsApp(
      emp.phone, emp.whatsapp_key,
      `✅ Test von Office Hub\nHallo ${emp.name}! Wenn du das liest, funktioniert die WhatsApp-Anbindung. 🎉`
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/employees/:id', (req, res) => {
  employees.softDelete(req.params.id);
  res.json({ ok: true });
});

// ---------- ITEMS ----------
app.get('/api/items', (req, res) => {
  res.json(items.all({
    status: req.query.status,
    type: req.query.type,
    assignee_id: req.query.assignee_id,
  }));
});

app.post('/api/items', (req, res) => {
  const { type, title } = req.body;
  if (!type || !title) return res.status(400).json({ error: 'Typ und Titel erforderlich' });
  res.json(items.create(req.body));
});

app.put('/api/items/:id', (req, res) => {
  const it = items.update(req.params.id, req.body);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it);
});

app.patch('/api/items/:id/status', (req, res) => {
  const it = items.update(req.params.id, { status: req.body.status });
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it);
});

app.delete('/api/items/:id', (req, res) => {
  items.remove(req.params.id);
  res.json({ ok: true });
});

// ---------- STATS ----------
app.get('/api/stats', (req, res) => res.json(items.stats()));

// ---------- REMINDERS ----------
function generateReminders() {
  const open = items.all().filter(i => i.status !== 'erledigt' && i.assignee_id);
  const byAssignee = {};
  for (const it of open) {
    const emp = employees.get(it.assignee_id);
    if (!emp) continue;
    if (!byAssignee[it.assignee_id]) {
      byAssignee[it.assignee_id] = { name: emp.name, email: emp.email, phone: emp.phone, items: [] };
    }
    byAssignee[it.assignee_id].items.push(it);
  }
  return byAssignee;
}

app.get('/api/reminders/preview', (req, res) => res.json(generateReminders()));

async function runReminders() {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] Erinnerungen werden versendet...`);
  const openByAssignee = generateReminders();

  for (const emp of employees.all()) {
    const bucket = openByAssignee[emp.id];
    if (!bucket || !bucket.items.length) continue;

    let delivered = false;

    // 1) Telegram bevorzugt
    if (emp.telegram_chat_id) {
      try {
        const msg = telegram.formatReminderMessage(emp.name, bucket.items);
        await telegram.sendMessage(emp.telegram_chat_id, msg);
        console.log(`  ✅ Telegram → ${emp.name}: ${bucket.items.length}`);
        delivered = true;
      } catch (e) {
        console.log(`  ❌ Telegram (${emp.name}): ${e.message}`);
      }
    }

    // 2) WhatsApp Fallback (nur wenn Telegram nicht ging)
    if (!delivered && emp.phone && emp.whatsapp_key) {
      try {
        const msg = formatReminderMessage(emp.name, bucket.items);
        const r = await sendWhatsApp(emp.phone, emp.whatsapp_key, msg);
        console.log(`  ${r.ok ? '✅' : '❌'} WhatsApp → ${emp.name}: ${bucket.items.length}`);
        delivered = true;
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.log(`  ❌ WhatsApp (${emp.name}): ${e.message}`);
      }
    }

    if (!delivered) console.log(`  ⚠️ ${emp.name}: kein Kanal konfiguriert`);
  }
  console.log(`[${new Date().toISOString()}] Erinnerungen fertig.`);
}

// Manueller Trigger (für Test / Sofort-Versand)
app.post('/api/reminders/run', async (req, res) => {
  runReminders().catch(e => console.error(e));
  res.json({ ok: true, message: 'Versand läuft im Hintergrund. Siehe Logs.' });
});

const cronExpr = process.env.REMINDER_CRON || '0 8 * * *';
cron.schedule(cronExpr, () => { runReminders().catch(console.error); },
  { timezone: process.env.TIMEZONE || 'Europe/Berlin' });

// Graceful shutdown → save
process.on('SIGINT', () => { saveSync(); process.exit(0); });
process.on('SIGTERM', () => { saveSync(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`🚀 Office Hub läuft auf http://localhost:${PORT}`);
  console.log(`⏰ Erinnerungen: ${cronExpr} (${process.env.TIMEZONE || 'Europe/Berlin'})`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramWebhook.start(db);
  } else {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN nicht gesetzt — Bot inaktiv.');
  }
});
