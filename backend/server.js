require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { employees, items, comments, attachments, recurring, saveSync } = require('./db');
const { sendWhatsApp, formatReminderMessage } = require('./whatsapp');
const telegram = require('./telegram');
const telegramWebhook = require('./telegram-webhook');
const db = { employees, items, comments, attachments, recurring };

const app = express();
const PORT = process.env.PORT || 3000;

// Attachments directory (on volume if available)
const uploadDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'attachments')
  : path.resolve(__dirname, '../data/attachments');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ---------- Auth (optional) ----------
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const SESSION_COOKIE = 'hub_auth';

function isAuthed(req) {
  if (!AUTH_PASSWORD) return true; // no auth configured
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(SESSION_COOKIE + '='));
  if (!cookie) return false;
  return cookie.split('=')[1] === encodeURIComponent(AUTH_PASSWORD);
}

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!AUTH_PASSWORD) return res.json({ ok: true });
  if (password === AUTH_PASSWORD) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(AUTH_PASSWORD)}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Falsches Passwort' });
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// Guard everything except /login, /health, static assets when auth is enabled
app.use((req, res, next) => {
  if (!AUTH_PASSWORD) return next();
  if (req.path === '/login' || req.path === '/health' || req.path.startsWith('/api/')) {
    if (req.path === '/login' || req.path === '/health') return next();
    if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
    return next();
  }
  // HTML/static: require auth or redirect to /login
  if (!isAuthed(req)) return res.redirect('/login');
  next();
});

app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, filePath) => {
    // Prevent stale JS/CSS/HTML from cache
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- EMPLOYEES ----------
app.get('/api/employees', (req, res) => res.json(employees.all()));

app.post('/api/employees', (req, res) => {
  const { name, email, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  res.json(employees.create(req.body));
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

app.delete('/api/employees/:id', (req, res) => {
  employees.softDelete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/employees/:id/test-telegram', async (req, res) => {
  const emp = employees.get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  if (!emp.telegram_chat_id) return res.status(400).json({ error: 'Telegram Chat-ID fehlt' });
  try {
    await telegram.sendMessage(emp.telegram_chat_id,
      `✅ *Test von Office Hub*\nHallo ${emp.name}! Wenn du das liest, funktioniert Telegram. 🎉`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/employees/:id/test-whatsapp', async (req, res) => {
  const emp = employees.get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  if (!emp.phone || !emp.whatsapp_key) return res.status(400).json({ error: 'Telefonnummer und WhatsApp-Key erforderlich' });
  try {
    const result = await sendWhatsApp(emp.phone, emp.whatsapp_key,
      `✅ Test von Office Hub\nHallo ${emp.name}! Wenn du das liest, funktioniert WhatsApp. 🎉`);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- ITEMS ----------
app.get('/api/items', (req, res) => {
  res.json(items.all({
    status: req.query.status,
    type: req.query.type,
    assignee_id: req.query.assignee_id,
  }));
});

app.get('/api/items/:id', (req, res) => {
  const it = items.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it);
});

// Notify on new assignment (or reassignment)
async function notifyAssignee(item, previousAssigneeId = null) {
  if (!item.assignee_id || item.assignee_id === previousAssigneeId) return;
  const emp = employees.get(item.assignee_id);
  if (!emp || !emp.telegram_chat_id) return;
  const dueText = item.due_date
    ? ` Fällig: ${new Date(item.due_date).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`
    : '';
  const icon = item.type === 'termin' ? '📅' : '🎫';
  try {
    await telegram.sendMessage(emp.telegram_chat_id,
      `${icon} *Neu für dich:* ${item.title}\n_${item.priority} Priorität_${dueText}\n\n👉 [Zum Hub](${process.env.PUBLIC_URL || ''})`
    );
  } catch (e) {
    console.log(`Notify assignment fail (${emp.name}): ${e.message}`);
  }
}

app.post('/api/items', async (req, res) => {
  const { type, title } = req.body;
  if (!type || !title) return res.status(400).json({ error: 'Typ und Titel erforderlich' });
  const it = items.create(req.body);
  notifyAssignee(it, null).catch(() => {});
  res.json(it);
});

app.put('/api/items/:id', async (req, res) => {
  const before = items.get(req.params.id);
  const it = items.update(req.params.id, req.body);
  if (!it) return res.status(404).json({ error: 'not found' });
  notifyAssignee(it, before?.assignee_id).catch(() => {});
  res.json(it);
});

app.patch('/api/items/:id/status', (req, res) => {
  const it = items.update(req.params.id, { status: req.body.status });
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it);
});

app.delete('/api/items/:id', (req, res) => {
  // remove attachment files too
  for (const a of attachments.forItem(req.params.id)) {
    try { fs.unlinkSync(a.path); } catch {}
  }
  items.remove(req.params.id);
  res.json({ ok: true });
});

// ---------- COMMENTS ----------
app.get('/api/items/:id/comments', (req, res) => {
  res.json(comments.forItem(req.params.id));
});

app.post('/api/items/:id/comments', (req, res) => {
  const { text, author } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text erforderlich' });
  const it = items.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Ticket nicht gefunden' });
  const c = comments.create({ item_id: req.params.id, author, text });
  // notify assignee about new comment
  if (it.assignee_id) {
    const emp = employees.get(it.assignee_id);
    if (emp?.telegram_chat_id) {
      const short = text.length > 200 ? text.slice(0, 200) + '…' : text;
      telegram.sendMessage(emp.telegram_chat_id,
        `💬 *Kommentar zu:* ${it.title}\n_von ${author || 'Anonym'}_\n\n${short}\n\n👉 [Zum Hub](${process.env.PUBLIC_URL || ''})`
      ).catch(() => {});
    }
  }
  res.json(c);
});

app.delete('/api/comments/:id', (req, res) => {
  comments.remove(req.params.id);
  res.json({ ok: true });
});

// ---------- ATTACHMENTS ----------
app.get('/api/items/:id/attachments', (req, res) => {
  res.json(attachments.forItem(req.params.id));
});

// Upload as base64 JSON (simple, no multipart dependency)
app.post('/api/items/:id/attachments', (req, res) => {
  const { filename, mime, dataBase64, uploaded_by } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'filename & dataBase64 erforderlich' });
  const it = items.get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Ticket nicht gefunden' });

  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'Max 15 MB' });

  const safeName = filename.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const stored = `${Date.now()}_${safeName}`;
  const filepath = path.join(uploadDir, stored);
  fs.writeFileSync(filepath, buf);
  const a = attachments.create({
    item_id: req.params.id, filename, size: buf.length, mime: mime || 'application/octet-stream',
    path: filepath, uploaded_by,
  });
  res.json(a);
});

app.get('/api/attachments/:id/download', (req, res) => {
  const a = attachments.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  if (!fs.existsSync(a.path)) return res.status(410).json({ error: 'file gone' });
  res.download(a.path, a.filename);
});

app.delete('/api/attachments/:id', (req, res) => {
  const a = attachments.remove(req.params.id);
  if (a) { try { fs.unlinkSync(a.path); } catch {} }
  res.json({ ok: true });
});

// ---------- RECURRING ----------
app.get('/api/recurring', (req, res) => res.json(recurring.all()));

app.post('/api/recurring', (req, res) => {
  const { type, title, pattern } = req.body;
  if (!type || !title || !pattern) return res.status(400).json({ error: 'type, title, pattern erforderlich' });
  res.json(recurring.create(req.body));
});

app.put('/api/recurring/:id', (req, res) => {
  const r = recurring.update(req.params.id, req.body);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});

app.delete('/api/recurring/:id', (req, res) => {
  recurring.remove(req.params.id);
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
      byAssignee[it.assignee_id] = { name: emp.name, email: emp.email, phone: emp.phone, whatsapp_key: emp.whatsapp_key, telegram_chat_id: emp.telegram_chat_id, items: [] };
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

app.post('/api/reminders/run', async (req, res) => {
  runReminders().catch(e => console.error(e));
  res.json({ ok: true, message: 'Versand läuft im Hintergrund.' });
});

const cronExpr = process.env.REMINDER_CRON || '0 8 * * *';
cron.schedule(cronExpr, () => { runReminders().catch(console.error); },
  { timezone: process.env.TIMEZONE || 'Europe/Berlin' });

// ---------- RECURRING TICKET GENERATION ----------
function shouldFire(rec, now) {
  const p = rec.pattern || {};
  const h = p.hour ?? 0, m = p.minute ?? 0;
  if (now.getHours() !== h || now.getMinutes() !== m) return false;
  if (p.kind === 'daily') return true;
  if (p.kind === 'weekly') return now.getDay() === (p.weekday ?? 1);
  if (p.kind === 'monthly') return now.getDate() === (p.day ?? 1);
  return false;
}

// Check every minute for recurring rules
cron.schedule('* * * * *', () => {
  const tz = process.env.TIMEZONE || 'Europe/Berlin';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const today = now.toISOString().slice(0, 10);
  for (const rec of recurring.all()) {
    if (!rec.active) continue;
    if (rec.last_run === today) continue;
    if (!shouldFire(rec, now)) continue;

    // Create the item
    const dueDate = new Date(now);
    dueDate.setHours(23, 59, 0, 0);
    const it = items.create({
      type: rec.type,
      title: rec.title,
      description: rec.description,
      priority: rec.priority,
      assignee_id: rec.assignee_id,
      due_date: dueDate.toISOString(),
      created_by: 'Wiederkehrend',
    });
    recurring.update(rec.id, { last_run: today });
    console.log(`↻ Wiederkehrend erstellt: ${rec.title} → ${it.id}`);
    notifyAssignee(it, null).catch(() => {});
  }
}, { timezone: process.env.TIMEZONE || 'Europe/Berlin' });

// Graceful shutdown
process.on('SIGINT', () => { saveSync(); process.exit(0); });
process.on('SIGTERM', () => { saveSync(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`🚀 Office Hub läuft auf http://localhost:${PORT}`);
  console.log(`⏰ Erinnerungen: ${cronExpr} (${process.env.TIMEZONE || 'Europe/Berlin'})`);
  console.log(`🔐 Login: ${AUTH_PASSWORD ? 'AKTIV (Passwort erforderlich)' : 'aus (offener Zugang)'}`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramWebhook.start(db);
  } else {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN nicht gesetzt — Bot inaktiv.');
  }
});
