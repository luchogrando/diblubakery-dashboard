// api/orders.js — GET /api/orders
// Returns all orders from Google Sheets
// Also handles auth check via USERS env variable

const { readOrders } = require('./_sheets');

const ALLOWED_ORIGINS = ['https://diblubakery-dashboard.vercel.app'];

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check — Bearer token must match a known user token
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const orders = await readOrders();
    return res.status(200).json({ orders });
  } catch (err) {
    console.error('Error reading orders:', err);
    return res.status(500).json({ error: 'Failed to read orders', detail: err.message });
  }
};

function isValidToken(token) {
  // USERS env var format: "username:password:role,username2:password2:role2"
  const users = (process.env.USERS || '').split(',');
  return users.some(u => {
    const [username, password] = u.trim().split(':');
    // token is base64(username:password)
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      return decoded === `${username}:${password}`;
    } catch { return false; }
  });
}
