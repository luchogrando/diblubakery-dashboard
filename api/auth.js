// api/auth.js — POST /api/auth
// Validates username/password — users stored in Sheet tab "Users"
// Falls back to USERS env var if Sheet is unavailable

const { readUsers } = require('./_sheets');

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

  try {
    // Try Sheet first
    let users = await readUsers();

    // Fallback to env var if Sheet is empty
    if (!users || users.length === 0) {
      console.log('No users in Sheet, falling back to USERS env var');
      users = parseUsersEnv(process.env.USERS || '');
    }

    const match = users.find(
      u => u.username === username.toLowerCase().trim() && u.password === password
    );

    if (!match) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    const token = Buffer.from(`${match.username}:${match.password}`).toString('base64');

    return res.status(200).json({
      token,
      user: {
        username: match.username,
        role: match.role,
        displayName: match.displayName,
      },
      // Send all users back (without passwords) so dashboard can build TEAM
      team: users.map(u => ({
        username: u.username,
        role: u.role,
        displayName: u.displayName,
      })),
    });

  } catch(err) {
    console.error('Auth error:', err);
    // Final fallback to env var
    const users = parseUsersEnv(process.env.USERS || '');
    const match = users.find(
      u => u.username === username.toLowerCase().trim() && u.password === password
    );
    if (!match) return res.status(401).json({ error: 'Incorrect username or password' });
    const token = Buffer.from(`${match.username}:${match.password}`).toString('base64');
    return res.status(200).json({
      token,
      user: { username: match.username, role: match.role, displayName: match.displayName },
      team: users.map(u => ({ username: u.username, role: u.role, displayName: u.displayName })),
    });
  }
};

function parseUsersEnv(envStr) {
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
