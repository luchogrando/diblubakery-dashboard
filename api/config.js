// api/config.js — GET /api/config and POST /api/config
// Reads and writes BASE_PRODUCTS and PRODS from Google Sheets

const { readProducts, writeProducts, readPresentations, writePresentations, readSettings, writeSettings } = require('./_sheets');

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
      const [products, presentations, settings] = await Promise.all([
        readProducts(),
        readPresentations(),
        readSettings(),
      ]);
      return res.status(200).json({
        ok: true,
        products: products || {},
        presentations: presentations || {},
        settings: settings || {},
      });
    }

    if (req.method === 'POST') {
      const { products, presentations, settings } = req.body || {};
      const ops = [];
      if (products !== undefined) ops.push(writeProducts(products));
      if (presentations !== undefined) ops.push(writePresentations(presentations));
      if (settings !== undefined) ops.push(writeSettings(settings));
      await Promise.all(ops);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Config error:', err);
    return res.status(500).json({ error: err.message });
  }
};

const { requireAuth } = require('./_auth');
