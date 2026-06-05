# LooFinder Web

## Hosting

Live site: **https://loofinder.app** — served by **GitHub Pages** (custom domain via the `CNAME` file). Pushes to `main` deploy automatically.

The backend API runs at `https://loofinder-api.onrender.com` (Render + Neon Postgres). See the sibling `loofinder-api` repo.

## Mobile Compass QA Checklist

Run this checklist on a real phone after compass or map-state changes.

1. Open the app, grant location and compass permissions, and confirm nearby toilets load.
2. Tap compass while map is north-up and centered: heading-up mode should turn on smoothly.
3. Rotate your body slowly and quickly: map bearing should move smoothly without jitter spikes.
4. Drag or zoom the map away from your location: compass should switch to recenter behavior.
5. Tap compass after pan/zoom: map should recenter to user location without showing "Fetching facilities...".
6. Rotate map manually with two fingers: heading-up should turn off and compass should allow north reset.
7. Tap compass while rotated: map should animate back to north-up.
8. Verify `Search this area` states:
   - `Updating nearby toilets...` while loading
   - `Results up to date` when current
   - `Search this area` when viewport becomes stale
9. Repeat steps 2-7 in dark mode.
10. Repeat key flows after force refresh/PWA reopen to confirm cache-busted assets are loaded.
