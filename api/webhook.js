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

function parseWixOrder(wix) {
  // Contact info
  const contact = wix.contact || {};
  const billingInfo = wix.billingInfo || {};
  const shippingInfo = wix.shippingInfo || {};

  const firstName = contact.firstName || billingInfo.contactDetails?.firstName || '';
  const lastName  = contact.lastName  || billingInfo.contactDetails?.lastName  || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || wix.buyerEmail || 'Unknown';

  const phone = contact.phone
    || billingInfo.contactDetails?.phone
    || shippingInfo.shippingDestination?.contactDetails?.phone
    || '';

  // Order number
  const wixOrderId = '#' + (wix.orderNumber || wix.id || Date.now());

  // Shipping title — e.g. "Pick-up Jersey City 3/20, Friday, March 20th 5pm-7pm"
  const shippingTitle = shippingInfo.title
    || shippingInfo.logistics?.deliveryTime
    || shippingInfo.deliveryOption
    || '';

  // Delivery type
  const titleLower = shippingTitle.toLowerCase();
  const isCustomDate = titleLower.includes('custom date') || titleLower.includes('custom');
  const isPickup = titleLower.includes('pick up') || titleLower.includes('pickup') || titleLower.includes('pick-up');
  const type = isPickup ? 'pickup' : 'delivery';

  // Parse date from title — looks for patterns like "3/20", "March 20", "Mar 20"
  let date = null;
  if (!isCustomDate) {
    // Try MM/DD pattern e.g. "3/20"
    const slashMatch = shippingTitle.match(/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
      const month = slashMatch[1].padStart(2,'0');
      const day   = slashMatch[2].padStart(2,'0');
      const year  = new Date().getFullYear();
      date = `${year}-${month}-${day}`;
    } else {
      // Try "March 20th" / "Mar 20" pattern
      const months = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      const monthMatch = shippingTitle.match(/([a-z]+)\s+(\d{1,2})/i);
      if (monthMatch) {
        const m = months[monthMatch[1].toLowerCase()];
        if (m) {
          const day = monthMatch[2].padStart(2,'0');
          const year = new Date().getFullYear();
          date = `${year}-${m}-${day}`;
        }
      }
    }
  }

  // Parse shift from title — morning if "am" or hour < 12, afternoon otherwise
  let shift = 'morning';
  if (!isCustomDate) {
    const timeMatch = shippingTitle.match(/(\d{1,2})(am|pm)/i);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const ampm = timeMatch[2].toLowerCase();
      shift = (ampm === 'am' || (ampm === 'pm' && hour === 12 ? false : hour < 12)) ? 'morning' : 'afternoon';
    } else if (titleLower.includes('afternoon') || titleLower.includes('pm')) {
      shift = 'afternoon';
    }
  }

  // Line items
  const lineItems = wix.lineItems || [];
  const items = lineItems.map(item => ({
    p: item.productName?.original || item.productName?.translated || item.name || 'Unknown product',
    q: item.quantity || 1,
  }));

  // Total
  const pricing = wix.priceSummary || {};
  const totalRaw = pricing.total;
  const total = totalRaw?.amount
    ? parseFloat(totalRaw.amount)
    : totalRaw?.value
      ? parseFloat(totalRaw.value)
      : parseFloat(totalRaw) || null;

  return {
    id: Date.now(),
    wix: wixOrderId,
    name,
    phone,
    date: isCustomDate ? null : date,
    shift: isCustomDate ? 'morning' : shift,
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
