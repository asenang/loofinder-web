# LooFinder Frontend Roadmap

This document tracks potential future enhancements for the `loofinder-web` frontend. Implemented capabilities are documented in `FEATURES.md`.

## Recommended Next Additions

### 1. Lightweight Analytics Viewer

- **Why:** Event ingestion and the admin API summary now exist, but there is no friendly way to read trends without opening raw JSON.
- **Add:** A protected admin-only HTML report or simple static dashboard that calls `/api/admin/analytics/summary`.
- **MVP:** Sessions by day, top events, review submissions, directions clicks, feedback submissions, frontend errors, backend unavailable events.
- **Guardrails:** Keep it token-protected, do not expose exact coordinates, emails, review text, or feedback text.

### 2. Accessibility Pass

- **Why:** The app is highly mobile/visual, but emergency-use apps should work well with keyboard and screen-reader users.
- **Add:** Focus trapping for modals, `aria-live` for toasts, keyboard support for star ratings, clearer modal labels, and improved focus return after modal close.
- **MVP:** Review modal and feedback modal first, then map/sidebar controls.

### 3. Content Filter Feedback

- **Why:** The API can return `content_filtered: true`, but the frontend does not clearly tell users when their review text was replaced.
- **Add:** A user-facing toast or inline message after review submission when content was filtered.
- **MVP:** Show a neutral message such as “Your rating was saved, but the text was hidden because it may violate the content policy.”

### 4. Backend Recovery UX

- **Why:** A transient backend failure can put the frontend into limited mode for the rest of the session.
- **Add:** Retry/backoff logic and a way to clear `backendUnavailable` after a successful health check or API response.
- **MVP:** Track a timestamp for backend failures and retry after 60 seconds.

### 5. Facility Issue Reporting

- **Why:** Users may know when a toilet is closed, incorrectly mapped, unsafe, or missing key amenities.
- **Add:** “Report an issue” action from popup/list items.
- **MVP:** Reuse the feedback endpoint with structured context: facility ID, issue type, current URL, and app version.
- **Future:** Admin moderation queue and OSM edit workflow.

### 6. Better Empty and Error States

- **Why:** Users need confidence when no toilets show or APIs are slow.
- **Add:** Distinct messages for no facilities found, Overpass unavailable, backend ratings unavailable, and offline mode.
- **MVP:** Replace generic error toast with actionable states like “Try zooming out” or “Using cached results.”

### 7. Privacy and Data Policy Page

- **Why:** The app now collects reviews, feedback, and lightweight analytics.
- **Add:** A simple public privacy page explaining what is collected, what is not collected, and how users can contact you.
- **MVP:** Static `privacy.html` linked from the support menu.

### 8. User-Suggested Toilets

- **Why:** Public toilet datasets can be incomplete or outdated, and users may know about toilets that are missing from the map.
- **Add:** A “Suggest toilet” flow that lets users submit a location, basic facility details, notes, and optional contact email.
- **MVP:** Let users suggest the current GPS location, map center, or a tapped map location; submit to a backend moderation queue rather than publishing immediately.
- **Guardrails:** Keep suggestions hidden until reviewed, or clearly mark them as unverified if displayed later.

## Shipped User Features

### Progressive Web App (PWA) and Offline Support

- App manifest, install prompt handling, service worker registration, app shell caching, tile caching, API cache fallback, offline indicator, and safe-area styling are implemented.

### Rich OpenStreetMap Tags

- The app reads and filters facility metadata including accessibility, baby-change support, free/fee status, and unisex/gender-neutral status.

### Pin Clustering

- `Leaflet.markercluster` groups dense toilet markers into brand-blue cluster bubbles.

### Directions Deep Links

- Popup and list actions open Google Maps walking directions in a new tab.

### Reviews and Ratings

- Users can submit ratings/reviews, view paginated review lists, and see batch-loaded rating summaries.

### Lightweight Frontend Analytics

- The frontend tracks app load, geolocation failures, filter usage, search-area clicks, directions, review outcomes, feedback outcomes, backend availability, Overpass failures, and frontend errors.

## Parked Ideas

### Live Walking Routes and Estimates

- **Status:** Parked.
- **Reason:** Google/Apple Maps already provide mature turn-by-turn walking navigation, live re-routing, and platform integrations. Keep the existing deep-link Directions button unless LooFinder later needs indoor/floor-plan routing or LooFinder-specific overlays.

### Photo Uploads for Reviews

- **Status:** Parked until moderation exists.
- **Reason:** Public photo uploads in a toilet-related app are high-risk. Shipping responsibly requires object storage, automated image moderation, manual review queue, reporting, rate limits, and rejected-image hashing.

## Monetization Ideas

### User Tips

- Keep the existing Buy Me a Coffee support path and consider making it measurable through analytics.

### Sponsored Pins

- Potential future B2B feature for venues that want to promote publicly usable restrooms.
- Must clearly distinguish sponsored locations from public/OSM data.

### LooFinder Plus

- Possible subscription for advanced filtering, ad-free experience, saved offline areas, or power-user features.
- Keep emergency toilet discovery free.

### City Council Reporting

- Potential aggregate reporting product for public infrastructure planning.
- Must respect OpenStreetMap licensing, privacy expectations, and avoid selling identifiable user behaviour.
