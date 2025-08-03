require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const cron = require('node-cron');
const fetch = require('node-fetch').default;

const {
  PORT = 3000,
  JWT_SECRET,
  ADMIN_KEY,
  FULLNODE_URL
} = process.env;

const DATA_FILE = path.join(__dirname, 'entries.json');
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [], lastWinner: null }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1) Auth endpoint
app.post('/api/auth', (req, res) => {
  const { address } = req.body;
  if (!/^0x[a-fA-F0-9]{64}$/.test(address)) {
    return res.json({ error: 'Invalid address' });
  }
  const token = jwt.sign({ address }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// 2) Balance proxy
app.post('/api/balance', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = auth.slice(7);
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  fetch(FULLNODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getAllBalances',
      params: [req.body.address]
    })
  })
    .then(r => r.json())
    .then(json => res.json(json))
    .catch(err => {
      console.error('Balance proxy error:', err);
      res.status(500).json({ error: 'RPC proxy failed' });
    });
});

// 3) Enter raffle
app.post('/api/enter', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { address, count } = req.body;
  const db = loadData();
  if (db.entries.find(e => e.address === address)) {
    return res.json({ error: 'Already entered' });
  }
  db.entries.push({ address, count });
  saveData(db);
  res.json({ success: true });
});

// 4) List entries
app.get('/api/entries', (req, res) => {
  const db = loadData();
  res.json({ entries: db.entries });
});

// 5) Last winner
app.get('/api/last-winner', (req, res) => {
  const db = loadData();
  res.json({ lastWinner: db.lastWinner });
});

// 6) Manual draw
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Bad admin key' });
  }
  const db = loadData();
  const valid = db.entries.filter(e => e.count > 0);
  if (!valid.length) {
    return res.json({ error: 'No entries' });
  }
  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  console.log('🏆 Manual draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
  res.json({ winner });
});

// 7) Auto-draw every 2 hours from 09:00 through 21:00
cron.schedule('0 9-21/2 * * *', () => {
  const db = loadData();
  const valid = db.entries.filter(e => e.count > 0);
  if (!valid.length) return;
  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  console.log('🏆 Auto-draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
});

app.listen(PORT, () => {
  console.log(`SuiRaffle server listening on port ${PORT}`);
});
