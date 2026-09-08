require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { employees, items, saveSync } = require('./db');

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
  const { name, email, phone, active } = req.body;
  const emp = employees.update(req.params.id, {
    name, email, phone, active: active !== undefined ? !!active : true,
  });
  if (!emp) return res.status(404).json({ error: 'not found' });
  res.json(emp);
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

const cronExpr = process.env.REMINDER_CRON || '0 8 * * *';
cron.schedule(cronExpr, () => {
  console.log('[' + new Date().toISOString() + '] Erinnerungen werden generiert...');
  const reminders = generateReminders();
  for (const [id, data] of Object.entries(reminders)) {
    console.log(`→ ${data.name}: ${data.items.length} offene Punkte`);
    // Phase 2: WhatsApp/Email-Versand hier hinzufügen
  }
}, { timezone: process.env.TIMEZONE || 'Europe/Berlin' });

// Graceful shutdown → save
process.on('SIGINT', () => { saveSync(); process.exit(0); });
process.on('SIGTERM', () => { saveSync(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`🚀 Office Hub läuft auf http://localhost:${PORT}`);
  console.log(`⏰ Erinnerungen: ${cronExpr} (${process.env.TIMEZONE || 'Europe/Berlin'})`);
});
