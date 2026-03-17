// api/_sheets.js — shared Google Sheets authentication helper
const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID;

function getAuth() {
  const credentials = {
    type: 'service_account',
    project_id: 'diblubakery',
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheet() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, sheetId: SHEET_ID };
}

// Read all orders from the Sheet
async function readOrders() {
  const { sheets, sheetId } = await getSheet();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A2:Q',
  });
  const rows = res.data.values || [];
  return rows.map(rowToOrder).filter(o => o.id);
}

// Append a new order row
async function appendOrder(order) {
  const { sheets, sheetId } = await getSheet();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:Q',
    valueInputOption: 'RAW',
    requestBody: { values: [orderToRow(order)] },
  });
}

// Update a specific order by id (finds the row and updates it)
async function updateOrder(id, fields) {
  const { sheets, sheetId } = await getSheet();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:Q',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === String(id));
  if (rowIndex < 0) throw new Error('Order not found: ' + id);

  const row = rows[rowIndex];
  const order = rowToOrder(row);
  const updated = { ...order, ...fields };
  const sheetRow = rowIndex + 1; // 1-indexed, row 1 is headers

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Sheet1!A${sheetRow}:Q${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [orderToRow(updated)] },
  });
  return updated;
}

// ── ROW ↔ ORDER CONVERSION ──────────────────────────────────────
// Columns: id | wix_order | name | phone | date | shift | type |
//          fulfillment | delivery | custom_date | recurring |
//          notes | items | edited | edited_by | created_at | total

function rowToOrder(r) {
  return {
    id:           r[0]  || '',
    wix:          r[1]  || '',
    name:         r[2]  || '',
    phone:        r[3]  || '',
    date:         r[4]  || null,
    shift:        r[5]  || 'morning',
    type:         r[6]  || 'pickup',
    fulfillment:  r[7]  || 'unfulfilled',
    delivery:     r[8]  || 'pending',
    customDate:   r[9]  === 'true',
    recurring:    r[10] === 'true',
    notes:        r[11] || '',
    items:        safeParseJSON(r[12], []),
    edited:       r[13] === 'true',
    editedBy:     r[14] || '',
    createdAt:    r[15] || '',
    total:        r[16] ? parseFloat(r[16]) : null,
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
    String(o.customDate ? 'true' : 'false'),
    String(o.recurring ? 'true' : 'false'),
    String(o.notes || ''),
    JSON.stringify(o.items || []),
    String(o.edited ? 'true' : 'false'),
    String(o.editedBy || ''),
    String(o.createdAt || new Date().toISOString()),
    o.total != null ? String(o.total) : '',
  ];
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { readOrders, appendOrder, updateOrder };
