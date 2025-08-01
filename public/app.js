// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // ─── PARTICLES ────────────────────────────────
  if (window.tsParticles) {
    tsParticles.load('tsparticles', {
      fpsLimit: 60,
      particles: {
        number: { value: 80 },
        color: { value: ['#ff0080', '#00ffff'] },
        links: { enable: true, opacity: 0.2, distance: 150 },
        move: { enable: true, speed: 1, outModes: 'bounce' },
        opacity: { value: 0.5 },
        size: { value: { min: 1, max: 3 } },
      },
    });
  }

  // ─── CONFIG ───────────────────────────────────
  const DECIMALS          = 10 ** 6;                                   // RAF has 6 decimals
  const TOKENS_PER_TICKET = 1_000_000;                                 // 1,000,000 RAF per ticket
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS;              // = 1e12 microunits
  const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';
  let jwtToken            = null;
  let currentWinner       = null;

  // ─── UI REFERENCES ────────────────────────────
  const addr         = document.getElementById('addressInput');
  const authBtn      = document.getElementById('authBtn');
  const enterBtn     = document.getElementById('enterBtn');
  const drawBtn      = document.getElementById('drawBtn');
  const valMsg       = document.getElementById('validationMsg');
  const balMsg       = document.getElementById('balanceMsg');
  const entMsg       = document.getElementById('entryCountMsg');
  const balSec       = document.getElementById('balanceSection');
  const entSec       = document.getElementById('entriesSection');
  const countEl      = document.getElementById('count');
  const entriesList  = document.getElementById('entriesList');
  const winnersList  = document.getElementById('winnersList');
  const banner       = document.getElementById('winnerAnnouncement');
  const countdown    = document.getElementById('countdown');

  // ─── HELPER FUNCTIONS ─────────────────────────
  function showWinner(address) {
    banner.textContent = `🎉 Winner: ${address}!`;
    banner.classList.remove('hidden');
  }

  function hideWinner() {
    banner.classList.add('hidden');
  }

  function saveWin(address) {
    const wins = JSON.parse(localStorage.getItem('winners') || '[]');
    wins.unshift(address);
    localStorage.setItem('winners', JSON.stringify(wins.slice(0, 5)));
  }

  function updateWins() {
    const wins = JSON.parse(localStorage.getItem('winners') || '[]').slice(0,5);
    winnersList.innerHTML = wins.map((a,i) => `<li>${i+1}. ${a}</li>`).join('');
  }

  async function loadEntries() {
    const res = await fetch('/api/entries');
    const { entries } = await res.json();
    let total = 0;
    entriesList.innerHTML = entries.map((e,i) => {
      total += e.count;
      return `<li>${i+1}. ${e.address} — ${e.count} tickets</li>`;
    }).join('');
    countEl.textContent = `Total Tickets: ${total}`;
    entSec.classList.remove('hidden');
  }

  async function loadLastWinner() {
    const res = await fetch('/api/last-winner');
    const { lastWinner } = await res.json();
    if (lastWinner && lastWinner !== currentWinner) {
      currentWinner = lastWinner;
      showWinner(lastWinner);
    }
  }

  function getNextDraw() {
    const now = new Date();
    const hours = [18,19,20,21,22,23];
    const next = hours
      .map(h => {
        const d = new Date(now);
        d.setHours(h,0,0,0);
        if (d <= now) d.setDate(d.getDate() + 1);
        return d;
      })
      .reduce((a,b) => a < b ? a : b);
    return next;
  }

  function startCountdown() {
    setInterval(() => {
      const diff = getNextDraw() - Date.now();
      if (diff <= 0) {
        loadEntries();
        return;
      }
      const h = String(Math.floor(diff / 3600000)).padStart(2,'0');
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2,'0');
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2,'0');
      countdown.textContent = `Next draw in: ${h}:${m}:${s}`;
    }, 1000);
  }

  // ─── EVENT LISTENERS ──────────────────────────
  addr.addEventListener('input', () => {
    valMsg.textContent = '';
    authBtn.disabled = !/^0x[a-fA-F0-9]{64}$/.test(addr.value.trim());
    balSec.classList.add('hidden');
    entSec.classList.add('hidden');
    hideWinner();
  });

  authBtn.addEventListener('click', async () => {
    const address = addr.value.trim();
    valMsg.textContent = '';

    // Authenticate and get token
    let res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ address })
    });
    const authData = await res.json();
    if (!authData.token) {
      valMsg.textContent = authData.error;
      return;
    }
    jwtToken = authData.token;
    authBtn.textContent = 'Authenticated';
    authBtn.disabled = true;

    // Fetch balance via proxy endpoint
    balMsg.textContent = '⏳ Fetching balance…';
    res = await fetch('/api/balance', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': 'Bearer ' + jwtToken
      }
    });
    const jr = await res.json();
    const arr = Array.isArray(jr.result) ? jr.result : [];
    const coin = arr.find(c => c.coinType === RAF_TYPE);
    const raw  = coin ? Number(coin.totalBalance) : 0;

    // Update balance UI
    const human = raw / DECIMALS;
    balMsg.textContent = `💰 ${human.toLocaleString()} RAF`;
    const tickets = Math.floor(raw / MICROS_PER_TICKET);
    entMsg.textContent = tickets > 0
      ? `🎟️ ${tickets.toLocaleString()} tickets`
      : `❌ Need ≥ ${TOKENS_PER_TICKET.toLocaleString()} RAF`;
    enterBtn.dataset.count = tickets;
    enterBtn.disabled = tickets === 0;
    balSec.classList.remove('hidden');
  });

  enterBtn.addEventListener('click', async () => {
    const count = +enterBtn.dataset.count;
    if (!count) return;
    const address = addr.value.trim();
    const res = await fetch('/api/enter', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': 'Bearer ' + jwtToken
      },
      body: JSON.stringify({ address, count })
    });
    const data = await res.json();
    if (res.ok) loadEntries();
    else valMsg.textContent = data.error;
  });

  drawBtn.addEventListener('click', async () => {
    const key = prompt('Admin Key');
    const res = await fetch('/api/draw', {
      method: 'POST',
      headers: { 'x-admin-key': key }
    });
    const result = await res.json();
    if (result.winner) {
      confetti({ particleCount:200, spread:60 });
      showWinner(result.winner);
      saveWin(result.winner);
      updateWins();
    } else {
      valMsg.textContent = result.error;
    }
  });

  // ─── INITIALIZE ──────────────────────────────
  setInterval(loadEntries, 60000);
  setInterval(loadLastWinner, 60000);
  loadEntries();
  updateWins();
  loadLastWinner();
  startCountdown();
});
