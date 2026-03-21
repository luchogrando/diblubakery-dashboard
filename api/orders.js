// api/orders.js — GET /api/orders
// Returns all orders from Google Sheets

const { readOrders, appendOrder, deleteOrder } = require('./_sheets');

const ALLOWED_ORIGINS = ['https://diblubakery-dashboard.vercel.app'];

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const authUser = await requireAuth(token);
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

  // ── DEBUG: fetch raw Wix order payload ──────────────────────
  // GET /api/orders?debug=11479
  if (req.method === 'GET' && req.query.debug) {
    const num = parseInt(req.query.debug);
    const WIX_API_KEY = process.env.WIX_API_KEY;
    const WIX_SITE_ID = process.env.WIX_SITE_ID;
    try {
      const r = await fetch('https://www.wixapis.com/ecom/v1/orders/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WIX_API_KEY,
          'wix-site-id': WIX_SITE_ID,
        },
        body: JSON.stringify({ filter: { number: { $eq: num } } }),
      });
      const data = await r.json();
      const order = (data.orders || [])[0] || null;
      // Return the raw payload so we can inspect contact, lineItems, etc.
      return res.status(200).json({
        raw: order,
        contact: order?.contact,
        billingInfo: order?.billingInfo?.contactDetails,
        lineItems: order?.lineItems,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  // ────────────────────────────────────────────────────────────

  try {
    if (req.method === 'POST') {
      const order = req.body;
      if (!order || !order.wix) return res.status(400).json({ error: 'Invalid order' });
      await appendOrder(order);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await deleteOrder(id);
      return res.status(200).json({ ok: true });
    }
    const orders = await readOrders();
    return res.status(200).json({ orders });
  } catch (err) {
    console.error('Error reading orders:', err);
    return res.status(500).json({ error: 'Failed to read orders', detail: err.message });
  }
};

const { requireAuth } = require('./_auth');
