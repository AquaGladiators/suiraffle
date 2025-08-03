// public/twitter.js

// Ensure the Twitter widgets library is ready
window.twttr = window.twttr || {};
window.twttr.ready = window.twttr.ready || function(f){ f(); };

window.twttr.ready(() => {
  const container = document.getElementById('twitter-embed');
  if (!container) return;

  // Clear any old embeds
  container.innerHTML = '';

  // Build the one-tweet timeline anchor
  const anchor = document.createElement('a');
  anchor.setAttribute('href', 'https://twitter.com/sui_raffle');
  anchor.setAttribute('class', 'twitter-timeline');
  anchor.setAttribute('data-tweet-limit', '1');
  anchor.setAttribute('data-chrome', 'noheader nofooter noborders transparent');
  anchor.textContent = 'Tweets by @sui_raffle';

  container.appendChild(anchor);

  // Tell Twitter’s widgets.js to render inside our container
  window.twttr.widgets.load(container);
});
