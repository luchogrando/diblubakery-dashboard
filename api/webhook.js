// api/webhook.js — POST /api/webhook
// Receives new orders from Wix and writes them to Google Sheets

const { appendOrder } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wix-signature');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional: verify Wix webhook secret
  const secret = req.headers['x-wix-signature'] || req.headers['x-webhook-secret'];
  if (process.env.WIX_WEBHOOK_SECRET && secret !== process.env.WIX_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const body = req.body;
    // Wix sends order data — we map it to our format
    const order = parseWixOrder(body);
    await appendOrder(order);
    console.log('New order from Wix:', order.wix, order.name);
    return res.status(200).json({ ok: true, id: order.id });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Failed to process webhook', detail: err.message });
  }
};

function parseWixOrder(wix) {
  // Wix eCommerce order structure
  // https://dev.wix.com/docs/rest/api-reference/wix-e-commerce/orders/introduction
  const buyerInfo = wix.buyerInfo || wix.billingInfo || {};
  const shippingInfo = wix.shippingInfo || {};

  const firstName = buyerInfo.firstName || wix.recipientInfo?.firstName || '';
  const lastName  = buyerInfo.lastName  || wix.recipientInfo?.lastName  || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

  const phone = buyerInfo.phone
    || shippingInfo.shipmentDetails?.address?.phone
    || '';

  const wixOrderId = '#' + (wix.number || wix.id || Date.now());

  // Parse line items → our items format [{p: productName, q: quantity}]
  const lineItems = wix.lineItems || [];
  const items = lineItems.map(item => ({
    p: item.name || item.productName?.original || 'Unknown product',
    q: item.quantity || 1,
  }));

  // Total paid by customer (from Wix pricing summary)
  const pricing = wix.priceSummary || wix.totals || {};
  const total = parseFloat(pricing.total || pricing.grandTotal || 0) || null;

  // Generate a unique id based on Wix order number + timestamp
  const id = Date.now();

  return {
    id,
    wix: wixOrderId,
    name,
    phone,
    date: null,       // to be assigned manually in dashboard
    shift: 'morning', // default, can be changed in dashboard
    type: shippingInfo.deliveryOption === 'DELIVERY' ? 'delivery' : 'pickup',
    fulfillment: 'unfulfilled',
    delivery: 'pending',
    customDate: true, // starts as custom date — needs to be allocated
    recurring: false,
    notes: wix.buyerNote || '',
    items,
    total,
    edited: false,
    editedBy: '',
    createdAt: new Date().toISOString(),
  };
}
