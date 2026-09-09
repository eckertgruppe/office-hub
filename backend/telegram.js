// Telegram Bot integration
// Docs: https://core.telegram.org/bots/api

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const API = (m) => `https://api.telegram.org/bot${TOKEN()}/${m}`;

async function tg(method, body) {
  if (!TOKEN()) throw new Error('TELEGRAM_BOT_TOKEN nicht gesetzt');
  const r = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || 'Telegram error');
  return data.result;
}

async function sendMessage(chatId, text) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
}

function formatReminderMessage(name, items) {
  const lines = [`🌅 *Guten Morgen ${name}!*`, ''];
  const overdue = items.filter(i => i.due_date && new Date(i.due_date) < new Date());
  const today = items.filter(i => {
    if (!i.due_date) return false;
    const d = new Date(i.due_date);
    const now = new Date();
    return d.toDateString() === now.toDateString() && d >= now;
  });
  const other = items.filter(i => !overdue.includes(i) && !today.includes(i));

  if (overdue.length) {
    lines.push(`🚨 *Überfällig (${overdue.length})*`);
    overdue.forEach(i => lines.push(`• ${itemIcon(i)} ${escape(i.title)}${dueSuffix(i)}`));
    lines.push('');
  }
  if (today.length) {
    lines.push(`📅 *Heute (${today.length})*`);
    today.forEach(i => lines.push(`• ${itemIcon(i)} ${escape(i.title)}${dueSuffix(i)}`));
    lines.push('');
  }
  if (other.length) {
    lines.push(`📋 *Weitere offen (${other.length})*`);
    other.slice(0, 10).forEach(i => lines.push(`• ${itemIcon(i)} ${escape(i.title)}${dueSuffix(i)}`));
    if (other.length > 10) lines.push(`  ... und ${other.length - 10} weitere`);
    lines.push('');
  }
  if (process.env.PUBLIC_URL) {
    lines.push(`👉 [Zum Hub](${process.env.PUBLIC_URL})`);
  }
  return lines.join('\n').trim();
}

function itemIcon(i) {
  if (i.type === 'termin') return '📅';
  return i.priority === 'hoch' ? '🔴' : i.priority === 'niedrig' ? '🔵' : '🟡';
}

function dueSuffix(i) {
  if (!i.due_date) return '';
  const d = new Date(i.due_date);
  return ` _(${d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})_`;
}

function escape(s) {
  // minimales Markdown-Escape für v1 (Telegram)
  return String(s || '').replace(/([_*`\[])/g, '\\$1');
}

module.exports = { sendMessage, formatReminderMessage };
