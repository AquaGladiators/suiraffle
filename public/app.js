// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  // ─── CONFIG ────────────────────────────────
  const DECIMALS          = 10 ** 6;
  const TOKENS_PER_TICKET = 1_000_000;
  const MICROS_PER_TICKET = TOKENS_PER_TICKET * DECIMALS;
  let jwtToken            = null;
  let currentWinner       = null;
  let currentUserAddress  = null;

  // ─── UI REFS ───────────────────────────────
  const addrInput      = document.getElementById('addressInput');
  const authBtn        = document.getElementById('authBtn');
  const enterBtn       = document.getElementById('enterBtn');
  const drawBtn        = document.getElementById('drawBtn');
  const withdrawBtn    = document.getElementById('withdrawBtn');
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
    winnerBanner.textContent = `🎉 Winner: ${addr}!`;
    winnerBanner.classList.remove('hidden');
  }
  function hideWinner() {
    winnerBanner.classList.add('hidden');
  }
  function maybeShowWithdraw() {
    if (currentUserAddress && currentWinner === currentUserAddress) {
      withdrawBtn.classList.remove('hidden');
    } else {
      withdrawBtn.classList.add('hidden');
    }
  }

  // (other helpers: loadEntries, loadLastWinner, getNextDraw, startCountdown) unchanged…

  // ─── AUTH & BALANCE ─────────────────────────
  authBtn.addEventListener('click', async () => {
    const address = addrInput.value.trim();
    validationMsg.textContent = '';
    // Issue JWT
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
    currentUserAddress = address;
    authBtn.textContent = 'Authenticated';
    authBtn.disabled = true;

    // (fetch balance…)
  });

  // ─── DRAW & WITHDRAW ────────────────────────
  drawBtn.addEventListener('click', async () => {
    const key = prompt('Admin Key');
    const res = await fetch('/api/draw', {
      method: 'POST',
      headers: {
        'x-admin-key': key
      }
    });
    const o = await res.json();
    if (o.winner) {
      currentWinner = o.winner;
      showWinner(o.winner);
      maybeShowWithdraw();
      // (confetti, update history…)
    } else {
      validationMsg.textContent = o.error;
    }
  });

  // ─── INITIALIZE ─────────────────────────────
  // Show last winner on load
  loadLastWinner().then(() => {
    maybeShowWithdraw();
  });
  // Polling
  setInterval(loadEntries, 60_000);
  setInterval(loadLastWinner, 60_000);
  loadEntries();
  startCountdown();
});
