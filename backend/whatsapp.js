// CallMeBot WhatsApp integration
// Docs: https://www.callmebot.com/blog/free-api-whatsapp-messages/

/**
 * Send WhatsApp message via CallMeBot.
 * @param {string} phone  - Empfängernummer mit Ländervorwahl OHNE '+', z.B. "4915212345678"
 * @param {string} key    - Persönlicher CallMeBot-API-Key des Empfängers
 * @param {string} text   - Nachrichten-Text (URL-encoded intern)
 */
async function sendWhatsApp(phone, key, text) {
  if (!phone || !key || !text) throw new Error('phone, key, text erforderlich');

  // Normalize phone: strip '+' and non-digits
  const num = String(phone).replace(/[^\d]/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${num}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;

  const res = await fetch(url);
  const body = await res.text();
  const ok = res.ok && !/error|apikey|APIKey/i.test(body);
  return { ok, status: res.status, body: body.slice(0, 300) };
}

function formatReminderMessage(name, items) {
  const lines = [`🌅 Guten Morgen ${name}!`, ''];
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
    overdue.forEach(i => lines.push(`• ${itemIcon(i)} ${i.title}${dueSuffix(i)}`));
    lines.push('');
  }
  if (today.length) {
    lines.push(`📅 *Heute (${today.length})*`);
    today.forEach(i => lines.push(`• ${itemIcon(i)} ${i.title}${dueSuffix(i)}`));
    lines.push('');
  }
  if (other.length) {
    lines.push(`📋 *Offen (${other.length})*`);
    other.slice(0, 10).forEach(i => lines.push(`• ${itemIcon(i)} ${i.title}${dueSuffix(i)}`));
    if (other.length > 10) lines.push(`  ... und ${other.length - 10} weitere`);
    lines.push('');
  }
  lines.push('👉 Zum Hub: ' + (process.env.PUBLIC_URL || ''));
  return lines.join('\n').trim();
}

function itemIcon(i) {
  if (i.type === 'termin') return '📅';
  return i.priority === 'hoch' ? '🔴' : i.priority === 'niedrig' ? '🔵' : '🟡';
}

function dueSuffix(i) {
  if (!i.due_date) return '';
  const d = new Date(i.due_date);
  return ` (${d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`;
}

module.exports = { sendWhatsApp, formatReminderMessage };
