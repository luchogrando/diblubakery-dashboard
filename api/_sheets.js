// api/_sheets.js — Google Sheets via REST API (no dependencies needed)

const SHEET_ID = process.env.SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// ── JWT AUTH ─────────────────────────────────────────────────────
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(payload)}`;

  // Sign with RS256 using Web Crypto API (available in Vercel Edge/Node)
  const keyData = PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const binaryKey = Buffer.from(keyData, 'base64');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(signingInput)
  );

  const jwt = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── SHEET OPERATIONS ─────────────────────────────────────────────
async function sheetsGet(range) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Sheets GET failed: ' + await res.text());
  return res.json();
}

async function sheetsAppend(range, values) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error('Sheets APPEND failed: ' + await res.text());
  return res.json();
}

async function sheetsUpdate(range, values) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error('Sheets UPDATE failed: ' + await res.text());
  return res.json();
}

// ── PUBLIC API ───────────────────────────────────────────────────
async function readOrders() {
  const data = await sheetsGet('Orders!A2:Q');
  const rows = data.values || [];
  return rows.map(rowToOrder).filter(o => o.id);
}

async function appendOrder(order) {
  await sheetsAppend('Orders!A:Q', [orderToRow(order)]);
}

async function updateOrder(id, fields) {
  const data = await sheetsGet('Orders!A:Q');
  const rows = data.values || [];
  const rowIndex = rows.findIndex(r => String(r[0]) === String(id));
  if (rowIndex < 0) throw new Error('Order not found: ' + id);
  const order = rowToOrder(rows[rowIndex]);
  const updated = { ...order, ...fields };
  const sheetRow = rowIndex + 1;
  await sheetsUpdate(`Orders!A${sheetRow}:Q${sheetRow}`, [orderToRow(updated)]);
  return updated;
}

// ── ROW CONVERSION ───────────────────────────────────────────────
function rowToOrder(r) {
  return {
    id:          r[0]  || '',
    wix:         r[1]  || '',
    name:        r[2]  || '',
    phone:       r[3]  || '',
    date:        r[4]  || null,
    shift:       r[5]  || 'morning',
    type:        r[6]  || 'pickup',
    fulfillment: r[7]  || 'unfulfilled',
    delivery:    r[8]  || 'pending',
    customDate:  r[9]  === 'true' || r[9]  === true,
    recurring:   r[10] === 'true' || r[10] === true,
    notes:       r[11] || '',
    items:       safeJSON(r[12], []),
    edited:      r[13] === 'true' || r[13] === true,
    editedBy:    r[14] || '',
    createdAt:   r[15] || '',
    total:       r[16] ? parseFloat(r[16]) : null,
  };
}

function orderToRow(o) {
  return [
    String(o.id || ''),
    String(o.wix || ''),
    String(o.name || ''),
    String(o.phone || ''),
    String(o.date || ''),
    String(o.shift || 'morning'),
    String(o.type || 'pickup'),
    String(o.fulfillment || 'unfulfilled'),
    String(o.delivery || 'pending'),
    o.customDate ? 'TRUE' : 'FALSE',
    o.recurring ? 'TRUE' : 'FALSE',
    String(o.notes || ''),
    JSON.stringify(o.items || []),
    o.edited ? 'TRUE' : 'FALSE',
    String(o.editedBy || ''),
    String(o.createdAt || new Date().toISOString()),
    o.total != null ? String(o.total) : '',
  ];
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── PRODUCTS & PRESENTATIONS ─────────────────────────────────
// Products tab: columns A=key, B=name
// Presentations tab: columns A=name, B=price, C=units_json (e.g. {"medialuna":12})

async function readProducts() {
  try {
    const data = await sheetsGet('Products!A2:B');
    const rows = data.values || [];
    const result = {};
    rows.forEach(r => { if (r[0] && r[1]) result[r[0]] = { name: r[1] }; });
    return result;
  } catch(e) { return null; }
}

async function writeProducts(products) {
  const values = Object.entries(products).map(([key, val]) => [key, val.name || key]);
  // clear and rewrite
  const token = await getAccessToken();
  // clear first
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Products!A2:B')}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (values.length > 0) {
    await sheetsAppend('Products!A:B', values);
  }
}

async function readPresentations() {
  try {
    const data = await sheetsGet('Presentations!A2:B');
    const rows = data.values || [];
    const result = {};
    rows.forEach(r => {
      if (!r[0]) return;
      let u = {};
      try { u = JSON.parse(r[1] || '{}'); } catch(e) {}
      result[r[0]] = { u };
    });
    return result;
  } catch(e) { return null; }
}

async function writePresentations(prods) {
  const values = Object.entries(prods).map(([name, val]) => [
    name,
    JSON.stringify(val.u || {})
  ]);
  const token = await getAccessToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Presentations!A2:B')}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (values.length > 0) {
    await sheetsAppend('Presentations!A:B', values);
  }
}

module.exports = { readOrders, appendOrder, updateOrder, readProducts, writeProducts, readPresentations, writePresentations };
