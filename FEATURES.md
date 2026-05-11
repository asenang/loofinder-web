# LooFinder Implemented Features

This document lists the features currently implemented across the LooFinder frontend (`loofinder-web`) and backend API (`loofinder-api`).

## Product Overview

LooFinder is a mobile-friendly public toilet finder for Australia. It uses OpenStreetMap toilet data, displays nearby facilities on an interactive Leaflet map, and lets users view directions, submit reviews, send feedback, install the app as a PWA, and generate lightweight usage analytics.

- **Public site:** https://loofinder.app
- **Frontend hosting:** GitHub Pages
- **Backend hosting:** Render
- **Backend API:** `https://loofinder-api.onrender.com`

## Frontend Features

### Interactive Map

- **Leaflet map** with CartoDB basemaps.
- **Automatic light/dark basemap switching** based on the current theme.
- **Custom WC markers** for toilet locations.
- **Brand-blue marker clusters** using `Leaflet.markercluster` for dense map areas.
- **Popup cards** for each toilet with rating summary, Directions, and Rate actions.
- **Search this area** control after the user pans/zooms the map.
- **Fallback Overpass query** that retries with a centre-radius search if the bounding-box query fails.

### Toilet Discovery

- **OpenStreetMap / Overpass API integration** for `amenity=toilets` nodes, ways, and relations.
- **Deduplication** of OSM elements to avoid duplicate map points.
- **Distance sorting** based on the user marker when available, otherwise the current map centre.
- **Nearest 5 facilities sidebar** showing facility name, distance, rating state, feature icons, Directions, and Rate actions.

### Facility Filters

- **Accessible** filter.
- **Baby change** filter.
- **Free** filter from OSM `fee` data.
- **Unisex** filter from OSM `unisex` data.
- **Expandable “All filters” control** to keep the default UI compact.

### Facility Names

- **Local in-memory name cache** to avoid repeated lookups during a session.
- **Backend-resolved name lookup** for cached facility names.
- **Bulk backend name lookup** to reduce many per-facility requests into batch requests.
- **Server-side geocoding proxy fallback** for unresolved names.
- **Background name resolution** so map pins render immediately while names update later.
- **Buffered bulk save** of resolved facility names back to the backend.

### Reviews and Ratings

- **Rating modal** for submitting 1–5 star reviews.
- **Optional review text** submission.
- **Rating-only reviews** supported.
- **Popup and sidebar rating summaries** with average rating and review count.
- **Batch rating summary fetch** to avoid per-facility rating requests.
- **60-second rating summary cache** for reduced backend load.
- **Rating cache invalidation** after a successful review submission.
- **Reviews list modal** with paginated loading support.
- **“Be the first to review”** empty-state action for unrated facilities.

### Directions

- **Google Maps walking directions deep links** from popups and sidebar list items.
- **New-tab directions links** using `rel="noopener noreferrer"`.
- **Directions click analytics** for list and popup sources.

### Location and Australia Scope

- **Geolocation on app load** to centre the map near the user.
- **Find Nearest to Me** button for manual location recentering.
- **Australia bounding-box validation** for user coordinates.
- **Outside-Australia warning modal** with local-alternative search and “Continue Anyway”.
- **Melbourne fallback view** when geolocation is unavailable, denied, or unsupported.

### Theme and UI

- **Automatic time-based theme** using sunrise/sunset calculation from user coordinates.
- **Manual dark/light theme toggle** saved in `localStorage`.
- **Responsive desktop sidebar** over the map.
- **Mobile bottom-sheet layout** with draggable/collapsible behaviour.
- **Mobile support menu** using a Material `more_horiz` icon.
- **Glassmorphic support/tip jar affordance** on desktop.
- **Toast notifications** for success/error states.
- **Branded blue visual system** using `#007aff` as the primary colour.

### Feedback and Support

- **Feedback modal** with optional email and required message.
- **Feedback submission** to the backend email endpoint.
- **Buy Me a Coffee / support links** on desktop and mobile.
- **Install app action** exposed when the browser provides a PWA install prompt.

### PWA and Offline Support

- **Web app manifest** with app name, icons, theme colour, orientation, and `loofinder.app` identity/scope.
- **Service worker registration**.
- **App shell caching** for HTML, manifest, and core icons.
- **Stale-while-revalidate strategy** for shell assets.
- **Tile caching** for OpenStreetMap/CartoDB map tiles with a size cap.
- **Network-first API caching** for backend, Overpass, and Nominatim-related requests.
- **Offline indicator** when the browser is offline.
- **Safe-area support** for installed/mobile PWA usage.
- **Standalone PWA detection** to avoid showing install prompts inside an already-installed app.

### SEO and Domain Metadata

- **Custom domain:** `loofinder.app`.
- **GitHub Pages `CNAME`** for custom-domain hosting.
- **Canonical URL metadata** pointing to `https://loofinder.app/`.
- **Open Graph metadata** for social sharing.
- **Twitter card metadata**.
- **Favicon and Apple touch icon** support.

### Frontend Security and Reliability

- **HTML escaping helper** for OSM/user-facing names.
- **Safe facility action registry** using `data-action` and delegated click handling instead of inline JS string interpolation for facility actions.
- **DOM API usage** for sidebar list item title rendering.
- **Non-blocking rating fetch** so slow/cold backend responses do not prevent toilet markers from rendering.
- **Backend unavailable tracking** to avoid repeated failing backend calls in the same session.
- **Frontend error and unhandled-promise analytics** for stability monitoring.

### Frontend Analytics Events

The frontend sends lightweight analytics events to the API using `navigator.sendBeacon` with a `fetch` fallback.

Tracked events include:

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

## Backend API Features

### Core API and Health

- **FastAPI backend** for reviews, facility cache, feedback, geocoding, and analytics.
- **Root keep-alive endpoint** at `GET /`.
- **Health endpoint** at `GET /health` with database connectivity state.
- **CORS configuration** driven by environment variables.
- **SlowAPI rate limiting** for user-submitted endpoints.
- **Proxy-aware rate-limit key option** via `TRUST_PROXY_HEADERS`.

### Database and Migrations

- **Neon PostgreSQL support** via `DATABASE_URL`.
- **Threaded connection pool** for lower per-request connection overhead.
- **Startup migrations** for required tables and indexes.
- **Manual setup endpoint** at `POST /setup-database` protected by `SETUP_ADMIN_TOKEN`.

Implemented tables include:

- `reviews`
- `facilities`
- `analytics_events`

### Reviews API

- **Submit review:** `POST /api/reviews`
- **Fetch facility reviews:** `GET /api/reviews/{facility_id}`
- **Paginated review responses** with `limit`, `offset`, and `total`.
- **Recent reviews admin/debug endpoint:** `GET /api/reviews`
- **Batch rating summary endpoint:** `GET /api/reviews-summary?ids=id1,id2,...`
- **Rating validation** from 1 to 5.
- **Review text validation** allowing empty/rating-only reviews, while rejecting short low-substance text.

### Review Content Filtering

- **Profanity/offensive content filtering** for review text.
- **Normalization of common obfuscations** such as leetspeak.
- **Blocklist checks** for high-confidence terms.
- **ML profanity classifier integration** via `alt-profanity-check`.
- **Spam heuristics** for repeated characters, URLs, and other low-quality submissions.
- **Filtered review replacement text** rather than storing raw offensive content.

### Facility Cache API

- **Single facility lookup:** `GET /api/facilities/{facility_id}`
- **Single facility save/upsert:** `POST /api/facilities`
- **Bulk facility lookup:** `GET /api/facilities?ids=id1,id2,...`
- **Bulk facility save/upsert:** `POST /api/facilities/bulk`
- **Bulk request caps** to protect backend resources.
- **Cached resolved names** for OSM facility IDs.
- **Stored facility metadata** including coordinates, accessibility, and baby-change flags.

### Geocoding Proxy

- **Reverse geocoding endpoint:** `GET /api/geocode/reverse?lat=...&lon=...`
- **Server-side Nominatim integration** with a descriptive User-Agent.
- **Coordinate validation** for latitude/longitude ranges.
- **In-memory geocode cache** with TTL and max-size cap.
- **Upstream throttle** to respect Nominatim usage policy.
- **Address simplification** to user-friendly names such as street, suburb, town, or city.

### Feedback API

- **Feedback submission endpoint:** `POST /api/feedback`
- **Message length validation**.
- **Optional sender email**.
- **SMTP email delivery** via environment-configured SMTP settings.
- **Content filtering** for feedback messages before sending.
- **Context payload support** for page/theme/client context.

### Analytics API

- **Event ingestion endpoint:** `POST /api/analytics/events`
- **Admin summary endpoint:** `GET /api/admin/analytics/summary?days=7&token=...`
- **Token protection** using `ANALYTICS_ADMIN_TOKEN`, falling back to `SETUP_ADMIN_TOKEN`.
- **Daily session and event summary** for the selected date range.
- **Property sanitization** to avoid storing exact coordinates, email, messages, review text, user-agent strings, or other sensitive raw content.
- **Database-backed `analytics_events` table** with indexes for created date, event name, and session ID.

### Backend Tests

- **Offline FastAPI test suite** using patched database dependencies.
- Tests cover:
  - Root and health endpoints.
  - Review submission validation.
  - Paginated review fetching.
  - Batch review summaries.
  - Facility upsert and bulk endpoints.
  - Geocoding proxy validation.
  - Database-unavailable behaviours.
  - Content filter behaviour.

## Deployment and Operations

### Frontend

- Hosted as static files on GitHub Pages.
- Custom domain configured through `CNAME` as `loofinder.app`.
- Cache-busting query strings are used for CSS/JS updates.
- No build step or bundler is required.

### Backend

- Hosted on Render.
- Uses environment variables for database, CORS, admin tokens, SMTP, proxy trust, and Nominatim contact configuration.
- Runs migrations at startup through the FastAPI lifespan hook.

## Environment Variables

### Frontend

The frontend has no build-time environment variables. It selects the backend URL at runtime:

- `localhost`, `127.0.0.1`, or empty hostname → `http://localhost:8000`
- all other hostnames → `https://loofinder-api.onrender.com`

### Backend

Common backend environment variables include:

- `DATABASE_URL`
- `ALLOWED_ORIGINS`
- `ENV`
- `SETUP_ADMIN_TOKEN`
- `ANALYTICS_ADMIN_TOKEN`
- `TRUST_PROXY_HEADERS`
- `DB_POOL_MIN`
- `DB_POOL_MAX`
- `NOMINATIM_CONTACT_EMAIL`
- `FEEDBACK_TO_EMAIL`
- `FEEDBACK_FROM_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_USE_SSL`
- `SMTP_USE_TLS`

## Current Parking-Lot Items

These are intentionally not implemented or are parked for later:

- **In-app live walking routes** — parked because Google/Apple Maps deep links already provide mature navigation.
- **Photo uploads** — parked until moderation/storage/reporting infrastructure is ready.
- **Sponsored pins / paid features** — documented as monetisation possibilities but not currently implemented.
- **City council reporting/licensing** — concept only; would require careful handling of OSM licensing and user-generated data boundaries.
