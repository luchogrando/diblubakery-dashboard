// api/orders.js — GET /api/orders
// Returns all orders from Google Sheets
// Also handles auth check via USERS env variable
//
// MODO IMPORTACIÓN (temporal):
//   GET /api/orders?import=wix
//   Trae todas las órdenes unfulfilled de Wix y las inserta en el Sheet
//   Una vez usada, revertir a la versión original

const { readOrders, appendOrder, deleteOrder } = require('./_sheets');

const ALLOWED_ORIGINS = ['https://diblubakery-dashboard.vercel.app'];

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check — Bearer token must match a known user token
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const authUser = await requireAuth(token);
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

  // ── MODO IMPORTACIÓN DESDE WIX ──────────────────────────────
  if (req.method === 'GET' && req.query.import === 'wix') {
    return handleWixImport(req, res);
  }
  // ────────────────────────────────────────────────────────────

  try {
    if (req.method === 'POST') {
      const order = req.body;
      if (!order || !order.wix) return res.status(400).json({ error: 'Invalid order' });
      await appendOrder(order);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await deleteOrder(id);
      return res.status(200).json({ ok: true });
    }
    const orders = await readOrders();
    return res.status(200).json({ orders });
  } catch (err) {
    console.error('Error reading orders:', err);
    return res.status(500).json({ error: 'Failed to read orders', detail: err.message });
  }
};

// ── IMPORTACIÓN DESDE WIX API ────────────────────────────────
async function handleWixImport(req, res) {
  const WIX_API_KEY = process.env.WIX_API_KEY;
  const WIX_SITE_ID = process.env.WIX_SITE_ID;

  if (!WIX_API_KEY || !WIX_SITE_ID) {
    return res.status(500).json({ error: 'WIX_API_KEY o WIX_SITE_ID no configurados' });
  }

  try {
    // Traer todas las órdenes unfulfilled y no archivadas de Wix (paginado)
    let allWixOrders = [];
    let cursor = null;
    let page = 0;

    do {
      page++;
      const body = {
        filter: {
          $and: [
            { fulfillmentStatus: { $eq: 'NOT_FULFILLED' } },
            { archived: { $eq: false } },
          ]
        },
        cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
      };

      const response = await fetch('https://www.wixapis.com/ecom/v1/orders/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WIX_API_KEY,
          'wix-site-id': WIX_SITE_ID,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Wix API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const orders = data.orders || [];
      allWixOrders = allWixOrders.concat(orders);
      cursor = data.metadata?.cursors?.next || null;

      console.log(`Página ${page}: ${orders.length} órdenes traídas (total: ${allWixOrders.length})`);
    } while (cursor && allWixOrders.length < 2000); // límite de seguridad

    // Log de todos los status únicos que llegaron
    const allStatuses = [...new Set(allWixOrders.map(o => o.fulfillmentStatus))];
    console.log('STATUSES EN WIX:', JSON.stringify(allStatuses));

    // Doble chequeo: filtrar del lado del servidor por si Wix no aplicó bien el filtro
    allWixOrders = allWixOrders.filter(o =>
      o.fulfillmentStatus === 'NOT_FULFILLED' && !o.archived
    );

    console.log(`Total órdenes unfulfilled no archivadas: ${allWixOrders.length}`);

    // Leer órdenes ya existentes en el Sheet para no duplicar
    const existing = await readOrders();
    const existingWixIds = new Set(existing.map(o => o.wix));
    console.log(`Órdenes ya en el Sheet: ${existingWixIds.size}`);

    // Importar las que no existen
    let imported = 0, skipped = 0, errors = 0;
    const results = [];

    for (const wixOrder of allWixOrders) {
      try {
        const order = parseWixOrder(wixOrder);

        if (existingWixIds.has(order.wix)) {
          skipped++;
          results.push({ wix: order.wix, status: 'skipped' });
          continue;
        }

        await appendOrder(order);
        existingWixIds.add(order.wix);
        imported++;
        results.push({ wix: order.wix, name: order.name, status: 'imported' });

        // Pausa para no saturar Sheets API
        await new Promise(r => setTimeout(r, 300));

      } catch (err) {
        errors++;
        results.push({ wix: wixOrder.number, status: 'error', error: err.message });
        console.error('Error importando orden:', wixOrder.number, err.message);
      }
    }

    return res.status(200).json({
      ok: true,
      summary: { total: allWixOrders.length, imported, skipped, errors },
      results,
    });

  } catch (err) {
    console.error('Error en importación Wix:', err);
    return res.status(500).json({ error: 'Error importando desde Wix', detail: err.message });
  }
}

// ── PARSE WIX ORDER (mismo que webhook.js) ───────────────────
function parseWixOrder(wix) {
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
  const items = lineItems.map(item => ({
    p: item.itemName || item.productName?.original || item.name || 'Unknown product',
    q: item.quantity || 1,
  }));

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

  // Notes
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
    id: Date.now() + Math.floor(Math.random() * 10000),
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
    notes,
    items,
    total,
    edited: false,
    editedBy: '',
    createdAt: wix.createdDate || new Date().toISOString(),
  };
}

const { requireAuth } = require('./_auth');
