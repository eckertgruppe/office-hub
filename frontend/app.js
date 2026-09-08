const API = '/api';
let employees = [];
let items = [];

// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(item) {
  return item.due_date && item.status !== 'erledigt' && new Date(item.due_date) < new Date();
}

function initials(name) {
  return name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

// ---------- Navigation ----------
$$('.tab').forEach(tab => {
  tab.onclick = () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    $('#view-' + tab.dataset.view).classList.add('active');
    if (tab.dataset.view === 'items') renderItems();
    if (tab.dataset.view === 'employees') renderEmployees();
    if (tab.dataset.view === 'dashboard') renderDashboard();
  };
});

// ---------- Dashboard ----------
async function renderDashboard() {
  const stats = await api('/stats');
  $('#stat-offen').textContent = stats.offen;
  $('#stat-arbeit').textContent = stats.in_arbeit;
  $('#stat-erledigt').textContent = stats.erledigt;
  $('#stat-ueberfaellig').textContent = stats.ueberfaellig;

  const upcoming = (await api('/items?status=offen')).slice(0, 5);
  const arbeit = await api('/items?status=in_arbeit');
  const list = [...arbeit, ...upcoming].slice(0, 8);
  $('#upcoming-list').innerHTML = list.length
    ? list.map(itemCardHTML).join('')
    : '<div class="empty">Keine offenen Punkte 🎉</div>';
  attachItemHandlers('#upcoming-list');
}

// ---------- Items ----------
async function loadItems() {
  const q = new URLSearchParams();
  const s = $('#filter-status').value;
  const t = $('#filter-type').value;
  const a = $('#filter-assignee').value;
  if (s) q.set('status', s);
  if (t) q.set('type', t);
  if (a) q.set('assignee_id', a);
  items = await api('/items?' + q.toString());
}

function itemCardHTML(item) {
  const overdue = isOverdue(item);
  const icon = item.type === 'ticket' ? '🎫' : '📅';
  const done = item.status === 'erledigt';
  return `
    <div class="item-card prio-${item.priority} ${done ? 'done' : ''}" data-id="${item.id}">
      <div class="item-check ${done ? 'done' : ''}" data-toggle="${item.id}" title="Als erledigt markieren">
        ${done ? '✓' : ''}
      </div>
      <div class="item-icon">${icon}</div>
      <div class="item-body">
        <div class="item-title">${escapeHTML(item.title)}</div>
        <div class="item-meta">
          <span class="badge badge-${item.status}">${item.status.replace('_',' ')}</span>
          ${item.assignee_name ? `<span>👤 ${escapeHTML(item.assignee_name)}</span>` : '<span>— nicht zugewiesen —</span>'}
          ${item.due_date ? `<span class="${overdue ? 'badge badge-overdue' : ''}">📅 ${fmtDate(item.due_date)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

async function renderItems() {
  await loadItems();
  const el = $('#items-list');
  el.innerHTML = items.length
    ? items.map(itemCardHTML).join('')
    : '<div class="empty">Nichts zu sehen. Klick auf „+ Neu" um zu starten.</div>';
  attachItemHandlers('#items-list');
}

function attachItemHandlers(scope) {
  $$(scope + ' .item-check').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const id = el.dataset.toggle;
      const item = items.find(i => i.id == id) || (await api('/items')).find(i => i.id == id);
      const newStatus = item.status === 'erledigt' ? 'offen' : 'erledigt';
      await api(`/items/${id}/status`, { method: 'PATCH', body: { status: newStatus } });
      await renderItems();
      await renderDashboard();
    };
  });
  $$(scope + ' .item-card').forEach(el => {
    el.onclick = () => openItemModal(el.dataset.id);
  });
}

// ---------- Item Modal ----------
function openItemModal(id = null) {
  const modal = $('#itemModal');
  const form = $('#itemForm');
  form.reset();
  $('#item-id').value = '';
  $('#deleteItemBtn').style.display = 'none';

  // Populate assignee dropdown
  $('#item-assignee').innerHTML = '<option value="">— nicht zugewiesen —</option>' +
    employees.map(e => `<option value="${e.id}">${escapeHTML(e.name)}</option>`).join('');

  if (id) {
    const item = items.find(i => i.id == id);
    if (item) {
      $('#itemModalTitle').textContent = 'Bearbeiten';
      $('#item-id').value = item.id;
      $('#item-type').value = item.type;
      $('#item-title').value = item.title;
      $('#item-description').value = item.description || '';
      $('#item-priority').value = item.priority;
      $('#item-status').value = item.status;
      $('#item-assignee').value = item.assignee_id || '';
      $('#item-due').value = item.due_date ? item.due_date.slice(0, 16) : '';
      $('#item-createdby').value = item.created_by || '';
      $('#deleteItemBtn').style.display = 'inline-block';
    }
  } else {
    $('#itemModalTitle').textContent = 'Neues Ticket / Termin';
  }
  modal.classList.add('active');
}

$('#newItemBtn').onclick = () => openItemModal();
$('#cancelItemBtn').onclick = () => $('#itemModal').classList.remove('active');

$('#itemForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#item-id').value;
  const body = {
    type: $('#item-type').value,
    title: $('#item-title').value,
    description: $('#item-description').value,
    priority: $('#item-priority').value,
    status: $('#item-status').value,
    assignee_id: $('#item-assignee').value || null,
    due_date: $('#item-due').value || null,
    created_by: $('#item-createdby').value,
  };
  if (id) await api('/items/' + id, { method: 'PUT', body });
  else await api('/items', { method: 'POST', body });
  $('#itemModal').classList.remove('active');
  await renderItems();
  await renderDashboard();
};

$('#deleteItemBtn').onclick = async () => {
  const id = $('#item-id').value;
  if (!id) return;
  if (!confirm('Wirklich löschen?')) return;
  await api('/items/' + id, { method: 'DELETE' });
  $('#itemModal').classList.remove('active');
  await renderItems();
  await renderDashboard();
};

// ---------- Employees ----------
async function loadEmployees() {
  employees = await api('/employees');
  const sel = $('#filter-assignee');
  sel.innerHTML = '<option value="">Alle Personen</option>' +
    employees.map(e => `<option value="${e.id}">${escapeHTML(e.name)}</option>`).join('');
}

async function renderEmployees() {
  await loadEmployees();
  const el = $('#employees-list');
  el.innerHTML = employees.length
    ? employees.map(e => `
      <div class="employee-card" data-id="${e.id}">
        <div class="emp-avatar">${initials(e.name)}</div>
        <div class="emp-name">${escapeHTML(e.name)}</div>
        <div class="emp-info">${escapeHTML(e.email || '—')}</div>
        <div class="emp-info">${escapeHTML(e.phone || '—')}</div>
      </div>
    `).join('')
    : '<div class="empty">Noch keine Mitarbeiter. Klick auf „+ Mitarbeiter".</div>';
  $$('.employee-card').forEach(c => c.onclick = () => openEmployeeModal(c.dataset.id));
}

function openEmployeeModal(id = null) {
  const modal = $('#employeeModal');
  $('#employeeForm').reset();
  $('#emp-id').value = '';
  $('#deleteEmpBtn').style.display = 'none';
  $('#testWhatsAppBtn').style.display = 'none';
  if (id) {
    const emp = employees.find(e => e.id == id);
    if (emp) {
      $('#employeeModalTitle').textContent = 'Mitarbeiter bearbeiten';
      $('#emp-id').value = emp.id;
      $('#emp-name').value = emp.name;
      $('#emp-email').value = emp.email || '';
      $('#emp-phone').value = emp.phone || '';
      $('#emp-wakey').value = emp.whatsapp_key || '';
      $('#deleteEmpBtn').style.display = 'inline-block';
      if (emp.phone && emp.whatsapp_key) $('#testWhatsAppBtn').style.display = 'inline-block';
    }
  } else {
    $('#employeeModalTitle').textContent = 'Neuer Mitarbeiter';
  }
  modal.classList.add('active');
}

$('#testWhatsAppBtn').onclick = async () => {
  const id = $('#emp-id').value;
  if (!id) return;
  $('#testWhatsAppBtn').textContent = 'Sende...';
  try {
    const r = await api(`/employees/${id}/test-whatsapp`, { method: 'POST', body: {} });
    alert(r.ok ? '✅ Test-Nachricht gesendet! Prüfe WhatsApp.' : '❌ Fehler: ' + (r.body || 'unbekannt'));
  } catch (e) {
    alert('❌ Fehler: ' + e.message);
  }
  $('#testWhatsAppBtn').textContent = '📱 Test-Nachricht';
};

$('#newEmployeeBtn').onclick = () => openEmployeeModal();
$('#cancelEmpBtn').onclick = () => $('#employeeModal').classList.remove('active');

$('#employeeForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#emp-id').value;
  const body = {
    name: $('#emp-name').value,
    email: $('#emp-email').value,
    phone: $('#emp-phone').value,
    whatsapp_key: $('#emp-wakey').value,
    active: 1,
  };
  if (id) await api('/employees/' + id, { method: 'PUT', body });
  else await api('/employees', { method: 'POST', body });
  $('#employeeModal').classList.remove('active');
  await loadEmployees();
  await renderEmployees();
};

$('#deleteEmpBtn').onclick = async () => {
  const id = $('#emp-id').value;
  if (!confirm('Mitarbeiter deaktivieren?')) return;
  await api('/employees/' + id, { method: 'DELETE' });
  $('#employeeModal').classList.remove('active');
  await loadEmployees();
  await renderEmployees();
};

// ---------- Filters ----------
['filter-status','filter-type','filter-assignee'].forEach(id => {
  $('#' + id).onchange = renderItems;
});

// ---------- Modal backdrop click ----------
$$('.modal').forEach(m => {
  m.onclick = (e) => { if (e.target === m) m.classList.remove('active'); };
});

// ---------- Manual reminder trigger ----------
$('#runRemindersBtn').onclick = async () => {
  if (!confirm('Erinnerungen JETZT an alle Mitarbeiter senden (mit WhatsApp-Setup)?')) return;
  const btn = $('#runRemindersBtn');
  btn.textContent = 'Sende...';
  btn.disabled = true;
  try {
    await api('/reminders/run', { method: 'POST', body: {} });
    alert('✅ Versand läuft im Hintergrund. Prüfe die Empfänger-WhatsApps in 1-2 Min.');
  } catch (e) {
    alert('❌ Fehler: ' + e.message);
  }
  btn.textContent = '📱 Jetzt erinnern';
  btn.disabled = false;
};

// ---------- Init ----------
(async () => {
  await loadEmployees();
  await renderDashboard();
})();
