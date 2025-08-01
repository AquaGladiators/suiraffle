// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // 1) Background particles
  if (window.tsParticles) {
    tsParticles.load('tsparticles', {
      fpsLimit: 60,
      particles: {
        number: { value: 80 },
        color: { value: ['#ff0080', '#00ffff'] },
        links: { enable: true, color: '#ffffff', opacity: 0.2, distance: 150 },
        move: { enable: true, speed: 1, outModes: 'bounce' },
        opacity: { value: 0.5 },
        size: { value: { min: 1, max: 3 } },
      },
    });
  }

  // 2) Config
  const FULLNODE_URL     = 'https://fullnode.mainnet.sui.io:443';
  const DECIMALS         = 1e6;          // SEWEY has 6 decimals
  const TOKENS_PER_TICKET = 1_000_000;   // 1,000,000 SEWEY = 1 ticket
  let jwtToken;

  // 3) UI elements
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

  // 4) Helper functions
  function showWinner(addr) {
    winnerBanner.textContent = `🎉 Winner: ${addr}! You win ${TOKENS_PER_TICKET.toLocaleString()} SEWEY! 🎉`;
    winnerBanner.classList.remove('hidden');
  }
  function hideWinner() {
    winnerBanner.classList.add('hidden');
  }
  function saveWinner(addr) {
    const wins = JSON.parse(localStorage.getItem('winners') || '[]');
    wins.unshift(addr);
    localStorage.setItem('winners', JSON.stringify(wins.slice(0, 5)));
  }
  function updateLastWinners() {
    const wins = JSON.parse(localStorage.getItem('winners') || '[]').slice(0, 5);
    winnersList.innerHTML = wins.map((w, i) => `<li>${i+1}. ${w}</li>`).join('');
  }
  async function loadEntries() {
    try {
      const res = await fetch('/api/entries');
      const db  = await res.json();
      let total = 0;
      entriesList.innerHTML = db.entries.map((e, i) => {
        total += e.count;
        return `<li>${i+1}. ${e.address} — ${e.count} tickets</li>`;
      }).join('');
      countEl.textContent = 'Total Tickets: ' + total;
      entriesSection.classList.remove('hidden');
    } catch (err) {
      console.error('Error loading entries:', err);
    }
  }

  // 5) Countdown to next draw
  function getNextDraw() {
    const now = new Date();
    const hours = [6, 18];
    const nextDates = hours.map(h => {
      const d = new Date(now);
      d.setHours(h, 0, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d;
    });
    return nextDates.reduce((a, b) => (a < b ? a : b));
  }
  function startCountdown() {
    function update() {
      const next = getNextDraw();
      const diff = next - Date.now();
      if (diff <= 0) {
        loadEntries();
        hideWinner();
        return;
      }
      const hrs  = String(Math.floor(diff / 3600000)).padStart(2, '0');
      const mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
      const secs = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
      countdownEl.textContent = `Next draw in: ${hrs}:${mins}:${secs}`;
    }
    update();
    setInterval(update, 1000);
  }

  // 6) Event listeners
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
    try {
      // Get JWT
      let res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ address })
      });
      const dataA = await res.json();
      if (!dataA.token) return validationMsg.textContent = dataA.error;
      jwtToken = dataA.token;
      authBtn.textContent = 'Authenticated';
      authBtn.disabled = true;

      // Fetch balance
      balanceMsg.textContent = '⏳ Fetching balances…';
      res = await fetch(FULLNODE_URL, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getAllBalances',
          params: [address]
        })
      });
      const jr = await res.json();
      const arr = Array.isArray(jr.result) ? jr.result : [];
      const coin = arr.find(c => c.coinType.includes('sewey'));
      const raw   = coin ? Number(coin.totalBalance) : 0;
      const human = raw / DECIMALS;
      balanceMsg.textContent = `💰 ${human.toLocaleString()} SEWEY`;

      // Compute tickets
      const tickets = Math.floor(human / (TOKENS_PER_TICKET / DECIMALS));
      entryCountMsg.textContent = tickets > 0
        ? `🎟️ ${tickets.toLocaleString()} tickets`
        : `❌ Need ≥ ${(TOKENS_PER_TICKET/DECIMALS).toLocaleString()} SEWEY`;
      enterBtn.dataset.count = tickets;
      enterBtn.disabled = tickets === 0;
      balanceSection.classList.remove('hidden');

    } catch (err) {
      console.error(err);
      validationMsg.textContent = '⚠️ Error fetching balance';
    }
  });

  enterBtn.addEventListener('click', async () => {
    const count = +enterBtn.dataset.count || 0;
    if (!count) return;
    const address = addrInput.value.trim();
    try {
      const res = await fetch('/api/enter', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Authorization':'Bearer ' + jwtToken
        },
        body: JSON.stringify({ address, count })
      });
      const d = await res.json();
      if (d.success) loadEntries();
      else validationMsg.textContent = d.error;
    } catch (err) {
      console.error(err);
      validationMsg.textContent = '⚠️ Error entering raffle';
    }
  });

  drawBtn.addEventListener('click', async () => {
    const key = prompt('Admin Key');
    try {
      const res = await fetch('/api/draw', {
        method: 'POST',
        headers: { 'x-admin-key': key }
      });
      const o = await res.json();
      if (o.winner) {
        confetti({ particleCount: 200, spread: 60 });
        showWinner(o.winner);
        saveWinner(o.winner);
        updateLastWinners();
      } else {
        validationMsg.textContent = o.error;
      }
    } catch (err) {
      console.error(err);
      validationMsg.textContent = '⚠️ Error drawing winner';
    }
  });

  // 7) Poll every minute for real-time updates
  setInterval(loadEntries, 60_000);

  // 8) Kick things off
  loadEntries();
  updateLastWinners();
  startCountdown();
});
