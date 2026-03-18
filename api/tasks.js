// api/tasks.js — GET /api/tasks and POST /api/tasks
const { readTasks, writeTasks } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!isValidToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const tasks = await readTasks();
      return res.status(200).json({ ok: true, tasks });
    }
    if (req.method === 'POST') {
      const { tasks } = req.body || {};
      if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks must be array' });
      await writeTasks(tasks);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    console.error('Tasks error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function isValidToken(token) {
  const users = (process.env.USERS || '').split(',');
  return users.some(u => {
    const [username, password] = u.trim().split(':');
    try { return Buffer.from(token, 'base64').toString('utf8') === `${username}:${password}`; }
    catch { return false; }
  });
}
