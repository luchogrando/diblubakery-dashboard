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
    customDate:  r[9]  === '1' || r[9]  === 1,
    recurring:   r[10] === '1' || r[10] === 1,
    notes:       r[11] || '',
    items:       safeJSON(r[12], []),
    edited:      r[13] === '1' || r[13] === 1,
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
    o.customDate ? '1' : '0',
    o.recurring ? '1' : '0',
    String(o.notes || ''),
    JSON.stringify(o.items || []),
    o.edited ? '1' : '0',
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


// ── TASKS ────────────────────────────────────────────────────
// Tasks tab: A=id, B=date, C=title, D=createdBy, E=done, F=doneBy, G=comment

async function readTasks() {
  try {
    const data = await sheetsGet('Tasks!A2:G');
    const rows = data.values || [];
    return rows.filter(r => r[0]).map(r => ({
      id: parseInt(r[0]) || 0,
      date: r[1] || '',
      title: r[2] || '',
      createdBy: r[3] || '',
      done: r[4] === '1' || r[4] === 1,
      doneBy: r[5] || '',
      comment: r[6] || '',
    }));
  } catch(e) { return []; }
}

async function writeTasks(tasks) {
  const token = await getAccessToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Tasks!A2:G')}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (tasks.length > 0) {
    const values = tasks.map(t => [
      String(t.id),
      t.date || '',
      t.title || '',
      t.createdBy || '',
      t.done ? '1' : '0',
      t.doneBy || '',
      t.comment || '',
    ]);
    await sheetsAppend('Tasks!A:G', values);
  }
}

// ── RECURRING ORDERS ─────────────────────────────────────────
// Recurring tab: A=id, B=name, C=phone, D=shift, E=type, F=items_json, G=day, H=notes

async function readRecurring() {
  try {
    const data = await sheetsGet('Recurring!A2:J');
    const rows = data.values || [];
    return rows.filter(r => r[0]).map(r => {
      let items = [];
      try { items = JSON.parse(r[5] || '[]'); } catch(e) {}
      return {
        id: parseInt(r[0]) || 0,
        name: r[1] || '',
        phone: r[2] || '',
        shift: r[3] || 'morning',
        type: r[4] || 'pickup',
        items,
        dayOfWeek: parseInt(r[6]) || 0,
        notes: r[7] || '',
        active: r[8] === '1' || r[8] === 1,
        activatedDates: (function(){ try{ return JSON.parse(r[9]||'[]'); }catch(e){ return []; } })(),
      };
    });
  } catch(e) { return []; }
}

async function writeRecurring(recurring) {
  const token = await getAccessToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Recurring!A2:J')}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (recurring.length > 0) {
    const values = recurring.map(r => [
      String(r.id),
      r.name || '',
      r.phone || '',
      r.shift || 'morning',
      r.type || 'pickup',
      JSON.stringify(r.items || []),
      r.dayOfWeek !== undefined ? String(r.dayOfWeek) : '0',
      r.notes || '',
      r.active !== false ? '1' : '0',
      JSON.stringify(r.activatedDates || []),
    ]);
    await sheetsAppend('Recurring!A:J', values);
  }
}


// ── USERS ─────────────────────────────────────────────────────
// Users tab: A=username, B=password, C=role, D=displayName

async function readUsers() {
  try {
    const data = await sheetsGet('Users!A2:D');
    const rows = data.values || [];
    return rows.filter(r => r[0]).map(r => ({
      username:    r[0] || '',
      password:    r[1] || '',
      role:        r[2] || 'team',
      displayName: r[3] || r[0] || '',
    }));
  } catch(e) { return []; }
}

async function writeUsers(users) {
  const token = await getAccessToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Users!A2:D')}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (users.length > 0) {
    const values = users.map(u => [
      u.username || '',
      u.password || '',
      u.role || 'team',
      u.displayName || u.username || '',
    ]);
    await sheetsAppend('Users!A:D', values);
  }
}


// ── SETTINGS ─────────────────────────────────────────────────
// Settings tab: A=key, B=value
// Keys: reminder_msg, feedback_msg

async function readSettings() {
  try {
    const data = await sheetsGet('Messages!A2:B');
    const rows = data.values || [];
    const result = {};
    rows.forEach(r => { if (r[0]) result[r[0]] = r[1] || ''; });
    return result;
  } catch(e) { return {}; }
}

async function writeSettings(settings) {
  // Read existing settings first, then merge
  const existing = await readSettings();
  const merged = { ...existing, ...settings };
  const token = await getAccessToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Messages!A2:B')}:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const values = Object.entries(merged).map(([k, v]) => [k, v]);
  if (values.length > 0) {
    await sheetsUpdate('Messages!A2:B', values);
  }
}

module.exports = { readOrders, appendOrder, updateOrder, readProducts, writeProducts, readPresentations, writePresentations, readTasks, writeTasks, readRecurring, writeRecurring, readUsers, writeUsers, readSettings, writeSettings };
