// api/users.js — GET/POST /api/users
// Admin-only endpoint to manage team users

const { readUsers, writeUsers } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!isAdminToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const users = await readUsers();
      // Never return passwords to client
      return res.status(200).json({
        ok: true,
        users: users.map(u => ({ username: u.username, role: u.role, displayName: u.displayName }))
      });
    }

    if (req.method === 'POST') {
      const { users } = req.body || {};
      if (!Array.isArray(users)) return res.status(400).json({ error: 'users must be array' });
      await writeUsers(users);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    console.error('Users error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function isAdminToken(token) {
  // Verify token is valid and belongs to an admin
  try {
    const { readUsers } = require('./_sheets');
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [username, password] = decoded.split(':');
    const users = await readUsers();
    const match = users.find(u => u.username === username && u.password === password);
    return match && match.role === 'admin';
  } catch { return false; }
}
