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

let data = { employees: [], items: [], comments: [], attachments: [], recurring: [] };
if (fs.existsSync(dbPath)) {
  try { Object.assign(data, JSON.parse(fs.readFileSync(dbPath, 'utf-8'))); }
  catch (e) { console.error('DB corrupt, starting fresh:', e.message); }
}
// Migrate missing fields
data.employees ||= [];
data.items ||= [];
data.comments ||= [];
data.attachments ||= [];
data.recurring ||= [];

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
  create: ({ name, email, phone, whatsapp_key, telegram_chat_id }) => {
    const emp = {
      id: nanoid(8), name,
      email: email || null,
      phone: phone || null,
      whatsapp_key: whatsapp_key || null,
      telegram_chat_id: telegram_chat_id || null,
      active: true, created_at: now(),
    };
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
    return list.map(i => ({ ...i, assignee_name: employees.get(i.assignee_id)?.name || null }));
  },
  get: (id) => {
    const it = data.items.find(i => i.id === id);
    if (!it) return null;
    return { ...it, assignee_name: employees.get(it.assignee_id)?.name || null };
  },
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
    if (idx >= 0) {
      data.items.splice(idx, 1);
      // cascade: comments + attachments
      data.comments = data.comments.filter(c => c.item_id !== id);
      data.attachments = data.attachments.filter(a => a.item_id !== id);
      save(); return true;
    }
    return false;
  },
  stats: () => ({
    offen: data.items.filter(i => i.status === 'offen').length,
    in_arbeit: data.items.filter(i => i.status === 'in_arbeit').length,
    erledigt: data.items.filter(i => i.status === 'erledigt').length,
    ueberfaellig: data.items.filter(i => i.status !== 'erledigt' && i.due_date && new Date(i.due_date) < new Date()).length,
  }),
};

// ---------- Comments ----------
const comments = {
  forItem: (itemId) => data.comments.filter(c => c.item_id === itemId).sort((a,b) => a.created_at.localeCompare(b.created_at)),
  create: ({ item_id, author, text }) => {
    const c = { id: nanoid(8), item_id, author: author || 'Anonym', text, created_at: now() };
    data.comments.push(c); save(); return c;
  },
  remove: (id) => {
    const idx = data.comments.findIndex(c => c.id === id);
    if (idx >= 0) { data.comments.splice(idx, 1); save(); return true; }
    return false;
  },
};

// ---------- Attachments (metadata; files stored on disk) ----------
const attachments = {
  forItem: (itemId) => data.attachments.filter(a => a.item_id === itemId),
  create: ({ item_id, filename, size, mime, path: p, uploaded_by }) => {
    const a = { id: nanoid(8), item_id, filename, size, mime, path: p, uploaded_by, created_at: now() };
    data.attachments.push(a); save(); return a;
  },
  get: (id) => data.attachments.find(a => a.id === id),
  remove: (id) => {
    const idx = data.attachments.findIndex(a => a.id === id);
    if (idx >= 0) {
      const [rem] = data.attachments.splice(idx, 1);
      save();
      return rem;
    }
    return null;
  },
};

// ---------- Recurring templates ----------
// pattern: { kind: 'daily'|'weekly'|'monthly', weekday?: 0-6, day?: 1-31, hour: 0-23, minute: 0-59 }
const recurring = {
  all: () => data.recurring.slice(),
  get: (id) => data.recurring.find(r => r.id === id),
  create: (input) => {
    const r = {
      id: nanoid(8),
      type: input.type,
      title: input.title,
      description: input.description || null,
      priority: input.priority || 'mittel',
      assignee_id: input.assignee_id || null,
      pattern: input.pattern,
      active: true,
      last_run: null,
      created_at: now(),
    };
    data.recurring.push(r); save(); return r;
  },
  update: (id, patch) => {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return null;
    Object.assign(r, patch); save(); return r;
  },
  remove: (id) => {
    const idx = data.recurring.findIndex(r => r.id === id);
    if (idx >= 0) { data.recurring.splice(idx, 1); save(); return true; }
    return false;
  },
};

module.exports = { employees, items, comments, attachments, recurring, saveSync };
