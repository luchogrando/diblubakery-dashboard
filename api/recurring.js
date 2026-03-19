const { requireAuth } = require('./_auth');
// api/recurring.js — GET /api/recurring and POST /api/recurring
const { readRecurring, writeRecurring } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const authUser = await requireAuth(token);
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const recurring = await readRecurring();
      return res.status(200).json({ ok: true, recurring });
    }
    if (req.method === 'POST') {
      const { recurring } = req.body || {};
      if (!Array.isArray(recurring)) return res.status(400).json({ error: 'recurring must be array' });
      await writeRecurring(recurring);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    console.error('Recurring error:', err);
    return res.status(500).json({ error: err.message });
  }
};
