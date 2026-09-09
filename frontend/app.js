const API = '/api';
let employees = [];
let items = [];
let allItems = [];
let recurrings = [];
let calDate = new Date();

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

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ---------- Navigation ----------
$$('.tab').forEach(tab => {
  tab.onclick = () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    $('#view-' + tab.dataset.view).classList.add('active');
    const v = tab.dataset.view;
    if (v === 'items') renderItems();
    else if (v === 'employees') renderEmployees();
    else if (v === 'calendar') renderCalendar();
    else if (v === 'recurring') renderRecurrings();
    else if (v === 'dashboard') renderDashboard();
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
      const it = (await api('/items/' + id));
      const newStatus = it.status === 'erledigt' ? 'offen' : 'erledigt';
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
async function openItemModal(id = null) {
  const form = $('#itemForm');
  form.reset();
  $('#item-id').value = '';
  $('#deleteItemBtn').style.display = 'none';
  $('#itemExtras').style.display = 'none';

  $('#item-assignee').innerHTML = '<option value="">— nicht zugewiesen —</option>' +
    employees.map(e => `<option value="${e.id}">${escapeHTML(e.name)}</option>`).join('');

  if (id) {
    const it = await api('/items/' + id);
    if (it) {
      $('#itemModalTitle').textContent = 'Bearbeiten';
      $('#item-id').value = it.id;
      $('#item-type').value = it.type;
      $('#item-title').value = it.title;
      $('#item-description').value = it.description || '';
      $('#item-priority').value = it.priority;
      $('#item-status').value = it.status;
      $('#item-assignee').value = it.assignee_id || '';
      $('#item-due').value = it.due_date ? it.due_date.slice(0, 16) : '';
      $('#item-createdby').value = it.created_by || '';
      $('#deleteItemBtn').style.display = 'inline-block';
      $('#itemExtras').style.display = 'block';
      await renderComments(id);
      await renderAttachments(id);
    }
  } else {
    $('#itemModalTitle').textContent = 'Neues Ticket / Termin';
  }
  $('#itemModal').classList.add('active');
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
  if ($('#view-calendar').classList.contains('active')) renderCalendar();
};

$('#deleteItemBtn').onclick = async () => {
  const id = $('#item-id').value;
  if (!id) return;
  if (!confirm('Wirklich löschen? Kommentare und Anhänge werden mit gelöscht.')) return;
  await api('/items/' + id, { method: 'DELETE' });
  $('#itemModal').classList.remove('active');
  await renderItems();
  await renderDashboard();
};

// ---------- Comments ----------
async function renderComments(itemId) {
  const list = await api(`/items/${itemId}/comments`);
  $('#comments-list').innerHTML = list.length ? list.map(c => `
    <div class="comment" data-id="${c.id}">
      <div class="comment-head">
        <span class="comment-author">${escapeHTML(c.author)}</span>
        <span>${fmtDate(c.created_at)} <span style="cursor:pointer;color:var(--danger);" onclick="deleteComment('${c.id}','${itemId}')" title="Löschen">✕</span></span>
      </div>
      <div class="comment-text">${escapeHTML(c.text)}</div>
    </div>
  `).join('') : '<div style="color:var(--text-soft);font-size:13px;">Noch keine Kommentare.</div>';
}

window.deleteComment = async (id, itemId) => {
  if (!confirm('Kommentar löschen?')) return;
  await api('/comments/' + id, { method: 'DELETE' });
  renderComments(itemId);
};

$('#addCommentBtn').onclick = async () => {
  const itemId = $('#item-id').value;
  const text = $('#comment-text').value.trim();
  const author = $('#comment-author').value.trim();
  if (!text) return;
  await api(`/items/${itemId}/comments`, { method: 'POST', body: { text, author } });
  $('#comment-text').value = '';
  await renderComments(itemId);
};

$('#comment-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#addCommentBtn').click(); }
});

// ---------- Attachments ----------
async function renderAttachments(itemId) {
  const list = await api(`/items/${itemId}/attachments`);
  $('#attachments-list').innerHTML = list.length ? list.map(a => `
    <div class="attachment" data-id="${a.id}">
      <span>📎</span>
      <a href="/api/attachments/${a.id}/download" target="_blank">${escapeHTML(a.filename)}</a>
      <span style="color:var(--text-soft);font-size:11px;">${(a.size/1024).toFixed(1)} KB</span>
      <span class="rm" onclick="deleteAttachment('${a.id}','${itemId}')" title="Löschen">✕</span>
    </div>
  `).join('') : '<div style="color:var(--text-soft);font-size:13px;">Keine Anhänge.</div>';
}

window.deleteAttachment = async (id, itemId) => {
  if (!confirm('Anhang löschen?')) return;
  await api('/attachments/' + id, { method: 'DELETE' });
  renderAttachments(itemId);
};

$('#attach-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const itemId = $('#item-id').value;
  if (!itemId) return alert('Bitte erst Ticket speichern.');
  if (file.size > 15 * 1024 * 1024) return alert('Max 15 MB.');
  const reader = new FileReader();
  reader.onload = async () => {
    const dataBase64 = reader.result.split(',')[1];
    await api(`/items/${itemId}/attachments`, {
      method: 'POST',
      body: { filename: file.name, mime: file.type, dataBase64 },
    });
    $('#attach-file').value = '';
    renderAttachments(itemId);
  };
  reader.readAsDataURL(file);
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
        <div class="emp-info" style="margin-top:6px;">
          ${e.telegram_chat_id ? '<span style="color:var(--success);">✈️ Telegram</span>' : ''}
          ${e.whatsapp_key ? '<span style="color:var(--success);margin-left:8px;">📱 WhatsApp</span>' : ''}
        </div>
      </div>
    `).join('')
    : '<div class="empty">Noch keine Mitarbeiter. Klick auf „+ Mitarbeiter".</div>';
  $$('.employee-card').forEach(c => c.onclick = () => openEmployeeModal(c.dataset.id));
}

function openEmployeeModal(id = null) {
  $('#employeeForm').reset();
  $('#emp-id').value = '';
  $('#deleteEmpBtn').style.display = 'none';
  $('#testWhatsAppBtn').style.display = 'none';
  $('#testTelegramBtn').style.display = 'none';
  if (id) {
    const emp = employees.find(e => e.id == id);
    if (emp) {
      $('#employeeModalTitle').textContent = 'Mitarbeiter bearbeiten';
      $('#emp-id').value = emp.id;
      $('#emp-name').value = emp.name;
      $('#emp-email').value = emp.email || '';
      $('#emp-phone').value = emp.phone || '';
      $('#emp-wakey').value = emp.whatsapp_key || '';
      $('#emp-tgid').value = emp.telegram_chat_id || '';
      $('#deleteEmpBtn').style.display = 'inline-block';
      if (emp.telegram_chat_id) $('#testTelegramBtn').style.display = 'inline-block';
      if (emp.phone && emp.whatsapp_key) $('#testWhatsAppBtn').style.display = 'inline-block';
    }
  } else {
    $('#employeeModalTitle').textContent = 'Neuer Mitarbeiter';
  }
  $('#employeeModal').classList.add('active');
}

$('#testTelegramBtn').onclick = async () => {
  const id = $('#emp-id').value;
  if (!id) return;
  $('#testTelegramBtn').textContent = 'Sende...';
  try {
    await api(`/employees/${id}/test-telegram`, { method: 'POST', body: {} });
    alert('✅ Telegram-Test gesendet!');
  } catch (e) { alert('❌ Fehler: ' + e.message); }
  $('#testTelegramBtn').textContent = '✈️ Telegram Test';
};

$('#testWhatsAppBtn').onclick = async () => {
  const id = $('#emp-id').value;
  if (!id) return;
  $('#testWhatsAppBtn').textContent = 'Sende...';
  try {
    const r = await api(`/employees/${id}/test-whatsapp`, { method: 'POST', body: {} });
    alert(r.ok ? '✅ Test-Nachricht gesendet!' : '❌ Fehler: ' + (r.body || 'unbekannt'));
  } catch (e) { alert('❌ Fehler: ' + e.message); }
  $('#testWhatsAppBtn').textContent = '📱 WhatsApp Test';
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
    telegram_chat_id: $('#emp-tgid').value,
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

// ---------- Calendar ----------
async function renderCalendar() {
  allItems = await api('/items');
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const monthName = calDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  $('#cal-title').textContent = 'Kalender – ' + monthName;

  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];

  // Previous month tail
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) days.push({ d: prevDays - i, other: true, date: new Date(year, month - 1, prevDays - i) });
  for (let d = 1; d <= daysInMonth; d++) days.push({ d, other: false, date: new Date(year, month, d) });
  while (days.length % 7 !== 0) {
    const next = days.length - startWeekday - daysInMonth + 1;
    days.push({ d: next, other: true, date: new Date(year, month + 1, next) });
  }

  const today = new Date();
  const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  let html = '<div class="cal-grid">';
  weekdays.forEach(w => html += `<div class="cal-head">${w}</div>`);
  for (const day of days) {
    const isToday = !day.other && day.date.toDateString() === today.toDateString();
    const dayIso = day.date.toISOString().slice(0, 10);
    const dayItems = allItems.filter(i => i.due_date && i.due_date.slice(0, 10) === dayIso);
    html += `<div class="cal-cell ${day.other ? 'other' : ''} ${isToday ? 'today' : ''}">
      <div class="cal-day-num">${day.d}</div>
      ${dayItems.slice(0, 4).map(i => {
        const cls = i.status === 'erledigt' ? 'done' : (isOverdue(i) ? 'overdue' : i.type);
        return `<div class="cal-item ${cls}" onclick="openItemModal('${i.id}')" title="${escapeHTML(i.title)}">${escapeHTML(i.title)}</div>`;
      }).join('')}
      ${dayItems.length > 4 ? `<div style="font-size:10px;color:var(--text-soft);">+${dayItems.length - 4} weitere</div>` : ''}
    </div>`;
  }
  html += '</div>';
  $('#calendar').innerHTML = html;
}
window.openItemModal = openItemModal;

$('#cal-prev').onclick = () => { calDate.setMonth(calDate.getMonth() - 1); renderCalendar(); };
$('#cal-next').onclick = () => { calDate.setMonth(calDate.getMonth() + 1); renderCalendar(); };
$('#cal-today').onclick = () => { calDate = new Date(); renderCalendar(); };

// ---------- Recurring ----------
async function loadRecurrings() {
  recurrings = await api('/recurring');
}

async function renderRecurrings() {
  await loadRecurrings();
  await loadEmployees();
  const el = $('#recurring-list');
  if (!recurrings.length) {
    el.innerHTML = '<div class="empty">Noch keine wiederkehrenden Termine. Klick auf „+ Neu".</div>';
    return;
  }
  el.innerHTML = recurrings.map(r => {
    const emp = employees.find(e => e.id === r.assignee_id);
    const icon = r.type === 'ticket' ? '🎫' : '📅';
    const p = r.pattern || {};
    const time = String(p.hour ?? 0).padStart(2,'0') + ':' + String(p.minute ?? 0).padStart(2,'0');
    let when = '';
    if (p.kind === 'daily') when = `Täglich um ${time}`;
    else if (p.kind === 'weekly') { const wd=['So','Mo','Di','Mi','Do','Fr','Sa'][p.weekday||1]; when=`Wöchentlich ${wd} um ${time}`; }
    else if (p.kind === 'monthly') when = `Monatlich am ${p.day||1}. um ${time}`;
    return `
      <div class="item-card prio-${r.priority}" data-id="${r.id}">
        <div class="item-icon">${icon}</div>
        <div class="item-body">
          <div class="item-title">${escapeHTML(r.title)} ↻</div>
          <div class="item-meta">
            <span>${when}</span>
            ${emp ? `<span>👤 ${escapeHTML(emp.name)}</span>` : ''}
            ${r.active === false ? '<span class="badge badge-erledigt">pausiert</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
  $$('#recurring-list .item-card').forEach(c => c.onclick = () => openRecurringModal(c.dataset.id));
}

function openRecurringModal(id = null) {
  $('#recurringForm').reset();
  $('#rec-id').value = '';
  $('#deleteRecBtn').style.display = 'none';
  $('#rec-assignee').innerHTML = '<option value="">— nicht zugewiesen —</option>' +
    employees.map(e => `<option value="${e.id}">${escapeHTML(e.name)}</option>`).join('');
  updateRecPatternRows();
  if (id) {
    const r = recurrings.find(r => r.id === id);
    if (r) {
      $('#recModalTitle').textContent = 'Wiederkehrend bearbeiten';
      $('#rec-id').value = r.id;
      $('#rec-type').value = r.type;
      $('#rec-title').value = r.title;
      $('#rec-description').value = r.description || '';
      $('#rec-priority').value = r.priority;
      $('#rec-assignee').value = r.assignee_id || '';
      const p = r.pattern || {};
      $('#rec-kind').value = p.kind || 'daily';
      $('#rec-time').value = String(p.hour ?? 8).padStart(2,'0') + ':' + String(p.minute ?? 0).padStart(2,'0');
      $('#rec-weekday').value = p.weekday ?? 1;
      $('#rec-day').value = p.day ?? 1;
      updateRecPatternRows();
      $('#deleteRecBtn').style.display = 'inline-block';
    }
  } else {
    $('#recModalTitle').textContent = 'Wiederkehrender Termin';
  }
  $('#recurringModal').classList.add('active');
}

function updateRecPatternRows() {
  const kind = $('#rec-kind').value;
  $('#rec-weekday-row').style.display = kind === 'weekly' ? 'grid' : 'none';
  $('#rec-day-row').style.display = kind === 'monthly' ? 'grid' : 'none';
}
$('#rec-kind').onchange = updateRecPatternRows;

$('#newRecurringBtn').onclick = () => openRecurringModal();
$('#cancelRecBtn').onclick = () => $('#recurringModal').classList.remove('active');

$('#recurringForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#rec-id').value;
  const [h, m] = $('#rec-time').value.split(':').map(Number);
  const kind = $('#rec-kind').value;
  const pattern = { kind, hour: h, minute: m };
  if (kind === 'weekly') pattern.weekday = Number($('#rec-weekday').value);
  if (kind === 'monthly') pattern.day = Number($('#rec-day').value);
  const body = {
    type: $('#rec-type').value,
    title: $('#rec-title').value,
    description: $('#rec-description').value,
    priority: $('#rec-priority').value,
    assignee_id: $('#rec-assignee').value || null,
    pattern, active: true,
  };
  if (id) await api('/recurring/' + id, { method: 'PUT', body });
  else await api('/recurring', { method: 'POST', body });
  $('#recurringModal').classList.remove('active');
  await renderRecurrings();
};

$('#deleteRecBtn').onclick = async () => {
  const id = $('#rec-id').value;
  if (!confirm('Wiederkehrenden Termin löschen?')) return;
  await api('/recurring/' + id, { method: 'DELETE' });
  $('#recurringModal').classList.remove('active');
  await renderRecurrings();
};

// ---------- Filters ----------
['filter-status','filter-type','filter-assignee'].forEach(id => {
  $('#' + id).onchange = renderItems;
});

// ---------- Manual reminder trigger ----------
$('#runRemindersBtn').onclick = async () => {
  if (!confirm('Erinnerungen JETZT an alle Mitarbeiter senden (mit WhatsApp/Telegram-Setup)?')) return;
  const btn = $('#runRemindersBtn');
  btn.textContent = 'Sende...';
  btn.disabled = true;
  try {
    await api('/reminders/run', { method: 'POST', body: {} });
    alert('✅ Versand läuft im Hintergrund.');
  } catch (e) { alert('❌ Fehler: ' + e.message); }
  btn.textContent = '📱 Jetzt erinnern';
  btn.disabled = false;
};

// Modal backdrop click
$$('.modal').forEach(m => {
  m.onclick = (e) => { if (e.target === m) m.classList.remove('active'); };
});

// ---------- Init ----------
(async () => {
  await loadEmployees();
  await renderDashboard();
})();
