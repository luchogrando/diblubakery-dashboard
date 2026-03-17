// api/fulfill.js — POST /api/fulfill
// Marks a Wix order as fulfilled via Wix REST API

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

  // Wix order number comes as "#11461" — strip the #
  const orderNumber = String(wixOrderNumber).replace('#', '');

  try {
    const WIX_API_KEY    = process.env.WIX_API_KEY;
    const WIX_ACCOUNT_ID = process.env.WIX_ACCOUNT_ID;
    const WIX_SITE_ID    = process.env.WIX_SITE_ID;

    if (!WIX_API_KEY || !WIX_ACCOUNT_ID || !WIX_SITE_ID) {
      return res.status(500).json({ error: 'Wix API credentials not configured' });
    }

    // Step 1: Get the order ID from the order number
    const searchRes = await fetch(
      `https://www.wixapis.com/ecom/v1/orders/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WIX_API_KEY,
          'wix-site-id': WIX_SITE_ID,
        },
        body: JSON.stringify({
          filter: { number: { $eq: parseInt(orderNumber) } }
        }),
      }
    );
    const searchData = await searchRes.json();
    console.log('Wix search status:', searchRes.status, 'data:', JSON.stringify(searchData));
    const order = searchData.orders?.[0];
    if (!order) return res.status(404).json({ error: `Order #${orderNumber} not found in Wix`, searchData });

    // Step 2: Create a fulfillment for the order
    const fulfillUrl = `https://www.wixapis.com/ecom/v1/fulfillments/orders/${order.id}/create-fulfillment`;
    const fulfillBody = {
      fulfillment: {
        lineItems: order.lineItems.map(function(item) {
          return { id: item.id, quantity: item.quantity };
        }),
      }
    };
    console.log('Fulfill URL:', fulfillUrl);
    console.log('Fulfill body:', JSON.stringify(fulfillBody));

    const fulfillRes = await fetch(fulfillUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': WIX_API_KEY,
        'wix-site-id': WIX_SITE_ID,
      },
      body: JSON.stringify(fulfillBody),
    });

    const fulfillText = await fulfillRes.text();
    console.log('Wix fulfill status:', fulfillRes.status, 'data:', fulfillText);
    let fulfillData = {};
    try { fulfillData = JSON.parse(fulfillText); } catch(e) {}

    // 409 = already exists, 400 with "Validation failed" = fulfillment already exists
    // Both mean the order is already fulfilled in Wix — treat as success
    if (!fulfillRes.ok) {
      const isAlreadyFulfilled = fulfillRes.status === 409
        || (fulfillRes.status === 400 && JSON.stringify(fulfillData).includes('Validation failed'));
      if (isAlreadyFulfilled) {
        console.log(`Order #${orderNumber} already fulfilled in Wix — ok`);
        return res.status(200).json({ ok: true, already_fulfilled: true });
      }
      return res.status(500).json({ error: 'Failed to fulfill in Wix', detail: fulfillData });
    }

    console.log(`Order #${orderNumber} marked as fulfilled in Wix`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Fulfill error:', err);
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
