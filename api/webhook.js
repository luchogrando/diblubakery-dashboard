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
    // DEBUG — log full payload to see Wix structure
    console.log('WIX PAYLOAD:', JSON.stringify(body, null, 2));
    const order = parseWixOrder(body);
    await appendOrder(order);
    console.log('New order from Wix:', order.wix, order.name);
    return res.status(200).json({ ok: true, id: order.id });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Failed to process webhook', detail: err.message });
  }
};

function parseWixOrder(payload) {
  // Wix wraps everything in a "data" object
  const wix = payload.data || payload;

  // Contact
  const contact = wix.contact || {};
  const name = [contact.name?.first, contact.name?.last].filter(Boolean).join(' ')
    || wix.billingInfo?.contactDetails?.firstName
    || wix.buyerEmail
    || 'Unknown';
  const phone = contact.phone
    || contact.phones?.[0]?.phone
    || wix.billingInfo?.contactDetails?.phone
    || '';

  // Order number
  const wixOrderId = '#' + (wix.orderNumber || wix.id || Date.now());

  // Line items — itemName is the correct field
  const lineItems = wix.lineItems || [];
  const items = lineItems.map(item => ({
    p: item.itemName || item.productName?.original || item.name || 'Unknown product',
    q: item.quantity || 1,
  }));

  // Total — use subtotal (before discounts) or total
  const pricing = wix.priceSummary || {};
  const total = parseFloat(pricing.total?.value || pricing.subtotal?.value || 0) || null;

  // Shipping title for date/shift/type parsing
  const shippingInfo = wix.shippingInfo || {};
  const shippingTitle = shippingInfo.title || '';
  const titleLower = shippingTitle.toLowerCase();

  // Type — STORE_PICKUP in logistics means pickup
  const pickupMethod = shippingInfo.logistics?.shippingDestination?.pickupMethod || '';
  const isPickup = pickupMethod === 'STORE_PICKUP'
    || titleLower.includes('pick up')
    || titleLower.includes('pickup')
    || titleLower.includes('pick-up');
  const type = isPickup ? 'pickup' : 'delivery';

  // Custom date
  const isCustomDate = titleLower.includes('custom date') || titleLower.includes('custom');

  // Parse date from title e.g. "monday 9-11am", "Pick-up Jersey City 3/20"
  let date = null;
  if (!isCustomDate) {
    const slashMatch = shippingTitle.match(/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
      const month = slashMatch[1].padStart(2,'0');
      const day   = slashMatch[2].padStart(2,'0');
      date = `${new Date().getFullYear()}-${month}-${day}`;
    } else {
      const months = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      const monthMatch = shippingTitle.match(/([a-z]+)\s+(\d{1,2})/i);
      if (monthMatch) {
        const m = months[monthMatch[1].toLowerCase()];
        if (m) date = `${new Date().getFullYear()}-${m}-${monthMatch[2].padStart(2,'0')}`;
      }
    }
  }

  // Parse shift from title — "9-11am", "morning" = morning; "pm", "afternoon" = afternoon
  let shift = 'morning';
  if (!isCustomDate) {
    const timeMatch = shippingTitle.match(/(\d{1,2})[:-]?\d*\s*(am|pm)/i);
    if (timeMatch) {
      const ampm = timeMatch[2].toLowerCase();
      shift = ampm === 'am' ? 'morning' : 'afternoon';
    } else if (titleLower.includes('afternoon') || titleLower.includes('pm')) {
      shift = 'afternoon';
    }
  }

  return {
    id: Date.now(),
    wix: wixOrderId,
    name,
    phone,
    date: isCustomDate ? null : date,
    shift,
    type,
    fulfillment: 'unfulfilled',
    delivery: 'pending',
    customDate: isCustomDate || !date,
    recurring: false,
    notes: wix.buyerNote || '',
    items,
    total,
    edited: false,
    editedBy: '',
    createdAt: wix.createdDate || new Date().toISOString(),
  };
}
