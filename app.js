const map = L.map('map', { zoomControl: false }).setView([-37.8300, 144.8500], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);

const BACKEND_URL = "https://loofinder-api.onrender.com";
let allToiletData = { features: [] };
let ratingCache = {};
let userLocationMarker = null;
let currentMapLayer = null;
let activeFilters = { accessible: false, baby: false };
let currentReviewFacility = "";
let currentRating = 0;

// Custom Map Pin (Now matches the blue theme in CSS)
const toiletIcon = L.divIcon({
    className: 'custom-pin',
    html: '<span class="material-symbols-outlined" style="font-size: 16px;">wc</span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
});

// --- Notification System ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'check_circle' : 'error';
    toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('hiding'), 3000);
    setTimeout(() => toast.remove(), 3500);
}

// --- Data Fetching ---
async function loadDataForCurrentBounds() {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('btn-search-area').style.display = 'none';
    try {
        const bounds = map.getBounds();
        // Enhanced query to fetch more comprehensive toilet data
        const overpassQuery = `
            [out:json];
            (
                node["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
                way["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
                relation["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
                node["toilets"="yes"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
                node["amenity"="public_toilet"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
            );
            (._;>;);
            out center;
        `;
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
        const data = await response.json();

        allToiletData.features = data.elements.map(element => {
            // Handle different element types (nodes, ways, relations)
            let lat, lon;
            if (element.type === 'node') {
                lat = element.lat;
                lon = element.lon;
            } else if (element.type === 'way' || element.type === 'relation') {
                lat = element.center?.lat;
                lon = element.center?.lon;
            }

            if (!lat || !lon) return null;

            const tags = element.tags || {};
            
            return {
                type: "Feature",
                properties: { 
                    Name: tags.name || tags.description || tags.operator || "Public Toilet",
                    Accessible: tags.wheelchair === 'yes' || tags.access === 'yes',
                    BabyChange: tags.diaper === 'yes' || tags.changing_table === 'yes' || tags.baby_friendly === 'yes',
                    Fee: tags.fee === 'yes' ? tags.fee || 'Yes' : 'No',
                    OpeningHours: tags.opening_hours || '',
                    Operator: tags.operator || '',
                    Gender: tags.gender || '',
                    MappedBy: tags.source || '',
                    AdditionalInfo: tags.description || tags.note || ''
                },
                geometry: { type: "Point", coordinates: [lon, lat] }
            };
        }).filter(Boolean); // Remove null entries
        
        renderMapPoints();
    } catch (e) { 
        console.error('Error fetching toilet data:', e);
        showToast('Error loading toilet data', 'error');
    }
    finally { document.getElementById('loader').style.display = 'none'; }
}

// --- Map & Sidebar Rendering ---
function renderMapPoints() {
    if (currentMapLayer) map.removeLayer(currentMapLayer);
    const listContainer = document.getElementById('facility-list');
    listContainer.innerHTML = '';
    
    // Accurate distance tracking from the user's actual dot
    const referencePoint = userLocationMarker ? userLocationMarker.getLatLng() : map.getCenter();

    let displayFeatures = allToiletData.features.filter(f => {
        if (activeFilters.accessible && !f.properties.Accessible) return false;
        if (activeFilters.baby && !f.properties.BabyChange) return false;
        return true;
    });

    displayFeatures.forEach(f => {
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];
        f.properties.dist = map.distance(referencePoint, L.latLng(lat, lng));
        
        // Instant Pre-fetch Cache
        if (!ratingCache[f.properties.Name]) {
            fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(f.properties.Name)}`)
                .then(r => r.json()).then(d => ratingCache[f.properties.Name] = d.reviews);
        }
    });

    displayFeatures.sort((a,b) => a.properties.dist - b.properties.dist);

    currentMapLayer = L.geoJSON({type: "FeatureCollection", features: displayFeatures}, {
        pointToLayer: function (feature, latlng) {
            return L.marker(latlng, {icon: toiletIcon});
        },
        onEachFeature: (f, l) => {
            const name = f.properties.Name;
            const safeId = "rt-" + name.replace(/[^a-z0-9]/gi, '');
            const lat = f.geometry.coordinates[1];
            const lng = f.geometry.coordinates[0];
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

            // Popups now have the restored buttons
            l.bindPopup(`
                <div style="font-weight:700; font-size:15px; color:#2c3e50;">${name}</div>
                <div id="${safeId}" style="color:#7f8c8d; margin:8px 0 12px 0;">Loading rating...</div>
                <div style="display: flex; gap: 8px;">
                    <a href="${mapsUrl}" target="_blank" class="btn-action-small btn-directions" style="flex:1;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
                    </a>
                    <button class="btn-action-small btn-rate" style="flex:1;" onclick="openModal('${name.replace(/'/g, "\\'")}')">
                        <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                    </button>
                </div>
            `);
            l.on('popupopen', () => fetchAndDisplayRating(name, safeId));
            f.layerRef = l;
        }
    }).addTo(map);

    const top5Nearest = displayFeatures.slice(0, 5);
    
    top5Nearest.forEach(feature => {
        const name = feature.properties.Name;
        const accIcon = feature.properties.Accessible ? '<span class="material-symbols-outlined" title="Accessible" style="font-size:16px;">accessible</span>' : '';
        const babyIcon = feature.properties.BabyChange ? '<span class="material-symbols-outlined" title="Baby Change" style="font-size:16px;">baby_changing_station</span>' : '';
        const distanceKm = (feature.properties.dist / 1000).toFixed(2);
        
        const lat = feature.geometry.coordinates[1];
        const lng = feature.geometry.coordinates[0];
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

        const listItem = document.createElement('div');
        listItem.className = 'list-item';
        
        // Sidebar list also accurately reflects distance, Directions, and Rate
        listItem.innerHTML = `
            <div class="list-item-header">
                <div class="list-item-title">${name}</div>
                <div class="distance-badge">${distanceKm} km</div>
            </div>
            <div class="list-item-features">${accIcon} ${babyIcon}</div>
            <div class="list-item-actions">
                <a href="${mapsUrl}" target="_blank" class="btn-action-small btn-directions" onclick="event.stopPropagation();">
                    <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
                </a>
                <button class="btn-action-small btn-rate" onclick="event.stopPropagation(); openModal('${name.replace(/'/g, "\\'")}')">
                    <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                </button>
            </div>
        `;
        
        listItem.onclick = () => {
            map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
            feature.layerReference.openPopup();
            if (window.innerWidth <= 768) window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        
        listContainer.appendChild(listItem);
    });
}

async function fetchAndDisplayRating(name, id) {
    const el = document.getElementById(id);
    if (!el) return;
    const reviews = ratingCache[name] || [];
    if (reviews.length > 0) {
        const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
        el.innerHTML = `<span class="clickable-rating" onclick="openReviewsList('${name.replace(/'/g, "\\'")}')">
            <span class="material-symbols-outlined" style="font-size:16px; color:#f59e0b;">star</span> ${avg} (${reviews.length})
        </span>`;
    } else { 
        el.innerHTML = `<span style="font-size:13px; font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">star_outline</span> No reviews yet</span>`; 
    }
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

map.on('moveend', () => { document.getElementById('btn-search-area').style.display = 'block'; });
function triggerSearchArea() { loadDataForCurrentBounds(); }

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
    container.innerHTML = data.reviews.map(r => `<div class="review-card"><b style="color:#f59e0b;">★ ${r.rating}</b><br>${r.review_text.replace(/</g, "<").replace(/>/g, ">")}</div>`).join('') || "No text reviews.";
}
function closeReviewsList() { document.getElementById('reviewsListModal').style.display = 'none'; }

map.whenReady(() => findNearest());