// server.js

require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const cron = require('node-cron');
const fetch = require('node-fetch');

// ─── CONFIG ───────────────────────────────────
const PORT               = process.env.PORT       || 3000;
const JWT_SECRET         = process.env.JWT_SECRET;
const ADMIN_KEY          = process.env.ADMIN_KEY;
const DATA_FILE          = process.env.DATA_FILE  || './entries.json';
const FULLNODE_URL       = 'https://fullnode.mainnet.sui.io:443';
const DECIMALS           = 10 ** 6;               // RAF has 6 decimals
const TOKENS_PER_TICKET  = 1_000_000;             // 1,000,000 RAF per ticket
const MICROS_PER_TICKET  = TOKENS_PER_TICKET * DECIMALS; // = 1e12 microunits

// ─── GRAPHQL INDEXER ─────────────────────────
// Replace with your Sui indexer GraphQL endpoint:
const GRAPHQL_URL = process.env.SUI_INDEXER_GRAPHQL || 'https://indexer.example.com/graphql';
const RAF_TYPE    = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';

if (!JWT_SECRET || !ADMIN_KEY) {
  console.error('❌ Missing JWT_SECRET or ADMIN_KEY in .env');
  process.exit(1);
}

// ─── STORAGE HELPERS ─────────────────────────
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [], lastWinner: null }, null, 2));
}
function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function saveData(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ─── EXPRESS SETUP ────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ─── AUTH HELPERS ────────────────────────────
function isValidSuiAddress(addr) {
  return typeof addr === 'string' && /^0x[a-fA-F0-9]{64}$/.test(addr);
}
function normalizeSuiAddress(addr) {
  return addr.trim().toLowerCase();
}
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── GRAPHQL FETCH ───────────────────────────
async function fetchRafHolders() {
  const query = `
    query {
      rafBalances: coinBalances(
        where: { coinType: "${RAF_TYPE}", totalBalance_gt: "0" }
      ) {
        ownerAddress
        totalBalance
      }
    }
  `;
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = await resp.json();
  return json.data.rafBalances; // [{ ownerAddress, totalBalance }, ...]
}

// ─── AUTO‐ENTER HOLDERS ──────────────────────
async function autoEnterHolders() {
  const holders = await fetchRafHolders();
  const entries = holders.map(h => {
    const raw       = Number(h.totalBalance);
    const tickets   = Math.floor(raw / MICROS_PER_TICKET);
    return { address: normalizeSuiAddress(h.ownerAddress), count: tickets };
  }).filter(e => e.count > 0);

  // overwrite entries for this round
  const db = loadData();
  db.entries = entries;
  saveData(db);
}

// ─── ROUTES ──────────────────────────────────

// 1) Issue JWT
app.post('/api/auth', (req, res) => {
  const { address } = req.body;
  if (!address || !isValidSuiAddress(address)) {
    return res.status(400).json({ error: 'Invalid Sui address' });
  }
  const token = jwt.sign(
    { address: normalizeSuiAddress(address) },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  res.json({ token });
});

// 2) Proxy balance RPC
app.post('/api/balance', authenticate, async (req, res) => {
  const address = req.user.address;
  try {
    const rpcRes = await fetch(FULLNODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'suix_getAllBalances',
        params: [ address ],
      }),
    });
    const jr = await rpcRes.json();
    res.json(jr);
  } catch (err) {
    console.error('Balance proxy error:', err);
    res.status(502).json({ error: 'Fullnode RPC failed' });
  }
});

// 3) (Deprecated) Manual entry route (you can disable or keep)
app.post('/api/enter', authenticate, (req, res) => {
  const { address: bodyAddr, count } = req.body;
  const addr = req.user.address;
  if (bodyAddr !== addr) return res.status(400).json({ error: 'Address mismatch' });
  if (!Number.isInteger(count) || count < 1)
    return res.status(400).json({ error: 'Invalid ticket count' });

  const db = loadData();
  if (db.entries.find(e => e.address === addr))
    return res.status(400).json({ error: 'Already entered this round' });

  db.entries.push({ address: addr, count });
  saveData({ entries: db.entries, lastWinner: db.lastWinner });
  res.json({ success: true, total: db.entries.reduce((s,e) => s + e.count, 0) });
});

// 4) List entries
app.get('/api/entries', (req, res) => {
  const db = loadData();
  res.json({ entries: db.entries });
});

// 5) Get last winner
app.get('/api/last-winner', (req, res) => {
  const db = loadData();
  res.json({ lastWinner: db.lastWinner });
});

// 6) Draw a winner (auto‐enters holders first)
app.post('/api/draw', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // refresh entries from RAF holders
  await autoEnterHolders();

  const db = loadData();
  const valid = db.entries.filter(e => e.count > 0);
  if (valid.length === 0) {
    return res.status(400).json({ error: 'No entries this round' });
  }

  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner = weighted[Math.floor(Math.random() * weighted.length)];

  saveData({ entries: [], lastWinner: winner });
  res.json({ winner });
});

// 7) Cron auto‐draw hourly 18–23 (auto‐enters holders)
cron.schedule('0 18-23 * * *', async () => {
  try {
    await autoEnterHolders();
    const db = loadData();
    const valid = db.entries.filter(e => e.count > 0);
    if (!valid.length) return;

    const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
    const winner = weighted[Math.floor(Math.random() * weighted.length)];
    console.log('🏆 Auto‐draw winner:', winner);
    saveData({ entries: [], lastWinner: winner });
  } catch (err) {
    console.error('Cron auto‐draw error:', err);
  }
});

// ─── STATIC FILES & ERROR HANDLER ──────────
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START SERVER ───────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
