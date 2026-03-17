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
  // Contact info — from contact object
  const contact = wix.contact || {};
  const firstName = contact.firstName || '';
  const lastName  = contact.lastName  || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || wix.buyerEmail || 'Unknown';
  const phone = contact.phone || '';

  // Order number
  const wixOrderId = '#' + (wix.orderNumber || wix.id || Date.now());

  // Line items
  const lineItems = wix.lineItems || [];
  const items = lineItems.map(item => ({
    p: item.productName?.original || item.productName?.translated || item.name || 'Unknown product',
    q: item.quantity || 1,
  }));

  // Total — priceSummary.total.value
  const pricing = wix.priceSummary || {};
  const totalRaw = pricing.total;
  const total = totalRaw?.amount
    ? parseFloat(totalRaw.amount)
    : totalRaw?.value
      ? parseFloat(totalRaw.value)
      : parseFloat(totalRaw) || null;

  // Delivery type — if pickupMethod exists it's a pickup, otherwise delivery
  const shippingInfo = wix.shippingInfo || {};
  const logistics = shippingInfo.logistics || {};
  const isPickup = !!(logistics.pickupDetails || logistics.pickupMethod || shippingInfo.pickupMethod);
  const type = isPickup ? 'pickup' : 'delivery';

  // Buyer note
  const notes = wix.buyerNote || wix.checkoutCustomFields?.buyerNote || '';

  return {
    id: Date.now(),
    wix: wixOrderId,
    name,
    phone,
    date: null,
    shift: 'morning',
    type,
    fulfillment: 'unfulfilled',
    delivery: 'pending',
    customDate: true,
    recurring: false,
    notes,
    items,
    total,
    edited: false,
    editedBy: '',
    createdAt: wix.createdDate || new Date().toISOString(),
  };
}
