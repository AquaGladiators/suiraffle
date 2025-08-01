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
  const DECIMALS          = 10 ** 6;             // RAF has 6 decimals
  const TOKENS_PER_TICKET = 1_000_000;           // 1,000,000 RAF per ticket
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS; // = 1e12 microunits
  const RAF_TYPE          = '0x0eb83b809fe19e7bf41fda5750bf1c770bd015d0428ece1d37c95e69d62bbf96::raf::RAF';
  let jwtToken            = null;
  let currentWinner       = null;

  // ─── UI ELEMENTS ─────────────────────────────
  const addrInput      = document.getElementById('addressInput');
  const authBtn        = document.getElementById('authBtn');
  const enterBtn       = document.getElementById('enterBtn');
  const drawBtn        = document.getElementById('drawBtn');
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

  // ─── HELPERS ─────────────────────────────────
  function showWinner(addr) {
    winnerBanner.textContent = `🎉 Winner: ${addr}!`;
    winnerBanner.classList.remove('hidden');
  }
  function hideWinner() {
    winnerBanner.classList.add('hidden');
  }
  function saveWinner(addr) {
    const wins = JSON.parse(localStorage.getItem('winners') || '[]');
    wins.unshift(addr);
    localStorage.setItem('winners', JSON.stringify(wins.slice(0,5)));
  }
  function updateLastWinners() {
    const wins = JSON.parse(localStorage.getItem('winners') || '[]').slice(0,5);
    winnersList.innerHTML = wins.map((w,i) => `<li>${i+1}. ${w}</li>`).join('');
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

  function getNextDraw() {
    const now = new Date();
    const hours = [18,19,20,21,22,23];
    return hours
      .map(h => {
        const d = new Date(now);
        d.setHours(h,0,0,0);
        if (d <= now) d.setDate(d.getDate()+1);
        return d;
      })
      .reduce((a,b) => a < b ? a : b);
  }
  function startCountdown() {
    function update() {
      const next = getNextDraw();
      const diff = next - Date.now();
      if (diff <= 0) {
        loadEntries();
        return;
      }
      const hrs  = String(Math.floor(diff/3600000)).padStart(2,'0');
      const mins = String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
      const secs = String(Math.floor((diff%60000)/1000)).padStart(2,'0');
      countdownEl.textContent = `Next draw in: ${hrs}:${mins}:${secs}`;
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

    // 1) Get JWT
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
    jwtToken = authData.token;
    authBtn.textContent = 'Authenticated';
    authBtn.disabled = true;

    // Debug logs
    console.log('👉 token:', jwtToken);

    // 2) Fetch balance via proxy
    balanceMsg.textContent = '⏳ Fetching balance…';
    res = await fetch('/api/balance', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + jwtToken
      }
    });
    console.log('💬 /api/balance status:', res.status);
    const jr = await res.json();
    console.log('💬 /api/balance body:', jr);

    // 3) Compute tickets
    const arr  = Array.isArray(jr.result) ? jr.result : [];
    const coin = arr.find(c => c.coinType === RAF_TYPE);
    const raw  = coin ? Number(coin.totalBalance) : 0;

    // 4) Update UI
    const human = raw / DECIMALS;
    balanceMsg.textContent = `💰 ${human.toLocaleString()} RAF`;
    const tickets = Math.floor(raw / MICROS_PER_TICKET);
    entryCountMsg.textContent = tickets > 0
      ? `🎟️ ${tickets.toLocaleString()} tickets`
      : `❌ Need ≥ ${TOKENS_PER_TICKET.toLocaleString()} RAF`;
    enterBtn.dataset.count = tickets;
    enterBtn.disabled = tickets === 0;
    balanceSection.classList.remove('hidden');
  });

  enterBtn.addEventListener('click', async () => {
    const count = +enterBtn.dataset.count || 0;
    if (!count) return;
    const address = addrInput.value.trim();
    const res = await fetch('/api/enter', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + jwtToken
      },
      body: JSON.stringify({ address, count })
    });
    const d = await res.json();
    if (res.ok) loadEntries();
    else validationMsg.textContent = d.error;
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
      saveWinner(o.winner);
      updateLastWinners();
    } else {
      validationMsg.textContent = o.error;
    }
  });

  // ─── POLLING & INIT ─────────────────────────
  setInterval(loadEntries, 60_000);
  loadEntries();
  updateLastWinners();
  startCountdown();
});
