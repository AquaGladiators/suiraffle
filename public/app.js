// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // ─── CONFIG ────────────────────────────────
  const DECIMALS          = 10 ** 6;
  const TOKENS_PER_TICKET = 1_000_000;
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS;

  let currentWinner = null;

  // ─── UI REFS ───────────────────────────────
  const entriesSection = document.getElementById('entriesSection');
  const entriesList    = document.getElementById('entriesList');
  const countEl        = document.getElementById('count');
  const drawBtn        = document.getElementById('drawBtn');
  const winnerBanner   = document.getElementById('winnerAnnouncement');
  const countdownEl    = document.getElementById('countdown');
  const validationMsg  = document.getElementById('validationMsg');

  // ─── HELPERS ───────────────────────────────
  function showWinner(addr) {
    currentWinner = addr;
    winnerBanner.textContent = `🎉 Winner: ${addr}!`;
    winnerBanner.classList.remove('hidden');
  }

  function hideWinner() {
    winnerBanner.classList.add('hidden');
  }

  async function loadEntries() {
    entriesList.innerHTML = '';
    try {
      const res = await fetch('/api/entries');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const { entries } = await res.json();
      let total = 0;
      entriesList.innerHTML = entries.map((e,i) => {
        total += e.count;
        return `<li>${i+1}. ${e.address} — ${e.count} tickets</li>`;
      }).join('');
      countEl.textContent = `Total Tickets: ${total}`;
    } catch (err) {
      console.error('Entries load failed:', err);
      entriesList.innerHTML = `<li class="text-red-500">Failed to load entries.</li>`;
      countEl.textContent    = `Total Tickets: —`;
    } finally {
      entriesSection.classList.remove('hidden');
    }
  }

  async function loadLastWinner() {
    try {
      const res = await fetch('/api/last-winner');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const { lastWinner } = await res.json();
      if (lastWinner && lastWinner !== currentWinner) {
        showWinner(lastWinner);
      }
    } catch (err) {
      console.error('Last-winner load failed:', err);
    }
  }

  function getNextDraw() {
    const now = new Date();
    return [18,19,20,21,22,23]
      .map(h => { const d = new Date(now); d.setHours(h,0,0,0); if (d<=now) d.setDate(d.getDate()+1); return d; })
      .reduce((a,b) => a<b?a:b);
  }

  function startCountdown() {
    function tick() {
      const diff = getNextDraw() - Date.now();
      if (diff <= 0) { loadEntries(); return; }
      const h = String(Math.floor(diff/3600000)).padStart(2,'0');
      const m = String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
      const s = String(Math.floor((diff%60000)/1000)).padStart(2,'0');
      countdownEl.textContent = `Next draw in: ${h}:${m}:${s}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── DRAW BUTTON ───────────────────────────
  drawBtn.addEventListener('click', async () => {
    validationMsg.textContent = '';
    const key = prompt('Admin Key');
    if (!key) return;
    try {
      const res = await fetch('/api/draw', {
        method: 'POST',
        headers: { 'x-admin-key': key }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Status ${res.status}`);
      }
      const { winner } = await res.json();
      showWinner(winner);
    } catch (err) {
      console.error('Draw failed:', err);
      validationMsg.textContent = `Draw error: ${err.message}`;
    }
  });

  // ─── INITIALIZE ─────────────────────────────
  hideWinner();
  loadEntries();
  loadLastWinner();
  startCountdown();
  setInterval(loadEntries,    60000);
  setInterval(loadLastWinner, 60000);
});
