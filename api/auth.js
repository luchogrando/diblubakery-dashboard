// api/auth.js — POST /api/auth
// Validates username/password and returns a token + user info
// Users are stored in USERS env var: "username:password:role:displayName"

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const users = parseUsers(process.env.USERS || '');
  const match = users.find(
    u => u.username === username.toLowerCase().trim() && u.password === password
  );

  if (!match) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }

  // Token = base64(username:password) — simple, stateless
  const token = Buffer.from(`${match.username}:${match.password}`).toString('base64');

  return res.status(200).json({
    token,
    user: {
      username: match.username,
      role: match.role,
      displayName: match.displayName,
    },
  });
};

function parseUsers(envStr) {
  // Format: "username:password:role:Display Name,user2:pass2:team:Name Two"
  return envStr.split(',').map(u => {
    const parts = u.trim().split(':');
    return {
      username:    parts[0] || '',
      password:    parts[1] || '',
      role:        parts[2] || 'team',
      displayName: parts.slice(3).join(':') || parts[0] || '',
    };
  }).filter(u => u.username);
}
