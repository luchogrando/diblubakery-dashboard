// api/webhook.js — POST /api/webhook
// Receives new orders AND fulfillment updates from Wix

const { appendOrder, updateOrder, readOrders } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wix-signature');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-wix-signature'] || req.headers['x-webhook-secret'] || req.query?.secret;
  if (process.env.WIX_WEBHOOK_SECRET && secret !== process.env.WIX_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const body = req.body;
    console.log('WIX PAYLOAD:', JSON.stringify(body, null, 2));

    const wix = body.data || body;
    const eventType = body.type || body.eventType || wix.type || '';

    // ── FULFILLMENT UPDATE EVENT ──────────────────────────────
    // Only treat as fulfillment update if eventType explicitly says so
    // (all new orders also have fulfillmentStatus field so we can't use that)
    if (
      eventType === 'ORDER_FULFILLED' ||
      eventType === 'ORDER_NOT_FULFILLED' ||
      eventType === 'wix.ecom.v1.order_fulfilled' ||
      eventType === 'wix.ecom.v1.order_not_fulfilled'
    ) {
      const orderNumber = '#' + (wix.number || wix.orderNumber);
      const fulfillmentStatus = wix.fulfillmentStatus === 'FULFILLED' ? 'fulfilled' : 'unfulfilled';
      console.log('Fulfillment update:', orderNumber, '->', fulfillmentStatus);

      // Find the order in the Sheet by wix order number and update it
      const orders = await readOrders();
      const existing = orders.find(o => o.wix === orderNumber);
      if (existing) {
        await updateOrder(existing.id, { fulfillment: fulfillmentStatus });
        console.log('Updated fulfillment in Sheet:', orderNumber, fulfillmentStatus);
      } else {
        console.log('Order not found in Sheet for fulfillment update:', orderNumber);
      }
      return res.status(200).json({ ok: true, updated: orderNumber, fulfillment: fulfillmentStatus });
    }

    // ── NEW ORDER EVENT ───────────────────────────────────────
    const order = parseWixOrder(body);

    // Always write as unfulfilled — fulfillment is managed from the dashboard
    // (Wix backoffice orders may arrive with FULFILLED status incorrectly)
    await appendOrder(order);
    console.log('New order from Wix:', order.wix, order.name, '| fulfillment:', order.fulfillment);
    return res.status(200).json({ ok: true, id: order.id });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Failed to process webhook', detail: err.message });
  }
};

function parseWixOrder(payload) {
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
  const wixOrderId = '#' + (wix.orderNumber || wix.number || wix.id || Date.now());

  // Line items
  const lineItems = wix.lineItems || [];
  const items = lineItems.map(item => {
    const baseName = item.itemName || item.productName?.original || item.name || 'Unknown product';
    // Variantes: sabor, tamaño, etc.
    const variants = (item.descriptionLines || [])
      .map(l => l.colorInfo?.original || l.plainText?.original || l.plainTextValue || '')
      .filter(Boolean);
    const options = item.options
      ? Object.values(item.options).filter(Boolean)
      : [];
    const allVariants = [...new Set([...variants, ...options])];
    const fullName = allVariants.length > 0 ? `${baseName} (${allVariants.join(', ')})` : baseName;
    return { p: fullName, q: item.quantity || 1 };
  });

  // Total
  const pricing = wix.priceSummary || {};
  const total = parseFloat(pricing.total?.amount || pricing.total?.value || pricing.subtotal?.amount || pricing.subtotal?.value || 0) || null;

  // Shipping
  const shippingInfo = wix.shippingInfo || {};
  const shippingTitle = shippingInfo.title || '';
  const titleLower = shippingTitle.toLowerCase();

  // Type
  const pickupMethod = shippingInfo.logistics?.pickupDetails?.pickupMethod
    || shippingInfo.logistics?.shippingDestination?.pickupMethod || '';
  const isPickup = pickupMethod === 'STORE_PICKUP'
    || titleLower.includes('pick up')
    || titleLower.includes('pickup')
    || titleLower.includes('pick-up');
  const type = isPickup ? 'pickup' : 'delivery';

  // Custom date
  const isCustomDate = titleLower.includes('custom date') || titleLower.includes('custom');

  // Parse date from title
  let date = null;
  if (!isCustomDate) {
    const slashMatch = shippingTitle.match(/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
      const month = slashMatch[1].padStart(2, '0');
      const day = slashMatch[2].padStart(2, '0');
      date = `${new Date().getFullYear()}-${month}-${day}`;
    } else {
      const months = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      const monthMatch = shippingTitle.match(/([a-z]+)\s+(\d{1,2})/i);
      if (monthMatch) {
        const m = months[monthMatch[1].toLowerCase()];
        if (m) date = `${new Date().getFullYear()}-${m}-${monthMatch[2].padStart(2, '0')}`;
      }
    }
  }

  // Shift
  let shift = 'morning';
  if (!isCustomDate) {
    const timeMatch = shippingTitle.match(/(\d{1,2})[:-]?\d*\s*(am|pm)/i);
    if (timeMatch) {
      shift = timeMatch[2].toLowerCase() === 'am' ? 'morning' : 'afternoon';
    } else if (titleLower.includes('afternoon') || titleLower.includes('pm')) {
      shift = 'afternoon';
    }
  }

  // Notes — recolectamos todos los campos posibles de Wix que pueden contener notas
  const noteFields = [
    wix.buyerNote,
    wix.internalNote,
    wix.buyerInfo?.buyerNote,
    wix.giftMessage,
    wix.note,
    wix.customFields?.map(f => `${f.title}: ${f.value}`).join(' | '),
    wix.channelInfo?.externalOrderNotes,
  ].filter(Boolean).map(s => String(s).trim()).filter(s => s.length > 0);

  let notes = [...new Set(noteFields)].join(' | ');
  if (type === 'delivery') {
    const dest = shippingInfo.logistics?.shippingDestination?.address;
    if (dest) {
      const addr = [dest.addressLine, dest.city, dest.postalCode].filter(Boolean).join(', ');
      if (addr) notes = notes ? `${notes} | Delivery: ${addr}` : `Delivery: ${addr}`;
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
    fulfillment: wix.fulfillmentStatus === 'FULFILLED' ? 'fulfilled' : 'unfulfilled',
    delivery: 'pending',
    customDate: isCustomDate || !date,
    recurring: false,
    notes,
    items,
    total,
    edited: false,
    editedBy: '',
    createdAt: wix.createdDate || new Date().toISOString(),
  };
}
