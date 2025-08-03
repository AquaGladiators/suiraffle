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
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS; // 1e12 microunits
  const DRAW_HOURS        = [9,11,13,15,17,19,21]; // every 2h from 9 to 21
  let jwtToken            = null;

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
    const wins = JSON.parse(localStorage.getItem('winners') || '[]');
    const list = document.getElementById('winnersList');
    list.innerHTML = wins.map((addr, idx) => {
      const display = addr.length > 8
        ? `${addr.slice(0,4)}…${addr.slice(-4)}`
        : addr;
      return `
        <li>
          ${idx+1}. ${display}
          <button class="copy-btn" data-addr="${addr}" aria-label="Copy address">📋</button>
        </li>
      `;
    }).join('');
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

  // ─── COPY BUTTON HANDLER ─────────────────────
  winnersList.addEventListener('click', e => {
    if (!e.target.matches('.copy-btn')) return;
    const full = e.target.dataset.addr;
    navigator.clipboard.writeText(full).then(() => {
      const orig = e.target.textContent;
      e.target.textContent = '✅';
      setTimeout(() => { e.target.textContent = orig; }, 1500);
    });
  });

  // ─── DRAW ENTRY & AUTH ───────────────────────
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
    const rafEntries = arr.filter(c => c.coinType.toLowerCase().includes('::raf::raf'));
    const raw  = rafEntries[0] ? Number(rafEntries[0].totalBalance) : 0;
    balanceMsg.textContent = `💰 ${(raw/DECIMALS).toLocaleString()} RAF`;
    const tickets = Math.floor(raw / MICROS_PER_TICKET);
    entryCountMsg.textContent = tickets > 0
      ? `🎟️ ${tickets.toLocaleString()} tickets`
      : `❌ Need ≥ ${TOKENS_PER_TICKET.toLocaleString()} RAF`;
    enterBtn.dataset.count = tickets;
    enterBtn.disabled = tickets === 0;
    balanceSection.classList.remove('hidden');
  });

  enterBtn.addEventListener('click', async () => {
    const count = +enterBtn.dataset.count;
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
    const res = await fetch('/api/draw', { method: 'POST', headers: { 'x-admin-key': key } });
    const o = await res.json();
    if (o.winner) {
      confetti({ particleCount:200, spread:60 });
      showWinner(o.winner);
      saveWinner(o.winner);
      updateLastWinners();
      loadEntries();
    } else {
      validationMsg.textContent = o.error;
    }
  });

  // ─── NEXT DRAW CALC & COUNTDOWN ─────────────
  function getNextDraw() {
    const now = new Date();
    return DRAW_HOURS.map(h => {
      const d = new Date(now);
      d.setHours(h,0,0,0);
      if (d <= now) d.setDate(d.getDate()+1);
      return d;
    }).reduce((a,b) => a < b ? a : b);
  }

  function startCountdown() {
    function update() {
      const diff = getNextDraw() - Date.now();
      if (diff <= 0) { loadEntries(); return; }
      const hrs  = String(Math.floor(diff/3600000)).padStart(2,'0');
      const mins = String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
      const secs = String(Math.floor((diff%60000)/1000)).padStart(2,'0');
      countdownEl.textContent = `Next draw in: ${hrs}:${mins}:${secs}`;
    }
    update();
    setInterval(update, 1000);
  }

  // ─── INIT ─────────────────────────────────────
  setInterval(loadEntries, 60000);
  loadEntries();
  updateLastWinners();
  startCountdown();

  // ─── LOAD LAST WINNER ON PAGE LOAD ───────────
  (async function loadLastWinner() {
    try {
      const res = await fetch('/api/last-winner');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const { lastWinner } = await res.json();
      if (lastWinner) showWinner(lastWinner);
    } catch (err) {
      console.error('Error loading last winner:', err);
    }
  })();

});
