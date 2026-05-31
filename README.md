# Personal App Store

A static webpage that lists my custom-built apps and lets me install them on my iPhone as PWAs (Progressive Web Apps).

This is the **rack** — the storage shelf. Each app I build gets a card here; tapping the card opens the app; "Add to Home Screen" makes it look and feel native.

Live URL: _(filled in after Vercel deploy)_

---

## File map

```
personal-app-store/
├── index.html        ← the store page
├── style.css         ← styling (Apple-clean, mobile-first)
├── app.js            ← reads apps.json and renders cards
├── apps.json         ← the registry — single source of truth for app list
├── manifest.json     ← makes the store installable as a PWA
├── icon.svg          ← store icon (emoji rendered as SVG)
├── README.md         ← this file
└── apps/
    └── workout/      ← Workout Tracker app lives here (built in PRD-02)
```

No build step, no frameworks. Plain HTML/CSS/JavaScript. Anything in the browser can run it.

---

## How to add a new app

1. Open `apps.json`.
2. Add a new entry to the `apps` array:

   ```json
   {
     "slug": "habits",
     "name": "Habit Tracker",
     "description": "Daily check-ins.",
     "icon": "✅",
     "status": "coming-soon",
     "category": "productivity"
   }
   ```

3. If the app is ready, create `apps/{slug}/index.html` and set `"status": "live"`.
4. Commit and push to `main`. Vercel auto-deploys in ~20 seconds.

### The two statuses

| Status | What renders |
|---|---|
| `live` | Tappable card with an "Open →" button that links to `/apps/{slug}/`. |
| `coming-soon` | Greyed-out, non-tappable card with a "Coming soon" pill. No broken links. |

### Icons

Use a single emoji as the icon (e.g. `🏋️`, `✅`, `📒`). No PNG sourcing — emojis render anywhere.

---

## Deploy pipeline

```
edit files locally  →  git push origin main  →  Vercel rebuilds  →  live in ~20s
```

Vercel is connected to this GitHub repo. Every push to `main` triggers a fresh deploy. No configuration: it's a static site served straight from the CDN.

---

## Local preview

```sh
cd personal-app-store
python3 -m http.server 8000
```

Open <http://localhost:8000> in any browser. `Ctrl-C` to stop.

---

## Constraints (kept on purpose)

- No backend, no database, no auth.
- No frameworks (React/Vue/Tailwind/etc.) and no build tools.
- No service worker in v1 — the PWA manifest alone is enough for "Add to Home Screen."
- No dark mode, no search, no analytics. Keep the rack boring and inspectable.
