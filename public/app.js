// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // ─── CONFIG ────────────────────────────────
  const DECIMALS          = 10 ** 6;             // RAF has 6 decimals
  const TOKENS_PER_TICKET = 1_000_000;           // 1,000,000 RAF per ticket
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS; // = 1e12 microunits

  let jwtToken      = null;
  let currentUser   = null;
  let currentWinner = null;

  // ─── UI REFERENCES ─────────────────────────
  const addrInput      = document.getElementById('addressInput');
  const authBtn        = document.getElementById('authBtn');
  const enterBtn       = document.getElementById('enterBtn');
  const drawBtn        = document.getElementById('drawBtn');
  const buyBtn         = document.getElementById('buyBtn');
  const validationMsg  = document.getElementById('validationMsg');
  const balanceMsg     = document.getElementById('balanceMsg');
  const entryCountMsg  = document.getElementById('entryCountMsg');
  const balanceSection = document.getElementById('balanceSection');
  const entriesSection = document.getElementById('entriesSection');
  const countEl        = document.getElementById('count');
  const entriesList    = document.getElementById('entriesList');
  const winnersList    = document.getElementById('winnersList');
  const winnerBanner   = document.getElementById('winnerAnnouncement');
  const countdownEl    = document.getElementById('countdown');

  // ─── HELPERS ───────────────────────────────
  function showWinner(addr) {
    currentWinner = addr;
    winnerBanner.textContent = `🎉 Winner: ${addr}!`;
    winnerBanner.classList.remove('hidden');
    maybeShowBuy();
  }

  function hideWinner() {
    winnerBanner.classList.add('hidden');
    buyBtn.classList.add('hidden');
  }

  function maybeShowBuy() {
    if (currentUser && currentWinner === currentUser) {
      buyBtn.classList.remove('hidden');
    } else {
      buyBtn.classList.add('hidden');
    }
  }

  async function loadEntries() {
    try {
      const res = await fetch('/api/entries');
      const { entries } = await res.json();
      let total = 0;
      entriesList.innerHTML = entries.map((e,i) => {
        total += e.count;
        return `<li>${i+1}. ${e.address} — ${e.count} tickets</li>`;
      }).join('');
      countEl.textContent = `Total Tickets: ${total}`;
      entriesSection.classList.remove('hidden');
    } catch (err) {
      console.error('Error loading entries:', err);
    }
  }

  async function loadLastWinner() {
    try {
      const res = await fetch('/api/last-winner');
      const { lastWinner } = await res.json();
      if (lastWinner && lastWinner !== currentWinner) {
        showWinner(lastWinner);
      }
    } catch (err) {
      console.error('Error loading last winner:', err);
    }
  }

  function getNextDraw() {
    const now = new Date();
    return [18,19,20,21,22,23]
      .map(h => {
        const d = new Date(now);
        d.setHours(h,0,0,0);
        if (d <= now) d.setDate(d.getDate() + 1);
        return d;
      })
      .reduce((a,b) => a < b ? a : b);
  }

  function startCountdown() {
    function update() {
      const diff = getNextDraw() - Date.now();
      if (diff <= 0) {
        loadEntries();
        return;
      }
      const h = String(Math.floor(diff/3600000)).padStart(2,'0');
      const m = String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
      const s = String(Math.floor((diff%60000)/1000)).padStart(2,'0');
      countdownEl.textContent = `Next draw in: ${h}:${m}:${s}`;
    }
    update();
    setInterval(update, 1000);
  }

  // ─── EVENT LISTENERS ─────────────────────────
  addrInput.addEventListener('input', () => {
    validationMsg.textContent = '';
    authBtn.disabled = !/^0x[a-fA-F0-9]{64}$/.test(addrInput.value.trim());
    balanceSection.classList.add('hidden');
    entriesSection.classList.add('hidden');
    hideWinner();
  });

  authBtn.addEventListener('click', async () => {
    const address = addrInput.value.trim();
    validationMsg.textContent = '';

    // 1) Authenticate
    let res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ address })
    });
    const authData = await res.json();
    if (!authData.token) {
      validationMsg.textContent = authData.error;
      return;
    }
    jwtToken    = authData.token;
    currentUser = address;
    authBtn.textContent = 'Authenticated';
    authBtn.disabled    = true;

    // 2) Fetch balance
    balanceMsg.textContent = '⏳ Fetching balance…';
    res = await fetch('/api/balance', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + jwtToken
      }
    });
    const jr = await res.json();
    const arr = Array.isArray(jr.result) ? jr.result : [];
    const raf  = arr.find(c => c.coinType.toLowerCase().includes('::raf::raf'));
    const raw  = raf ? Number(raf.totalBalance) : 0;

    const human  = raw / DECIMALS;
    balanceMsg.textContent = `💰 ${human.toLocaleString()} RAF`;
    const tickets = Math.floor(raw / MICROS_PER_TICKET);
    entryCountMsg.textContent = tickets > 0
      ? `🎟️ ${tickets.toLocaleString()} tickets`
      : `❌ Need ≥ ${TOKENS_PER_TICKET.toLocaleString()} RAF`;
    enterBtn.dataset.count = tickets;
    enterBtn.disabled      = tickets === 0;
    balanceSection.classList.remove('hidden');
  });

  enterBtn.addEventListener('click', async () => {
    const count = +enterBtn.dataset.count || 0;
    if (!count) return;
    const address = currentUser;
    const res = await fetch('/api/enter', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + jwtToken
      },
      body: JSON.stringify({ address, count })
    });
    const data = await res.json();
    if (res.ok) loadEntries();
    else validationMsg.textContent = data.error;
  });

  drawBtn.addEventListener('click', async () => {
    const key = prompt('Admin Key');
    const res = await fetch('/api/draw', {
      method: 'POST',
      headers: { 'x-admin-key': key }
    });
    const o = await res.json();
    if (o.winner) {
      confetti({ particleCount:200, spread:60 });
      showWinner(o.winner);
    } else {
      validationMsg.textContent = o.error;
    }
  });

  // ─── INITIALIZE ─────────────────────────────
  loadEntries();
  loadLastWinner();
  startCountdown();
  setInterval(loadEntries,     60000);
  setInterval(loadLastWinner,  60000);
});
