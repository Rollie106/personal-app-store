// Personal App Store — card renderer.
// Reads apps.json (the registry) and draws one card per app into #app-grid.
// Two statuses are supported:
//   - "live"        → tappable link that opens /apps/{slug}/
//   - "coming-soon" → greyed-out, non-tappable placeholder
//
// To add a new app: edit apps.json. No JS change needed.

(async function loadStore() {
  const grid = document.getElementById('app-grid');

  // Fetch the registry. Cache-bust with a timestamp so edits show up
  // immediately when you push to main and refresh on your phone.
  let registry;
  try {
    const res = await fetch('/apps.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    registry = await res.json();
  } catch (err) {
    grid.innerHTML = '<li class="empty">Could not load apps.json — ' + err.message + '</li>';
    return;
  }

  const apps = Array.isArray(registry.apps) ? registry.apps : [];
  if (apps.length === 0) {
    grid.innerHTML = '<li class="empty">No apps yet. Add one in apps.json.</li>';
    return;
  }

  // Render each app as a card.
  grid.innerHTML = apps.map(renderCard).join('');
})();

function renderCard(app) {
  const icon = escapeHTML(app.icon || '📦');
  const name = escapeHTML(app.name || app.slug || 'Untitled');
  const desc = escapeHTML(app.description || '');
  const slug = encodeURIComponent(app.slug || '');

  if (app.status === 'live') {
    // Tappable card → opens the app
    return `
      <li>
        <a class="card card--live" href="/apps/${slug}/">
          <span class="card__icon" aria-hidden="true">${icon}</span>
          <span class="card__body">
            <span class="card__name">${name}</span>
            <span class="card__desc">${desc}</span>
          </span>
          <span class="card__cta" aria-hidden="true">Open →</span>
        </a>
      </li>
    `;
  }

  // Default: coming-soon → greyed, non-tappable, no href
  return `
    <li>
      <div class="card card--disabled" aria-disabled="true">
        <span class="card__icon" aria-hidden="true">${icon}</span>
        <span class="card__body">
          <span class="card__name">${name}</span>
          <span class="card__desc">${desc}</span>
        </span>
        <span class="card__pill">Coming soon</span>
      </div>
    </li>
  `;
}

// Tiny HTML escaper so a stray < or & in apps.json can't break the page.
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
