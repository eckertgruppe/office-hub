// Einfaches JSON-basiertes Storage – kein native compile nötig.
// Perfekt für kleine Teams (bis ~1000 Items problemlos).
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

// DATA_DIR overrides location entirely (e.g. Railway volume /data)
const dbPath = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'hub.json')
  : process.env.DB_PATH
    ? path.resolve(__dirname, process.env.DB_PATH)
    : path.resolve(__dirname, '../data/hub.json');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let data = { employees: [], items: [] };
if (fs.existsSync(dbPath)) {
  try { data = JSON.parse(fs.readFileSync(dbPath, 'utf-8')); }
  catch (e) { console.error('DB corrupt, starting fresh:', e.message); }
}
// Migrate missing fields
data.employees ||= [];
data.items ||= [];

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  }, 100);
}

function saveSync() {
  clearTimeout(saveTimer);
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

const now = () => new Date().toISOString();

// ---------- Employees ----------
const employees = {
  all: () => data.employees.filter(e => e.active !== false).sort((a,b) => a.name.localeCompare(b.name)),
  get: (id) => data.employees.find(e => e.id === id),
  create: ({ name, email, phone, whatsapp_key }) => {
    const emp = { id: nanoid(8), name, email: email || null, phone: phone || null, whatsapp_key: whatsapp_key || null, active: true, created_at: now() };
    data.employees.push(emp); save(); return emp;
  },
  update: (id, patch) => {
    const emp = data.employees.find(e => e.id === id);
    if (!emp) return null;
    Object.assign(emp, patch); save(); return emp;
  },
  softDelete: (id) => employees.update(id, { active: false }),
};

// ---------- Items ----------
const items = {
  all: (filter = {}) => {
    let list = data.items.slice();
    if (filter.status) list = list.filter(i => i.status === filter.status);
    if (filter.type) list = list.filter(i => i.type === filter.type);
    if (filter.assignee_id) list = list.filter(i => i.assignee_id === filter.assignee_id);
    const rank = { offen: 1, in_arbeit: 2, erledigt: 3 };
    list.sort((a,b) => (rank[a.status]||9) - (rank[b.status]||9)
      || (a.due_date || '9999') .localeCompare(b.due_date || '9999'));
    // enrich
    return list.map(i => ({ ...i, assignee_name: employees.get(i.assignee_id)?.name || null }));
  },
  get: (id) => data.items.find(i => i.id === id),
  create: (input) => {
    const it = {
      id: nanoid(8),
      type: input.type,
      title: input.title,
      description: input.description || null,
      priority: input.priority || 'mittel',
      status: input.status || 'offen',
      assignee_id: input.assignee_id || null,
      due_date: input.due_date || null,
      created_by: input.created_by || null,
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    };
    data.items.push(it); save(); return it;
  },
  update: (id, patch) => {
    const it = data.items.find(i => i.id === id);
    if (!it) return null;
    Object.assign(it, patch, { updated_at: now() });
    if (patch.status === 'erledigt' && !it.completed_at) it.completed_at = now();
    if (patch.status && patch.status !== 'erledigt') it.completed_at = null;
    save(); return it;
  },
  remove: (id) => {
    const idx = data.items.findIndex(i => i.id === id);
    if (idx >= 0) { data.items.splice(idx, 1); save(); return true; }
    return false;
  },
  stats: () => ({
    offen: data.items.filter(i => i.status === 'offen').length,
    in_arbeit: data.items.filter(i => i.status === 'in_arbeit').length,
    erledigt: data.items.filter(i => i.status === 'erledigt').length,
    ueberfaellig: data.items.filter(i => i.status !== 'erledigt' && i.due_date && new Date(i.due_date) < new Date()).length,
  }),
};

module.exports = { employees, items, saveSync };
