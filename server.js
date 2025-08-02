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
const PORT              = process.env.PORT      || 3000;
const ADMIN_KEY         = process.env.ADMIN_KEY;
const DATA_FILE         = process.env.DATA_FILE || './entries.json';

// Your Blast GraphQL endpoint:
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
          coinType: { _eq: "${RAF_TYPE}" },
          totalBalance: { _gt: "0" }
        }
      ) {
        ownerAddress
        totalBalance
      }
      coinBalances: coinBalances(
        limit: 1000,
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

  // pick whichever array exists
  const raw = Array.isArray(json.data.coin_balances)
    ? json.data.coin_balances
    : Array.isArray(json.data.coinBalances)
      ? json.data.coinBalances
      : null;

  if (!raw) {
    console.error('Unexpected GraphQL response shape:', json);
    throw new Error('Invalid GraphQL response shape');
  }

  return raw
    .map(c => ({
      address: c.ownerAddress.toLowerCase(),
      count:   Math.floor(Number(c.totalBalance) / MICROS_PER_TICKET)
    }))
    .filter(e => e.count > 0);
}

// ─── ROUTES ──────────────────────────────────

// GET /api/entries — live holders
app.get('/api/entries', async (_req, res) => {
  try {
    const entries = await fetchRafHolders();
    // save to disk as cache
    const db = loadData();
    saveData({ entries, lastWinner: db.lastWinner });
    return res.json({ entries });
  } catch (err) {
    console.error('Blast fetch failed, falling back to disk:', err);
    const { entries } = loadData();
    return res.json({ entries });
  }
});

// GET /api/last-winner
app.get('/api/last-winner', (_req, res) => {
  const { lastWinner } = loadData();
  res.json({ lastWinner });
});

// POST /api/draw — manual draw with admin key
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  fetchRafHolders()
    .catch(err => {
      console.error('Fetch on draw failed, using disk:', err);
      return loadData().entries;
    })
    .then(entries => {
      const valid = entries.filter(e => e.count > 0);
      if (!valid.length) {
        return res.status(400).json({ error: 'No entries this round' });
      }
      const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
      const winner   = weighted[Math.floor(Math.random() * weighted.length)];
      saveData({ entries: [], lastWinner: winner });
      res.json({ winner });
    });
});

// Cron auto-draw hourly 18–23
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
  const winner   = weighted[Math.floor(Math.random() * weighted.length)];
  console.log('🏆 Auto-draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
