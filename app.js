const map = L.map('map', { zoomControl: false }).setView([-37.8300, 144.8500], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

const BACKEND_URL = "https://loofinder-api.onrender.com";
let allToiletData = { features: [] };
let ratingCache = {};
let userLocationMarker = null;
let currentMapLayer = null;
let activeFilters = { accessible: false, baby: false };
let currentReviewFacility = "";
let currentRating = 0;

// --- Notification System ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('hiding'), 3000);
    setTimeout(() => toast.remove(), 3500);
}

// --- Data Fetching ---
async function loadDataForCurrentBounds() {
    document.getElementById('loader').style.display = 'flex';
    try {
        const bounds = map.getBounds();
        const overpassQuery = `[out:json];node["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});out;`;
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
        const data = await response.json();

        allToiletData.features = data.elements.map(node => ({
            type: "Feature",
            properties: { 
                Name: node.tags.name || "Public Toilet", 
                Accessible: node.tags.wheelchair === 'yes', 
                BabyChange: node.tags.diaper === 'yes' || node.tags.changing_table === 'yes'
            },
            geometry: { type: "Point", coordinates: [node.lon, node.lat] }
        }));
        renderMapPoints();
    } catch (e) { console.error(e); }
    finally { document.getElementById('loader').style.display = 'none'; }
}

// --- Map & Sidebar Rendering ---
function renderMapPoints() {
    if (currentMapLayer) map.removeLayer(currentMapLayer);
    const listContainer = document.getElementById('facility-list');
    listContainer.innerHTML = '';
    const center = map.getCenter();

    let displayFeatures = allToiletData.features.filter(f => {
        if (activeFilters.accessible && !f.properties.Accessible) return false;
        if (activeFilters.baby && !f.properties.BabyChange) return false;
        return true;
    });

    displayFeatures.forEach(f => {
        f.properties.dist = map.distance(center, L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]));
        // Instant Pre-fetch Cache
        if (!ratingCache[f.properties.Name]) {
            fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(f.properties.Name)}`)
                .then(r => r.json()).then(d => ratingCache[f.properties.Name] = d.reviews);
        }
    });

    displayFeatures.sort((a,b) => a.properties.dist - b.properties.dist);

    currentMapLayer = L.geoJSON({type: "FeatureCollection", features: displayFeatures}, {
        onEachFeature: (f, l) => {
            const name = f.properties.Name;
            const safeId = "rt-" + name.replace(/[^a-z0-9]/gi, '');
            l.bindPopup(`<b>${name}</b><div id="${safeId}" style="color:#f59e0b; font-weight:700; margin:5px 0;">⭐ Loading...</div><button class="btn-review-small" onclick="openModal('${name.replace(/'/g, "\\'")}')">Rate It</button>`);
            l.on('popupopen', () => fetchAndDisplayRating(name, safeId));
            f.layerRef = l;
        }
    }).addTo(map);

    displayFeatures.slice(0, 5).forEach(f => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `<div style="display:flex; justify-content:space-between;"><b>${f.properties.Name}</b><span style="color:#007aff;">${(f.properties.dist/1000).toFixed(2)}km</span></div>`;
        item.onclick = () => { map.flyTo([f.geometry.coordinates[1], f.geometry.coordinates[0]], 16); f.layerRef.openPopup(); };
        listContainer.appendChild(item);
    });
}

async function fetchAndDisplayRating(name, id) {
    const el = document.getElementById(id);
    if (!el) return;
    const reviews = ratingCache[name] || [];
    if (reviews.length > 0) {
        const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
        el.innerHTML = `<span class="clickable-rating" onclick="openReviewsList('${name.replace(/'/g, "\\'")}')">⭐ ${avg} (${reviews.length} reviews)</span>`;
    } else { el.innerHTML = `⭐ No reviews yet`; }
}

// --- GPS Logic ---
function findNearest() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        map.flyTo([lat, lng], 15);
        if (userLocationMarker) userLocationMarker.setLatLng([lat, lng]);
        else {
            const icon = L.divIcon({ className: 'custom-user-marker', html: '<div class="user-location-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
            userLocationMarker = L.marker([lat, lng], { icon }).addTo(map);
        }
        setTimeout(loadDataForCurrentBounds, 1000);
    }, () => showToast("Location denied.", "error"));
}

// --- Modals & Filters ---
function toggleFilter(t) { activeFilters[t] = !activeFilters[t]; document.getElementById('chip-'+t).classList.toggle('active'); renderMapPoints(); }
function openModal(n) { currentReviewFacility = n; document.getElementById('modalFacilityName').innerText = n; document.getElementById('reviewModal').style.display = 'flex'; currentRating = 0; updateStarsUI(); }
function closeModal() { document.getElementById('reviewModal').style.display = 'none'; }
function setRating(r) { currentRating = r; updateStarsUI(); }
function updateStarsUI() { document.querySelectorAll('.star').forEach(s => s.classList.toggle('selected', parseInt(s.dataset.value) <= currentRating)); }

async function submitReview() {
    if (currentRating === 0) return showToast("Pick a star!", "error");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reviews`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ facility_name: currentReviewFacility, rating: currentRating, review_text: document.getElementById('reviewText').value })
        });
        if (res.ok) { showToast("Review saved!", "success"); closeModal(); delete ratingCache[currentReviewFacility]; loadDataForCurrentBounds(); }
    } catch (e) { showToast("Error connecting.", "error"); }
}

async function openReviewsList(n) {
    document.getElementById('reviewsListModal').style.display = 'flex';
    const container = document.getElementById('reviewsContainer');
    container.innerHTML = "Loading...";
    const res = await fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(n)}`);
    const data = await res.json();
    container.innerHTML = data.reviews.map(r => `<div class="review-card">⭐ ${r.rating}<br>${r.review_text}</div>`).join('') || "No text reviews.";
}
function closeReviewsList() { document.getElementById('reviewsListModal').style.display = 'none'; }

map.whenReady(() => findNearest());