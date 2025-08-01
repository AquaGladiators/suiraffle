// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // ─── CONFIG ────────────────────────────────
  const DECIMALS          = 10 ** 6;
  const TOKENS_PER_TICKET = 1_000_000;
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS;
  let jwtToken            = null;
  let currentWinner       = null;
  let currentUser         = null;

  // ─── UI REFS ───────────────────────────────
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

  // (loadEntries, loadLastWinner, getNextDraw, startCountdown go here, unchanged, except loadLastWinner should call showWinner on load)

  // ─── AUTHENTICATION & BALANCE ─────────────
  authBtn.addEventListener('click', async () => {
    const address = addrInput.value.trim();
    validationMsg.textContent = '';

    // 1) Get JWT
    let res = await fetch('/api/auth', {
      method: 'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ address })
    });
    const authData = await res.json();
    if (!authData.token) {
      validationMsg.textContent = authData.error;
      return;
    }
    jwtToken = authData.token;
    currentUser = address;
    authBtn.textContent = 'Authenticated';
    authBtn.disabled = true;

    // 2) Fetch & display balance (your existing logic)
    // …
  });

  // ─── DRAW WINNER ───────────────────────────
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
      // also update history etc.
    } else {
      validationMsg.textContent = o.error;
    }
  });

  // ─── INITIALIZE ───────────────────────────
  // Load last winner on start
  loadLastWinner();

  // Poll entries and winner
  setInterval(loadEntries, 60_000);
  setInterval(loadLastWinner, 60_000);
  loadEntries();
  startCountdown();
});
