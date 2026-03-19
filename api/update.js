// api/update.js — POST /api/update
// Updates a single order field (fulfillment, delivery, date, etc.)

const { updateOrder } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const authUser = await requireAuth(token);
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id, ...fields } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing order id' });
    const updated = await updateOrder(id, fields);
    return res.status(200).json({ ok: true, order: updated });
  } catch (err) {
    console.error('Error updating order:', err);
    return res.status(500).json({ error: 'Failed to update order', detail: err.message });
  }
};

const { requireAuth } = require('./_auth');
