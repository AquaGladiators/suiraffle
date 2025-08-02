require('dotenv').config();
const express = require('express');
const path    = require('path');
const bodyParser = require('body-parser');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const cron    = require('node-cron');
const fetch   = require('node-fetch');

// ─── CONFIG ───────────────────────────────────
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_KEY  = process.env.ADMIN_KEY;
const DATA_FILE  = process.env.DATA_FILE || './entries.json';
const GRAPHQL_URL = process.env.SUI_INDEXER_GRAPHQL || 'https://graphql-beta.mainnet.sui.io';

// ─── VALIDATION ──────────────────────────────
if (!JWT_SECRET || !ADMIN_KEY) {
  console.error('❌ Missing JWT_SECRET or ADMIN_KEY in .env');
  process.exit(1);
}

// ─── Sui & RAF constants ──────────────────────
const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';
const DECIMALS          = 10 ** 6;           // RAF has 6 decimals
const TOKENS_PER_TICKET = 1_000_000;         // 1,000,000 RAF per ticket
const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS; // = 1e12

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

// ─── GRAPHQL HOLDER FETCH ────────────────────
async function fetchRafHolders() {
  const holders = new Map();
  let cursor = null, hasNext = true;

  while (hasNext) {
    const query = `
      query ($cursor: String) {
        coins(type: "${RAF_TYPE}", first: 1000, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              owner { address }
            }
          }
        }
      }
    `;
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { cursor } })
    });
    const json = await res.json();
    if (!json.data || !json.data.coins) {
      throw new Error('Invalid GraphQL response shape');
    }

    const { edges, pageInfo } = json.data.coins;
    for (const { node } of edges) {
      const addr = node.owner.address.toLowerCase();
      holders.set(addr, (holders.get(addr) || 0) + 1);
    }
    hasNext = pageInfo.hasNextPage;
    cursor  = pageInfo.endCursor;
  }

  // Convert to array of { address, count }
  return Array.from(holders.entries()).map(([address, count]) => ({ address, count }));
}

// ─── EXPRESS SETUP ────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── JWT MIDDLEWARE & UTILITIES ──────────────
function isValidSuiAddress(a) {
  return /^0x[a-fA-F0-9]{64}$/.test(a);
}
function normalize(a) {
  return a.trim().toLowerCase();
}
function authenticate(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── ROUTES ──────────────────────────────────

// Force-refresh entries.json from chain
app.post('/api/refresh', async (req, res) => {
  try {
    const entries = await fetchRafHolders();
    const db = loadData();
    saveData({ entries, lastWinner: db.lastWinner });
    return res.json({ success: true, total: entries.length });
  } catch (err) {
    console.error('Blast fetch failed, falling back to disk:', err);
    return res.status(500).json({ error: 'Failed to fetch live holders' });
  }
});

// Issue JWT
app.post('/api/auth', (req, res) => {
  const { address } = req.body;
  if (!address || !isValidSuiAddress(address)) {
    return res.status(400).json({ error: 'Invalid Sui address' });
  }
  const token = jwt.sign({ address: normalize(address) }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// Enter raffle manually
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
  res.json({ success: true, total: db.entries.length });
});

// Get current entries (auto-loaded)
app.get('/api/entries', async (req, res) => {
  try {
    // Always show fresh on-chain holders if possible
    const entries = await fetchRafHolders();
    // Save to disk for fallback
    const db = loadData();
    saveData({ entries, lastWinner: db.lastWinner });
    res.json({ entries });
  } catch {
    const db = loadData();
    res.json({ entries: db.entries });
  }
});

// Get last winner
app.get('/api/last-winner', (req, res) => {
  const { lastWinner } = loadData();
  res.json({ lastWinner });
});

// Draw winner (manual)
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY)
    return res.status(403).json({ error: 'Forbidden' });

  const db = loadData();
  if (!db.entries.length) return res.status(400).json({ error: 'No entries to draw' });

  const weighted = [];
  db.entries.forEach(e => {
    for (let i = 0; i < e.count; i++) weighted.push(e.address);
  });
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  saveData({ entries: [], lastWinner: winner });
  res.json({ winner });
});

// Auto-draw & reset hourly 18-23
cron.schedule('0 18-23 * * *', async () => {
  try {
    const entries = await fetchRafHolders();
    if (!entries.length) return;
    // pick winner
    const weighted = [];
    entries.forEach(e => {
      for (let i = 0; i < e.count; i++) weighted.push(e.address);
    });
    const winner = weighted[Math.floor(Math.random() * weighted.length)];
    console.log('🏆 Auto draw winner:', winner);
    saveData({ entries: [], lastWinner: winner });
  } catch (err) {
    console.error('Auto-draw failed:', err);
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
