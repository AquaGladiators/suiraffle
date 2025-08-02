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
const PORT              = process.env.PORT       || 3000;
const JWT_SECRET        = process.env.JWT_SECRET;
const ADMIN_KEY         = process.env.ADMIN_KEY;
const DATA_FILE         = process.env.DATA_FILE  || './entries.json';
const FULLNODE_URL      = 'https://fullnode.mainnet.sui.io:443';
const GRAPHQL_URL       = process.env.SUI_INDEXER_GRAPHQL;
const DECIMALS          = 10 ** 6;
const TOKENS_PER_TICKET = 1_000_000;
const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS;
const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';

if (!JWT_SECRET || !ADMIN_KEY || !GRAPHQL_URL) {
  console.error('❌ Missing JWT_SECRET, ADMIN_KEY, or SUI_INDEXER_GRAPHQL in .env');
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
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  if (!json.data || !Array.isArray(json.data.coinBalances)) {
    throw new Error('Unexpected GraphQL shape');
  }
  return json.data.coinBalances
    .map(c => ({
      address: normalizeSuiAddress(c.ownerAddress),
      count: Math.floor(Number(c.totalBalance) / MICROS_PER_TICKET)
    }))
    .filter(e => e.count > 0);
}

// ─── ROUTES ──────────────────────────────────

// 1) Issue JWT
app.post('/api/auth', (req, res) => {
  const { address } = req.body;
  if (!address || !isValidSuiAddress(address)) {
    return res.status(400).json({ error: 'Invalid Sui address' });
  }
  const token = jwt.sign({ address: normalizeSuiAddress(address) }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// 2) Proxy balance RPC
app.post('/api/balance', authenticate, async (req, res) => {
  try {
    const rpcRes = await fetch(FULLNODE_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        jsonrpc:'2.0', id:1,
        method:'suix_getAllBalances',
        params:[req.user.address]
      }),
    });
    return res.json(await rpcRes.json());
  } catch (err) {
    console.error('Balance proxy error:', err);
    return res.status(502).json({ error: 'Fullnode RPC failed' });
  }
});

// 3) List entries — live + fallback
app.get('/api/entries', async (_req, res) => {
  try {
    const entries = await fetchRafHolders();
    return res.json({ entries });
  } catch (err) {
    console.error('GraphQL failed, falling back to disk:', err);
    const { entries } = loadData();
    return res.json({ entries });
  }
});

// 4) Get last winner
app.get('/api/last-winner', (_req, res) => {
  const { lastWinner } = loadData();
  res.json({ lastWinner });
});

// 5) Manual draw — live + fallback
app.post('/api/draw', authenticate, async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let entries;
  try {
    entries = await fetchRafHolders();
  } catch (err) {
    console.error('GraphQL failed on manual draw, using disk:', err);
    entries = loadData().entries;
  }

  const valid = entries.filter(e => e.count > 0);
  if (!valid.length) {
    return res.status(400).json({ error: 'No entries this round' });
  }

  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner = weighted[Math.floor(Math.random()*weighted.length)];
  saveData({ entries: [], lastWinner: winner });
  res.json({ winner });
});

// 6) Cron auto-draw hourly 18–23
cron.schedule('0 18-23 * * *', async () => {
  let entries;
  try {
    entries = await fetchRafHolders();
  } catch (err) {
    console.error('GraphQL failed on cron, using disk:', err);
    entries = loadData().entries;
  }
  const valid = entries.filter(e => e.count > 0);
  if (!valid.length) return;
  const weighted = valid.flatMap(e => Array(e.count).fill(e.address));
  const winner = weighted[Math.floor(Math.random()*weighted.length)];
  console.log('🏆 Auto-draw winner:', winner);
  saveData({ entries: [], lastWinner: winner });
});

// ─── STATIC & ERROR HANDLER ─────────────────
app.use(express.static(path.join(__dirname,'public')));
app.use((err,_,res,_) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START SERVER ───────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
