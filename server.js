// server.js

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const bodyParser = require('body-parser');
const cors       = require('cors');
const fs         = require('fs');
const cron       = require('node-cron');
const fetch      = require('node-fetch').default;

// ─── CONFIG ───────────────────────────────────
const PORT      = process.env.PORT      || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DATA_FILE = process.env.DATA_FILE || './entries.json';

// Blast’s GraphQL endpoint
const GRAPHQL_URL       = 'https://sui-mainnet.blastapi.io/5ddd79fb-2df9-47ec-9d94-b82198bd6f67';

const DECIMALS          = 10 ** 6;
const MICROS_PER_TICKET = 1_000_000 * DECIMALS;
const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';

if (!ADMIN_KEY) {
  console.error('❌ Missing ADMIN_KEY in .env');
  process.exit(1);
}

// ─── STORAGE HELPERS ─────────────────────────
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [], lastWinner: null }, null, 2));
}
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { entries: [], lastWinner: null };
  }
}
function saveData(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ─── EXPRESS SETUP ────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── GRAPHQL HOLDER FETCH ────────────────────
async function fetchRafHolders() {
  const query = `
    query {
      coin_balances(
        limit: 1000,
        where: {
          coin_type: { _eq: "${RAF_TYPE}" },
          total_balance: { _gt: "0" }
        }
      ) {
        owner_address
        total_balance
      }
    }`;

  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const { data } = await resp.json();
  if (!data || !Array.isArray(data.coin_balances)) {
    console.error('Invalid GraphQL response:', data);
    throw new Error('Invalid GraphQL response shape');
  }

  return data.coin_balances
    .map(c => ({
      address: c.owner_address.toLowerCase(),
      count:   Math.floor(Number(c.total_balance) / MICROS_PER_TICKET),
    }))
    .filter(e => e.count > 0);
}

// ─── ROUTES ──────────────────────────────────

// List live entries
app.get('/api/entries', async (_req, res) => {
  try {
    const entries = await fetchRafHolders();
    // cache to disk
    const db = loadData();
    saveData({ entries, lastWinner: db.lastWinner });
    return res.json({ entries });
  } catch (err) {
    console.warn('GraphQL failed, falling back to disk:', err);
    const { entries } = loadData();
    return res.json({ entries });
  }
});

// Get last winner
app.get('/api/last-winner', (_req, res) => {
  const { lastWinner } = loadData();
  res.json({ lastWinner });
});

// Manual draw (admin only)
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  fetchRafHolders()
    .catch(err => {
      console.warn('Draw fetch failed, using disk:', err);
      return loadData().entries;
    })
    .then(entries => {
      const valid = entries.filter(e => e.count > 0);
      if (!valid.length) return res.status(400).json({ error: 'No entries' });
      const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
      const winner   = weighted[Math.floor(Math.random() * weighted.length)];
      saveData({ entries: [], lastWinner: winner });
      res.json({ winner });
    });
});

// Auto-draw cron 18:00–23:00
cron.schedule('0 18-23 * * *', async () => {
  let entries;
  try { entries = await fetchRafHolders(); }
  catch { entries = loadData().entries; }
  const valid = entries.filter(e => e.count > 0);
  if (!valid.length) return;
  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner   = weighted[Math.floor(Math.random() * weighted.length)];
  console.log('🏆 Auto draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Running on http://localhost:${PORT}`);
});
