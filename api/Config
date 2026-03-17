// api/config.js — GET /api/config and POST /api/config
// Reads and writes BASE_PRODUCTS and PRODS from Google Sheets

const { readProducts, writeProducts, readPresentations, writePresentations } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!isValidToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      // Read both tables
      const [products, presentations] = await Promise.all([
        readProducts(),
        readPresentations(),
      ]);
      return res.status(200).json({
        ok: true,
        products: products || {},
        presentations: presentations || {},
      });
    }

    if (req.method === 'POST') {
      const { products, presentations } = req.body || {};
      const ops = [];
      if (products !== undefined) ops.push(writeProducts(products));
      if (presentations !== undefined) ops.push(writePresentations(presentations));
      await Promise.all(ops);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Config error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function isValidToken(token) {
  const users = (process.env.USERS || '').split(',');
  return users.some(u => {
    const [username, password] = u.trim().split(':');
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      return decoded === `${username}:${password}`;
    } catch { return false; }
  });
}
