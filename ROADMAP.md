# LooFinder Frontend Roadmap

This document outlines potential future enhancements, features, and architectural improvements for the `loofinder-web` frontend application.

## 🌟 High-Impact User Features

### 1. Progressive Web App (PWA) & Offline Support  *(shipped)*
*   **The Idea:** Users often need restroom access when they have poor cell service (e.g., in a basement mall, a subway, or a remote park).
*   **Implementation:** Add a `service-worker.js` and a `manifest.json` (already partially there) to cache the app's HTML/CSS/JS and recently viewed map tiles. This allows the app to be "installed" to a user's phone home screen natively and load without an internet connection.

### 2. Live Walking Routes & Estimates  *(parked)*
*   **The Idea:** Instead of kicking users out to the Google Maps app via the "Directions" button, draw the walking path directly on your Leaflet map.
*   **Implementation:** Integrate the `Leaflet Routing Machine` plugin or query the OpenRouteService API to draw the polyline and display "3 min walk".
*   **Status:** Parked. Google/Apple Maps already provide best-in-class turn-by-turn walking nav, live re-routing, traffic, and AR. Replicating that inside LooFinder doesn't justify the maintenance cost. Keep the existing deep-link "Directions" button. Revisit if/when we add an indoor/floor-plan view or want to overlay LooFinder-only metadata (e.g. accessibility along the route).

### 3. Rich OpenStreetMap Tags  *(shipped)*
*   **The Idea:** OpenStreetMap has a wealth of hidden metadata regarding facilities. 
*   **Implementation:** Update the Overpass query to look for tags like `fee=yes/no` (is it free?), `wheelchair=yes/no` (is it fully accessible?), and `unisex=yes`. Add corresponding visual filter chips so users can find exactly what they need.

### 4. Pin Clustering  *(shipped)*
*   **The Idea:** If a user zooms out to view an entire city, thousands of pins will overlap and cause the browser to lag.
*   **Implementation:** Implement the `Leaflet.markercluster` plugin to group nearby toilets into single interactive bubbles with numbers (e.g., "14") that expand when you zoom in.

### 5. Photo Uploads for Reviews  *(parked — moderation cost)*
*   **The Idea:** Allowing users to upload photos proves cleanliness and condition, which is a high priority for users.
*   **Implementation:** Add an image upload button to the review modal. Send the payload to the API (which will need an update to handle `multipart/form-data` and cloud storage like S3).
*   **Status:** Parked until LooFinder has either (a) enough sponsorship/Plus revenue to fund moderation tooling, or (b) a trusted-contributor community we can gate uploads behind.
*   **Blocker:** Public photo uploads on a toilet-related app are an obvious abuse magnet. Shipping responsibly requires:
    1. Cloud storage (Cloudflare R2 / S3) with `pending` flag.
    2. Synchronous automated pre-screening (Sightengine / Google Cloud Vision SafeSearch / AWS Rekognition Moderation) — auto-reject `adult|gore|violence`.
    3. Manual admin approval queue gated by `SETUP_ADMIN_TOKEN` for anything not auto-rejected.
    4. Report button + auto-hide after N reports.
    5. Perceptual image hashing so previously-rejected images are auto-rejected on re-upload.
    6. Rate limiting: 1 photo per facility per user per day, max 3 photos per facility.
    7. Optional: trusted-user gating (N+ approved reviews required to upload).
*   **Estimated effort:** ~2 days for the moderated stack; do not ship without it.

## 💰 Monetization Strategy

### 1. User Tips ("Buy me a Coffee")
*   **The Idea:** LooFinder provides a massive public utility. Many users (especially parents, delivery drivers, or travelers in a pinch) would gladly tip a small amount as a "thank you" for saving them in an emergency.
*   **Implementation:** Add a small, unobtrusive "Support LooFinder" or "Buy us a Toilet Roll 🧻" button in the sidebar linking to Stripe Checkout, Patreon, or BuyMeACoffee.

### 2. Sponsored Pins (B2B Lead Generation)
*   **The Idea:** Coffee shops, fast-food chains, and malls often require you to be a "paying customer" to use their restrooms. 
*   **Implementation:** Charge local businesses a small monthly fee to feature their location as a "Premium Pin" (e.g., a gold marker). This drives foot traffic to their business from users who will likely buy a coffee or snack in exchange for restroom access.

### 3. LooFinder Plus (Freemium Subscription)
*   **The Idea:** Keep the essential emergency map free, but charge a small fee ($1.99/mo) for power-user features.
*   **Implementation:** Put features like Offline Maps (PWA downloads), advanced filtering (e.g., "Keypad Code required"), and an ad-free experience behind a subscription paywall.

### 4. City Council Data Licensing
*   **The Idea:** The crowdsourced data LooFinder collects on the state of public infrastructure is highly valuable.
*   **Implementation:** Sell aggregated, anonymized reporting dashboards to urban planners, city councils, and tourism boards so they can identify which parks need more janitorial funding or where new facilities should be built.
