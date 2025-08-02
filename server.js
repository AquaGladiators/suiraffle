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
const GRAPHQL_URL = process.env.SUI_INDEXER_GRAPHQL || 'https://graphql-rpc.mainnet.sui.io/graphql';

if (!ADMIN_KEY) {
  console.error('❌ Missing ADMIN_KEY in environment');
  process.exit(1);
}

// ─── Sui & RAF constants ──────────────────────
const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';
const DECIMALS          = 10 ** 6;
const TOKENS_PER_TICKET = 1_000_000;
const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS;

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
  const holders = new Map();
  let after = null;

  while (true) {
    const query = `
      query raf($after: String) {
        coinBalances(
          first: 1000,
          after: $after,
          filter: {
            coinType: { equalTo: "${RAF_TYPE}" },
            totalBalance: { greaterThan: "0" }
          }
        ) {
          pageInfo { hasNextPage endCursor }
          nodes { ownerAddress totalBalance }
        }
      }
    `;
    const resp = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { after } }),
    });
    const { data, errors } = await resp.json();
    if (errors) {
      console.error('GraphQL errors:', errors);
      throw new Error('GraphQL error');
    }
    const page = data?.coinBalances;
    if (!page?.nodes) {
      console.error('Unexpected GraphQL response shape:', data);
      throw new Error('Invalid GraphQL response shape');
    }

    // tally
    for (const { ownerAddress, totalBalance } of page.nodes) {
      const addr = ownerAddress.toLowerCase();
      const count = Math.floor(Number(totalBalance) / MICROS_PER_TICKET);
      if (count > 0) {
        holders.set(addr, (holders.get(addr) || 0) + count);
      }
    }

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return Array.from(holders.entries()).map(([address, count]) => ({ address, count }));
}

// ─── ROUTES ──────────────────────────────────

// GET /api/entries — fetch live holders, fallback to disk
app.get('/api/entries', async (_req, res) => {
  try {
    const entries = await fetchRafHolders();
    const { lastWinner } = loadData();
    saveData({ entries, lastWinner });
    return res.json({ entries });
  } catch (err) {
    console.warn('GraphQL fetch failed, falling back to disk:', err);
    const { entries } = loadData();
    return res.json({ entries });
  }
});

// GET /api/last-winner
app.get('/api/last-winner', (_req, res) => {
  const { lastWinner } = loadData();
  res.json({ lastWinner });
});

// POST /api/draw — manual draw (admin only)
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  fetchRafHolders()
    .catch(err => {
      console.warn('Draw fetch failed, falling back to disk:', err);
      return loadData().entries;
    })
    .then(entries => {
      const valid = entries.filter(e => e.count > 0);
      if (!valid.length) {
        return res.status(400).json({ error: 'No entries this round' });
      }
      const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
      const winner = weighted[Math.floor(Math.random() * weighted.length)];
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
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  console.log('🏆 Auto-draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
