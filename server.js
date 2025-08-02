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
const FULLNODE_URL       = 'https://fullnode.mainnet.sui.io:443';
const GRAPHQL_URL        = process.env.SUI_INDEXER_GRAPHQL;
const DECIMALS           = 10 ** 6;
const TOKENS_PER_TICKET  = 1_000_000;
const MICROS_PER_TICKET  = TOKENS_PER_TICKET * DECIMALS;
const RAF_TYPE           = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';

if (!JWT_SECRET || !ADMIN_KEY || !GRAPHQL_URL) {
  console.error('❌ Missing JWT_SECRET, ADMIN_KEY, or SUI_INDEXER_GRAPHQL in .env');
  process.exit(1);
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
    allBalances(
      filter: {
        coinType: { eq: "${RAF_TYPE}" },
        totalBalance: { gt: "0" }
      }
    ) {
      edges {
        node {
          ownerAddress
          totalBalance
        }
      }
    }
  }`;
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json();
  if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors));
  const edges = json.data?.allBalances?.edges;
  if (!Array.isArray(edges)) throw new Error('Unexpected GraphQL shape');
  return edges.map(e => ({
    address: normalizeSuiAddress(e.node.ownerAddress),
    count: Math.floor(Number(e.node.totalBalance) / MICROS_PER_TICKET)
  })).filter(e => e.count > 0);
}

// ─── ROUTES ──────────────────────────────────

// 1) Issue JWT
app.post('/api/auth', (req, res) => {
  const { address } = req.body;
  if (!address || !isValidSuiAddress(address))
    return res.status(400).json({ error: 'Invalid Sui address' });
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
      })
    });
    res.json(await rpcRes.json());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Fullnode RPC failed' });
  }
});

// 3) List entries — always fresh from chain
app.get('/api/entries', async (req, res) => {
  try {
    const entries = await fetchRafHolders();
    res.json({ entries });
  } catch (err) {
    console.error('Failed fetching holders:', err);
    res.status(500).json({ error: 'Could not fetch holders' });
  }
});

// 4) Last winner
app.get('/api/last-winner', (req, res) => {
  let lastWinner = null;
  try {
    lastWinner = JSON.parse(fs.readFileSync('./entries.json','utf8')).lastWinner;
  } catch {}
  res.json({ lastWinner });
});

// 5) Manual draw — draws from the same fresh list
app.post('/api/draw', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY)
    return res.status(403).json({ error: 'Forbidden' });
  try {
    const entries = await fetchRafHolders();
    if (!entries.length) return res.status(400).json({ error: 'No entries this round' });
    const weighted = entries.flatMap(e => Array(e.count).fill(e.address));
    const winner = weighted[Math.floor(Math.random()*weighted.length)];
    // persist lastWinner
    fs.writeFileSync('./entries.json', JSON.stringify({ entries: [], lastWinner: winner }, null, 2));
    res.json({ winner });
  } catch (err) {
    console.error('Manual draw failed:', err);
    res.status(502).json({ error: 'Manual draw failed' });
  }
});

// 6) Cron auto‐draw hourly 18–23
cron.schedule('0 18-23 * * *', async () => {
  try {
    const entries = await fetchRafHolders();
    if (!entries.length) return;
    const weighted = entries.flatMap(e => Array(e.count).fill(e.address));
    const winner = weighted[Math.floor(Math.random()*weighted.length)];
    fs.writeFileSync('./entries.json', JSON.stringify({ entries: [], lastWinner: winner }, null, 2));
    console.log('🏆 Auto draw winner:', winner);
  } catch (err) {
    console.error('Cron draw failed:', err);
  }
});

// ─── STATIC & ERROR HANDLER ─────────────────
app.use(express.static(path.join(__dirname,'public')));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START SERVER ───────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
