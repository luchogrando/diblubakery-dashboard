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
    // Parse the webhook payload first
    let orderData = body.data || body;

    // Log key fields to find where buyer note and variants come from
    console.log('WEBHOOK_NOTE_FIELDS:', JSON.stringify({
      buyerNote: orderData.buyerNote,
      internalNote: orderData.internalNote,
      note: orderData.note,
      customFields: orderData.customFields,
      number: orderData.number || orderData.orderNumber,
    }));
    console.log('WEBHOOK_LINEITEMS_SAMPLE:', JSON.stringify({
      name: orderData.lineItems?.[0]?.productName,
      descLines: orderData.lineItems?.[0]?.descriptionLines,
      catOpts: orderData.lineItems?.[0]?.catalogReference?.options,
    }));

    // If any lineItem is missing descriptionLines/variants, enrich from Wix API
    const lineItems = orderData.lineItems || [];
    const needsEnrichment = lineItems.some(item => {
      const hasDescLines = (item.descriptionLines || []).length > 0;
      const hasCatOpts = Object.keys(item.catalogReference?.options?.options || {}).length > 0;
      return !hasDescLines && !hasCatOpts;
    });

    if (needsEnrichment && process.env.WIX_API_KEY && process.env.WIX_SITE_ID) {
      try {
        const orderNum = parseInt(orderData.number || orderData.orderNumber);
        const r = await fetch('https://www.wixapis.com/ecom/v1/orders/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': process.env.WIX_API_KEY,
            'wix-site-id': process.env.WIX_SITE_ID,
          },
          body: JSON.stringify({
            sort: [{ fieldName: 'number', order: 'DESC' }],
            cursorPaging: { limit: 50 }
          }),
        });
        const data = await r.json();
        // Find by number manually — $eq filter is broken in Wix API
        const enriched = (data.orders || []).find(o => parseInt(o.number) === orderNum);
        if (enriched) {
          orderData = { ...orderData, lineItems: enriched.lineItems || orderData.lineItems };
          console.log('Enriched order', orderNum, 'from Wix API');
        }
      } catch (e) {
        console.warn('Could not enrich order from Wix API:', e.message);
      }
    }

    const order = parseWixOrder({ ...body, data: orderData, lineItems: orderData.lineItems });

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

  // Contact — try contact.name first, then billingInfo (which has firstName + lastName)
  const contact = wix.contact || {};
  const billing = wix.billingInfo?.contactDetails || {};
  const name = [contact.name?.first, contact.name?.last].filter(Boolean).join(' ')
    || [billing.firstName, billing.lastName].filter(Boolean).join(' ')
    || wix.buyerEmail
    || 'Unknown';
  const phone = contact.phone
    || contact.phones?.[0]?.phone
    || billing.phone
    || '';

  // Order number
  const wixOrderId = '#' + (wix.orderNumber || wix.number || wix.id || Date.now());

  // Line items — prefer top-level lineItems (enriched) over nested
  const lineItems = payload.lineItems || wix.lineItems || [];

  // Line items
  const items = lineItems.map(item => {
    const baseName = item.itemName || item.productName?.original || item.name || 'Unknown product';
    // Variants: size, flavor, etc. — from descriptionLines
    const variants = (item.descriptionLines || [])
      .map(l => l.colorInfo?.original || l.plainText?.original || l.plainTextValue?.original || l.value || '')
      .filter(Boolean);
    // Also check catalogReference.options.options (e.g. {Size: "Individual"})
    const catalogOptions = item.catalogReference?.options?.options || {};
    const catalogVariants = Object.values(catalogOptions).filter(Boolean);
    const allVariants = [...new Set([...variants, ...catalogVariants])];
    const fullName = allVariants.length > 0 ? `${baseName} - ${allVariants.join(', ')}` : baseName;
    return { p: fullName, q: item.quantity || 1 };
  });

  // Total
  const pricing = wix.priceSummary || {};
  const total = parseFloat(pricing.total?.amount || pricing.total?.value || pricing.subtotal?.amount || pricing.subtotal?.value || 0) || null;

  // Shipping
  const shippingInfo = wix.shippingInfo || {};
  const shippingTitle = shippingInfo.title || '';
  const titleLower = shippingTitle.toLowerCase();

  // Type — "Delivery ..." titles = delivery, "Pick-up/Pickup/Custom Date" = pickup
  const isPickup = titleLower.includes('pick up')
    || titleLower.includes('pickup')
    || titleLower.includes('pick-up')
    || titleLower.includes('custom date')
    || titleLower.includes('custom')
    || (!titleLower.includes('delivery') && !titleLower.includes('manhattan') && !titleLower.includes('brooklyn') && !titleLower.includes('jersey') && !titleLower.includes('lic') && !titleLower.includes('hoboken') && !!shippingInfo.logistics?.pickupDetails);
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

  // Notes — buyer note and custom fields only
  const noteFields = [
    wix.buyerNote,
    wix.internalNote,
    wix.buyerInfo?.buyerNote,
    wix.giftMessage,
    wix.note,
    wix.customFields?.map(f => `${f.title}: ${f.value}`).join(' | '),
    wix.channelInfo?.externalOrderNotes,
  ].filter(Boolean).map(s => String(s).trim()).filter(s => s.length > 0);
  const notes = [...new Set(noteFields)].join(' | ');

  // Address — pickup address or delivery address
  let address = '';
  if (type === 'delivery') {
    const dest = shippingInfo.logistics?.shippingDestination?.address;
    if (dest) {
      address = [dest.addressLine, dest.city, dest.subdivision?.replace(/^US-/, ''), dest.postalCode].filter(Boolean).join(', ');
    }
  } else {
    const pickup = shippingInfo.logistics?.pickupDetails?.address;
    if (pickup) {
      address = [pickup.addressLine, pickup.city, pickup.postalCode].filter(Boolean).join(', ');
    }
  }

  return {
    id: wix.id || Date.now(),
    wix: wixOrderId,
    name,
    phone,
    date: isCustomDate ? null : date,
    shift,
    type,
    fulfillment: wix.fulfillmentStatus === 'FULFILLED' ? 'fulfilled' : 'unfulfilled',
    delivery: wix.fulfillmentStatus === 'FULFILLED' ? 'delivered' : 'pending',
    customDate: isCustomDate || !date,
    recurring: false,
    notes,
    items,
    total,
    address,
    edited: false,
    editedBy: '',
    createdAt: wix.createdDate || new Date().toISOString(),
  };
}
