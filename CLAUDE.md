# LooFinder Web — Agent Context

## What This Is

Vanilla JavaScript single-page app for finding and rating public toilets in Australia. Public site: **https://loofinder.app**. Deployed on **GitHub Pages**. The backend API lives in the sibling `loofinder-api` repo and is hosted on **Render.com**.

No build step, no bundler, no framework — just HTML + CSS + JS loaded directly in the browser.

## Source of Truth

- **Implemented features:** `FEATURES.md`
- **Planned work:** `ROADMAP.md`
- **Backend context:** sibling `loofinder-api/CLAUDE.md`

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | Vanilla JavaScript (ES2020-style browser JS) |
| Mapping | Leaflet.js 1.9.4 |
| Marker clustering | Leaflet.markercluster 1.5.3 |
| Basemap | CartoDB light/dark tiles |
| Toilet data | Overpass API / OpenStreetMap |
| Geocoding | Backend proxy to Nominatim |
| Styling | Vanilla CSS |
| Icons | Google Material Symbols |
| Fonts | Inter |
| Public URL | https://loofinder.app |
| Deployment | GitHub Pages |

## Project Layout

```text
loofinder-web/
├── index.html                 # HTML shell, modals, sidebar, support menu, map container
├── app.js                     # Main app logic, map/data/reviews/PWA/analytics hooks
├── style.css                  # Responsive design, themes, modals, clusters, bottom sheet
├── service-worker.js          # PWA cache strategies
├── CNAME                      # GitHub Pages custom domain: loofinder.app
├── FEATURES.md                # Implemented project features
├── ROADMAP.md                 # Recommended next additions
└── assets/
    ├── site.webmanifest       # PWA manifest
    └── logos/                 # App/support icons
```

## Runtime Configuration

`app.js` selects the backend URL at runtime:

```js
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '';
const BACKEND_URL = IS_LOCAL ? "http://localhost:8000" : "https://loofinder-api.onrender.com";
const APP_VERSION = "11.4";
```

When changing `app.js` or `style.css`, update the cache-busting query string in `index.html`.

## Architecture Overview

All major app state lives in module-global variables in `app.js`.

| Variable | Purpose |
|----------|---------|
| `map` | Leaflet map instance |
| `userLat`, `userLng` | Current or fallback user coordinates |
| `allToiletData` | OSM toilet features for the current view |
| `ratingSummaryCache` | Facility rating summaries with 60s TTL |
| `ratingSummaryInFlight` | Prevents duplicate rating summary requests |
| `nameCache` | Resolved facility names/addresses |
| `backendUnavailable` | Sticky limited-mode flag after backend errors |
| `currentLoadToken` | Guards async background work from stale map loads |
| `activeFilters` | Accessible, baby, free, and unisex filter state |

## Implemented Core Features

1. **Interactive map** — Leaflet, CartoDB basemaps, custom WC pins, marker clustering.
2. **Toilet discovery** — Overpass bbox query with fallback centre-radius query, OSM node/way/relation handling, deduplication.
3. **Facility filters** — Accessible, Baby, Free, and Unisex.
4. **Geolocation** — Auto-locates on load, manual “Find Nearest to Me”, Melbourne fallback, Australia-only warning modal.
5. **Facility names** — Backend cache lookup, bulk name lookup, backend geocode proxy fallback, background resolution.
6. **Reviews/ratings** — Rating modal, optional text reviews, paginated reviews list, batch rating summaries, cache invalidation after review submit.
7. **Directions** — Google Maps walking deep links from popups and sidebar items.
8. **PWA/offline** — Manifest, service worker, app shell cache, tile cache, API fallback cache, install prompt, offline indicator.
9. **Themes** — Time-based light/dark theme from sunrise/sunset plus manual localStorage override.
10. **Feedback/support** — Feedback modal, Buy Me a Coffee links, mobile support menu.
11. **Analytics** — Lightweight event tracking via `sendBeacon`/`fetch` to `/api/analytics/events`.

## Backend API Usage

| What | Endpoint |
|------|----------|
| Submit review | `POST /api/reviews` |
| Get facility reviews | `GET /api/reviews/{facility_id}?limit=50&offset=0` |
| Batch rating summaries | `GET /api/reviews-summary?ids=id1,id2,...` |
| Get cached facility | `GET /api/facilities/{facility_id}` |
| Bulk cached facilities | `GET /api/facilities?ids=id1,id2,...` |
| Save facility | `POST /api/facilities` |
| Bulk save facilities | `POST /api/facilities/bulk` |
| Reverse geocode | `GET /api/geocode/reverse?lat=...&lon=...` |
| Submit feedback | `POST /api/feedback` |
| Track analytics event | `POST /api/analytics/events` |
| Admin analytics summary | `GET /api/admin/analytics/summary?days=7&token=...` |

## Analytics Events

Current frontend events include:

- `app_loaded`
- `use_my_location_clicked`
- `geolocation_failed`
- `search_this_area_clicked`
- `filter_toggled`
- `directions_clicked`
- `rate_modal_opened`
- `review_submitted_success`
- `review_submitted_failed`
- `feedback_submitted_success`
- `feedback_submitted_failed`
- `backend_unavailable_marked`
- `overpass_fetch_failed`
- `frontend_error`
- `frontend_unhandled_rejection`

Do not add exact latitude/longitude, review text, feedback text, email, or user-agent data to analytics properties.

## Running Locally

Serve the directory with any static server:

```bash
python -m http.server 8080
```

or:

```bash
npx serve .
```

Open `http://localhost:8080`. The app will call `http://localhost:8000` for backend requests when served from localhost.

## Known Gaps / Risks

### High Priority

- **No friendly analytics viewer:** Events are collected and summarized by the API, but there is no admin UI yet.
- **No privacy/data policy page:** Reviews, feedback, and analytics now exist, so public privacy documentation should be added.
- **`backendUnavailable` never resets:** A transient backend error can put the frontend into limited mode for the rest of the session.

### Medium Priority

- **Content filter feedback not surfaced:** API can return `content_filtered: true`, but frontend does not clearly tell users.
- **Accessibility gaps:** Modals need focus trapping; toasts need `aria-live`; star ratings need keyboard/screen-reader support.
- **Error/empty states are generic:** No-facility, offline, Overpass, backend-rating, and cached-data states should be more specific.

### Lower Priority / Parked

- **Live in-app routing:** Parked because Google/Apple Maps directions are better for turn-by-turn navigation.
- **Photo uploads:** Parked until moderation, storage, reports, and deletion flows exist.
- **Accounts/gamification:** Not needed until review ownership or reputation becomes important.

## Recommended Next Work

1. **Update/maintain this context file when features ship.**
2. **Build an admin analytics viewer** that consumes `/api/admin/analytics/summary`.
3. **Add a privacy/data policy page** linked from the support menu.
4. **Do an accessibility pass** on modals, toasts, star ratings, and focus return.
5. **Surface content filter feedback** after review/feedback submission.
6. **Add facility issue reporting** using structured feedback context.
7. **Add backend recovery retry logic** for `backendUnavailable`.

## Development Notes

- Keep the app dependency-light; this repo intentionally has no build pipeline.
- Prefer DOM APIs and `textContent` for user/OSM text.
- Keep map rendering non-blocking; do not block pin rendering on slow backend calls.
- Use cache-busting query params in `index.html` after CSS/JS changes.
- Preserve references to the public GitHub/source repo when updating public URL docs.
