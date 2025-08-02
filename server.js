// server.js

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const bodyParser = require('body-parser');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const fs         = require('fs');
const cron       = require('node-cron');
const fetch      = require('node-fetch');

// ─── CONFIG ───────────────────────────────────
const PORT              = process.env.PORT      || 3000;
const JWT_SECRET        = process.env.JWT_SECRET;
const ADMIN_KEY         = process.env.ADMIN_KEY;
const DATA_FILE         = process.env.DATA_FILE || './entries.json';

// **Your Blast GraphQL endpoint hard-coded here:**
const GRAPHQL_URL       = 'https://sui-mainnet.blastapi.io/5ddd79fb-2df9-47ec-9d94-b82198bd6f67';

const FULLNODE_URL      = 'https://fullnode.mainnet.sui.io:443';
const DECIMALS          = 10 ** 6;
const MICROS_PER_TICKET = 1_000_000 * DECIMALS;
const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';

if (!JWT_SECRET || !ADMIN_KEY) {
  console.error('❌ Missing JWT_SECRET or ADMIN_KEY in .env');
  process.exit(1);
}

// ─── STORAGE HELPERS ─────────────────────────
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [], lastWinner: null }, null, 2));
}
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return { entries: [], lastWinner: null }; }
}
function saveData(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ─── EXPRESS SETUP ────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ─── GRAPHQL HOLDER FETCH ────────────────────
async function fetchRafHolders() {
  const query = `
    query {
      coinBalances(
        first: 1000,
        where: {
          coinType: "${RAF_TYPE}",
          totalBalance_gt: "0"
        }
      ) {
        ownerAddress
        totalBalance
      }
    }`;
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json();
  if (!json.data || !Array.isArray(json.data.coinBalances)) {
    throw new Error('Blast GraphQL returned unexpected data');
  }
  return json.data.coinBalances
    .map(c => ({
      address: c.ownerAddress.toLowerCase(),
      count:   Math.floor(Number(c.totalBalance) / MICROS_PER_TICKET)
    }))
    .filter(e => e.count > 0);
}

// ─── ROUTES ──────────────────────────────────

// 1) List entries — always live, no fallback
app.get('/api/entries', async (_req, res) => {
  try {
    const entries = await fetchRafHolders();
    return res.json({ entries });
  } catch (err) {
    console.error('Failed to fetch from Blast:', err);
    return res.status(500).json({ error: 'Could not fetch holders' });
  }
});

// 2) Get last winner
app.get('/api/last-winner', (_req, res) => {
  const { lastWinner } = loadData();
  res.json({ lastWinner });
});

// 3) Manual draw (admin only)
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // draw from the *latest* on-chain holders
  fetchRafHolders()
    .catch(err => {
      console.error('Blast failed on manual draw:', err);
      // fallback to disk if desired:
      return loadData().entries;
    })
    .then(entries => {
      const valid = entries.filter(e => e.count > 0);
      if (!valid.length) return res.status(400).json({ error: 'No entries this round' });

      const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
      const winner   = weighted[Math.floor(Math.random()*weighted.length)];
      saveData({ entries: [], lastWinner: winner });
      res.json({ winner });
    });
});

// 4) Cron auto-draw hourly 18–23
cron.schedule('0 18-23 * * *', async () => {
  let entries;
  try {
    entries = await fetchRafHolders();
  } catch {
    entries = loadData().entries;
  }
  const valid = entries.filter(e => e.count > 0);
  if (!valid.length) return;
  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner   = weighted[Math.floor(Math.random()*weighted.length)];
  console.log('🏆 Auto-draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
});

// ─── STATIC & ERROR HANDLER ─────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START SERVER ───────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
