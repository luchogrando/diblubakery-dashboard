// api/unfulfill.js — POST /api/unfulfill
// Marks a Wix order as unfulfilled by deleting all its fulfillments

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!isValidToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  const { wixOrderNumber } = req.body || {};
  if (!wixOrderNumber) return res.status(400).json({ error: 'Missing wixOrderNumber' });

  const orderNumber = String(wixOrderNumber).replace('#', '');

  try {
    const WIX_API_KEY = process.env.WIX_API_KEY;
    const WIX_SITE_ID = process.env.WIX_SITE_ID;

    if (!WIX_API_KEY || !WIX_SITE_ID) {
      return res.status(500).json({ error: 'Wix API credentials not configured' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': WIX_API_KEY,
      'wix-site-id': WIX_SITE_ID,
    };

    // Step 1: Find order ID
    const searchRes = await fetch('https://www.wixapis.com/ecom/v1/orders/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ filter: { number: { $eq: parseInt(orderNumber) } } }),
    });
    const searchData = await searchRes.json();
    console.log('Wix search status:', searchRes.status);
    const order = searchData.orders?.[0];
    if (!order) return res.status(404).json({ error: `Order #${orderNumber} not found in Wix` });

    // Step 2: List fulfillments for this order
    const listRes = await fetch(
      `https://www.wixapis.com/ecom/v1/fulfillments/orders/${order.id}`,
      { method: 'GET', headers }
    );
    const listText = await listRes.text();
    console.log('List fulfillments status:', listRes.status, 'data:', listText);
    let listData = {};
    try { listData = JSON.parse(listText); } catch(e) {}

    const fulfillments = listData.orderWithFulfillments?.fulfillments || [];
    console.log(`Found ${fulfillments.length} fulfillment(s) to delete`);

    if (fulfillments.length === 0) {
      return res.status(200).json({ ok: true, message: 'No fulfillments to delete' });
    }

    // Step 3: Delete each fulfillment
    for (const f of fulfillments) {
      const delRes = await fetch(
        `https://www.wixapis.com/ecom/v1/fulfillments/orders/${order.id}/fulfillments/${f.id}`,
        { method: 'DELETE', headers }
      );
      const delText = await delRes.text();
      console.log(`Delete fulfillment ${f.id} status:`, delRes.status, delText);
    }

    console.log(`Order #${orderNumber} marked as unfulfilled in Wix`);
    return res.status(200).json({ ok: true, deleted: fulfillments.length });

  } catch (err) {
    console.error('Unfulfill error:', err);
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
