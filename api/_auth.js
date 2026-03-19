// api/_auth.js — shared token validation
// Reads users from Sheet, falls back to USERS env var

const { readUsers } = require('./_sheets');

async function isValidToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [username, password] = decoded.split(':');
    if (!username || !password) return null;

    // Try Sheet first
    let users = await readUsers();
    if (!users || users.length === 0) {
      users = parseUsersEnv(process.env.USERS || '');
    }
    const match = users.find(u => u.username === username && u.password === password);
    return match || null;
  } catch { return null; }
}

async function requireAuth(token) {
  const user = await isValidToken(token);
  return user; // null if invalid
}

function parseUsersEnv(envStr) {
  return envStr.split(',').map(u => {
    const parts = u.trim().split(':');
    return { username: parts[0]||'', password: parts[1]||'', role: parts[2]||'team', displayName: parts.slice(3).join(':')||parts[0]||'' };
  }).filter(u => u.username);
}

module.exports = { isValidToken, requireAuth };
