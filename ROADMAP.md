# LooFinder Frontend Roadmap

This document outlines potential future enhancements, features, and architectural improvements for the `loofinder-web` frontend application.

## 🌟 High-Impact User Features

### 1. Progressive Web App (PWA) & Offline Support
*   **The Idea:** Users often need restroom access when they have poor cell service (e.g., in a basement mall, a subway, or a remote park).
*   **Implementation:** Add a `service-worker.js` and a `manifest.json` (already partially there) to cache the app's HTML/CSS/JS and recently viewed map tiles. This allows the app to be "installed" to a user's phone home screen natively and load without an internet connection.

### 2. Live Walking Routes & Estimates
*   **The Idea:** Instead of kicking users out to the Google Maps app via the "Directions" button, draw the walking path directly on your Leaflet map.
*   **Implementation:** Integrate the `Leaflet Routing Machine` plugin or query the OpenRouteService API to draw the polyline and display "3 min walk".

### 3. Rich OpenStreetMap Tags
*   **The Idea:** OpenStreetMap has a wealth of hidden metadata regarding facilities. 
*   **Implementation:** Update the Overpass query to look for tags like `fee=yes/no` (is it free?), `wheelchair=yes/no` (is it fully accessible?), and `unisex=yes`. Add corresponding visual filter chips so users can find exactly what they need.

### 4. Pin Clustering
*   **The Idea:** If a user zooms out to view an entire city, thousands of pins will overlap and cause the browser to lag.
*   **Implementation:** Implement the `Leaflet.markercluster` plugin to group nearby toilets into single interactive bubbles with numbers (e.g., "14") that expand when you zoom in.

### 5. Photo Uploads for Reviews
*   **The Idea:** Allowing users to upload photos proves cleanliness and condition, which is a high priority for users.
*   **Implementation:** Add an image upload button to the review modal. Send the payload to the API (which will need an update to handle `multipart/form-data` and cloud storage like S3).
