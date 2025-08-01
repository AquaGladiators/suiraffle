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
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_KEY  = process.env.ADMIN_KEY;
const DATA_FILE  = process.env.DATA_FILE || './entries.json';

if (!JWT_SECRET || !ADMIN_KEY) {
  console.error('❌ Missing JWT_SECRET or ADMIN_KEY in .env');
  process.exit(1);
}

// Sui & RAF constants
const FULLNODE_URL       = 'https://fullnode.mainnet.sui.io:443';
const RAF_TYPE           = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';
const DECIMALS           = 10 ** 6;          // RAF has 6 decimals
const TOKENS_PER_TICKET  = 1_000_000;        // 1 000 000 RAF per ticket
const MICROS_PER_TICKET  = TOKENS_PER_TICKET * DECIMALS; // = 1e12 microunits

// ─── STORAGE HELPERS ─────────────────────────
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [] }, null, 2));
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
app.use(express.static(path.join(__dirname, 'public')));

// ─── UTILITIES ───────────────────────────────
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

// ─── ROUTES ──────────────────────────────────

// 1️⃣ Issue a JWT for a valid Sui address
app.post('/api/auth', (req, res) => {
  const { address } = req.body;
  if (!address || !isValidSuiAddress(address)) {
    return res.status(400).json({ error: 'Invalid Sui address' });
  }
  const token = jwt.sign({ address: normalizeSuiAddress(address) }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// 2️⃣ Enter the raffle with a given ticket count
app.post('/api/enter', authenticate, (req, res) => {
  const { address: bodyAddr, count } = req.body;
  const addr = req.user.address;
  if (bodyAddr !== addr) {
    return res.status(400).json({ error: 'Address mismatch' });
  }
  if (!Number.isInteger(count) || count < 1) {
    return res.status(400).json({ error: 'Invalid ticket count' });
  }

  const db = loadData();
  if (db.entries.find(e => e.address === addr)) {
    return res.status(400).json({ error: 'Already entered this round' });
  }

  db.entries.push({ address: addr, count });
  saveData(db);

  const totalTickets = db.entries.reduce((sum, e) => sum + e.count, 0);
  res.json({ success: true, total: totalTickets });
});

// 3️⃣ List entries
app.get('/api/entries', (req, res) => {
  // Return stored entry counts without recalculation
  const db = loadData();
  res.json({ entries: db.entries });
});

// 4️⃣ Draw a ticket-weighted winner and reset entries
app.post('/api/draw', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadData();
  if (db.entries.length === 0) {
    return res.status(400).json({ error: 'No entries this round' });
  }

  const weighted = [];
  db.entries.forEach(e => {
    for (let i = 0; i < e.count; i++) weighted.push(e.address);
  });
  const winner = weighted[Math.floor(Math.random() * weighted.length)];

  // Reset entries immediately after draw
  saveData({ entries: [] });

  res.json({ winner });
});

// 5️⃣ Auto-draw & reset every 12h at 06:00 & 18:00 starting 2025-08-01
cron.schedule('0 6,18 * * *', () => {
  if (new Date() < new Date('2025-08-01T06:00:00')) return;
  const db = loadData();
  if (!db.entries.length) return;

  const weighted = [];
  db.entries.forEach(e => {
    for (let i = 0; i < e.count; i++) weighted.push(e.address);
  });
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  console.log('🏆 Auto draw winner:', winner);

  saveData({ entries: [] });
});

// 6️⃣ Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ▶️ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
