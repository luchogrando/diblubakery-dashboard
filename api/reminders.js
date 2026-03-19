// api/reminders.js — GET /api/reminders, POST /api/reminders
const { readReminders, appendReminder } = require('./_sheets');
const { requireAuth } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = await requireAuth(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const reminders = await readReminders();
      return res.status(200).json({ ok: true, reminders });
    }
    if (req.method === 'POST') {
      const { orderId, wix } = req.body || {};
      if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
      await appendReminder(orderId, wix || '', user.displayName || user.username);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
