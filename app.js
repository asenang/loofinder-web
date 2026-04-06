const map = L.map('map', { zoomControl: false }).setView([-37.8300, 144.8500], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);

const BACKEND_URL = "https://loofinder-api.onrender.com";
let allToiletData = { features: [] };
let ratingCache = {};
let userLocationMarker = null;
let currentMapLayer = null;
let activeFilters = { accessible: false, baby: false };

// Track unique ID alongside the name
let currentReviewFacilityId = "";
let currentReviewFacilityName = "";
let currentRating = 0;

// Custom Map Pin
const toiletIcon = L.divIcon({
    className: 'custom-pin',
    html: '<span class="material-symbols-outlined" style="font-size: 16px;">wc</span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
});

// --- Mobile Bottom Sheet Controls ---
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
}

function collapseSidebar() {
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.add('collapsed');
    }
}

// Collapse the sheet when the user drags the map
map.on('dragstart', collapseSidebar);

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

// --- Data Fetching (Comprehensive Detection) ---
async function loadDataForCurrentBounds() {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('btn-search-area').style.display = 'none';
    
    try {
        const bounds = map.getBounds();
        
        // Fetch Nodes, Ways, and Relations with tags, returning the center point
        const overpassQuery = `
            [out:json][timeout:25];
            (
              nwr["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
              way["building"]~".*"(~".*")(${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
            );
            out center tags;
        `;
        
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
        const data = await response.json();
        
        // Debug: Log first element to see what data we're getting
        if (data.elements && data.elements.length > 0) {
            console.log('Sample data:', data.elements[0]);
        }

        // Separate toilets and buildings
        const toilets = data.elements.filter(el => el.tags?.amenity === 'toilets');
        const buildings = data.elements.filter(el => el.tags?.building);
        
        allToiletData.features = toilets
            .filter(el => el.lat || el.center)
            .map(el => {
                const lat = el.lat || el.center.lat;
                const lon = el.lon || el.center.lon;
                
                // Find nearby building (within 50 meters)
                let nearbyBuilding = null;
                if (buildings.length > 0) {
                    nearbyBuilding = buildings.find(building => {
                        const buildingLat = building.lat || building.center?.lat;
                        const buildingLon = building.lon || building.center?.lon;
                        if (!buildingLat || !buildingLon) return false;
                        
                        const distance = Math.sqrt(
                            Math.pow(lat - buildingLat, 2) + 
                            Math.pow(lon - buildingLon, 2)
                        ) * 111000; // Rough conversion to meters
                        return distance <= 50; // 50 meters
                    });
                }
                
                // Build a descriptive name from available data
                let displayName = el.tags?.name;
                
                if (!displayName) {
                    // Try nearby building name first
                    if (nearbyBuilding?.tags?.name) {
                        displayName = nearbyBuilding.tags.name + " Toilet";
                    } else if (nearbyBuilding?.tags?.shop) {
                        displayName = nearbyBuilding.tags.shop + " Toilet";
                    } else if (nearbyBuilding?.tags?.amenity) {
                        displayName = nearbyBuilding.tags.amenity + " Toilet";
                    } else if (el.tags?.operator) {
                        displayName = el.tags.operator + " Toilet";
                    } else if (el.tags?.['addr:street'] && el.tags?.['addr:housenumber']) {
                        displayName = `${el.tags['addr:housenumber']} ${el.tags['addr:street']}`;
                    } else if (el.tags?.['addr:street']) {
                        displayName = el.tags['addr:street'];
                    } else if (nearbyBuilding?.tags?.building) {
                        const buildingType = nearbyBuilding.tags.building;
                        displayName = buildingType === 'yes' ? "Building Toilet" : buildingType + " Toilet";
                    } else {
                        displayName = "Public Toilet";
                    }
                }
                
                return {
                    type: "Feature",
                    properties: { 
                        id: el.id,
                        Name: displayName,
                        Accessible: el.tags?.wheelchair === 'yes', 
                        BabyChange: el.tags?.diaper === 'yes' || el.tags?.changing_table === 'yes',
                        rawTags: el.tags,
                        nearbyBuilding: nearbyBuilding?.tags?.name || null
                    },
                    geometry: { type: "Point", coordinates: [lon, lat] }
                };
            });
            
        renderMapPoints();
    } catch (e) { 
        console.error("Overpass API Error:", e); 
        showToast("Error finding toilets in this area.", "error");
    } finally { 
        document.getElementById('loader').style.display = 'none'; 
    }
}

// --- Map & Sidebar Rendering ---
function renderMapPoints() {
    if (currentMapLayer) map.removeLayer(currentMapLayer);
    const listContainer = document.getElementById('facility-list');
    listContainer.innerHTML = '';
    
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
        
        // Instant Pre-fetch Cache using the unique ID
        const facilityId = f.properties.id;
        if (!ratingCache[facilityId]) {
            fetch(`${BACKEND_URL}/api/reviews/${facilityId}`)
                .then(r => r.json()).then(d => {
                    ratingCache[facilityId] = d.reviews;
                    // Update display if popup is already open
                    const safeId = "rt-" + facilityId;
                    const el = document.getElementById(safeId);
                    if (el && d.reviews.length > 0) {
                        const avg = (d.reviews.reduce((s, r) => s + r.rating, 0) / d.reviews.length).toFixed(1);
                        el.innerHTML = `<span class="clickable-rating" onclick="openReviewsList('${facilityId}', '${f.properties.Name.replace(/'/g, "\\'")}')">
                            <span class="material-symbols-outlined" style="font-size:16px; color:#f59e0b;">star</span> ${avg} (${d.reviews.length})
                        </span>`;
                    } else if (el) {
                        el.innerHTML = `<span style="font-size:13px; font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">star_outline</span> No reviews yet</span>`;
                    }
                });
        }
    });

    displayFeatures.sort((a,b) => a.properties.dist - b.properties.dist);

    currentMapLayer = L.geoJSON({type: "FeatureCollection", features: displayFeatures}, {
        pointToLayer: function (feature, latlng) {
            return L.marker(latlng, {icon: toiletIcon});
        },
        onEachFeature: (f, l) => {
            const name = f.properties.Name;
            const facilityId = f.properties.id;
            const safeId = "rt-" + facilityId; 
            const lat = f.geometry.coordinates[1];
            const lng = f.geometry.coordinates[0];
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

            l.bindPopup(`
                <div style="font-weight:700; font-size:15px; color:#2c3e50;">${name}</div>
                <div id="${safeId}" style="color:#7f8c8d; margin:8px 0 12px 0;">Loading rating...</div>
                <div style="display: flex; gap: 8px;">
                    <a href="${mapsUrl}" target="_blank" class="btn-action-small btn-directions" style="flex:1;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
                    </a>
                    <button class="btn-action-small btn-rate" style="flex:1;" onclick="openModal('${facilityId}', '${name.replace(/'/g, "\\'")}')">
                        <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                    </button>
                </div>
            `);
            
            l.on('popupopen', () => {
                fetchAndDisplayRating(facilityId, name, safeId);
                collapseSidebar(); // Snaps the sheet down so you can see the popup
            });
            f.layerRef = l;
        }
    }).addTo(map);

    const top5Nearest = displayFeatures.slice(0, 5);
    
    top5Nearest.forEach(feature => {
        const name = feature.properties.Name;
        const facilityId = feature.properties.id;
        const accIcon = feature.properties.Accessible ? '<span class="material-symbols-outlined" title="Accessible" style="font-size:16px;">accessible</span>' : '';
        const babyIcon = feature.properties.BabyChange ? '<span class="material-symbols-outlined" title="Baby Change" style="font-size:16px;">baby_changing_station</span>' : '';
        const distanceKm = (feature.properties.dist / 1000).toFixed(2);
        
        const lat = feature.geometry.coordinates[1];
        const lng = feature.geometry.coordinates[0];
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

        const listItem = document.createElement('div');
        listItem.className = 'list-item';
        
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
                <button class="btn-action-small btn-rate" onclick="event.stopPropagation(); openModal('${facilityId}', '${name.replace(/'/g, "\\'")}')">
                    <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                </button>
            </div>
        `;
        
        listItem.onclick = () => {
            map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
            feature.layerReference.openPopup();
        };
        
        listContainer.appendChild(listItem);
    });
}

async function fetchAndDisplayRating(facilityId, name, htmlId) {
    const el = document.getElementById(htmlId);
    if (!el) return;
    
    try {
        // Always fetch fresh data to avoid stale cache issues
        const response = await fetch(`${BACKEND_URL}/api/reviews/${facilityId}`);
        const data = await response.json();
        const reviews = data.reviews || [];
        
        // Update cache
        ratingCache[facilityId] = reviews;
        
        if (reviews.length > 0) {
            const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
            el.innerHTML = `<span class="clickable-rating" onclick="openReviewsList('${facilityId}', '${name.replace(/'/g, "\\'")}')">
                <span class="material-symbols-outlined" style="font-size:16px; color:#f59e0b;">star</span> ${avg} (${reviews.length})
            </span>`;
        } else { 
            el.innerHTML = `<span style="font-size:13px; font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">star_outline</span> No reviews yet</span>`; 
        }
    } catch (error) {
        console.error("Error displaying rating:", error);
        el.innerHTML = `<span style="font-size:13px; color:#e74c3c;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">error</span> Rating unavailable</span>`;
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

function openModal(id, name) { 
    currentReviewFacilityId = id; 
    currentReviewFacilityName = name;
    document.getElementById('modalFacilityName').innerText = name; 
    document.getElementById('reviewModal').style.display = 'flex'; 
    currentRating = 0; 
    updateStarsUI(); 
}

function closeModal() { document.getElementById('reviewModal').style.display = 'none'; }
function setRating(r) { currentRating = r; updateStarsUI(); }
function updateStarsUI() { document.querySelectorAll('.star').forEach(s => s.classList.toggle('selected', parseInt(s.dataset.value) <= currentRating)); }

async function submitReview() {
    if (currentRating === 0) return showToast("Pick a star!", "error");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reviews`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ facility_id: currentReviewFacilityId.toString(), rating: currentRating, review_text: document.getElementById('reviewText').value })
        });
        if (res.ok) { 
            showToast("Review saved!", "success"); 
            closeModal(); 
            delete ratingCache[currentReviewFacilityId]; 
            loadDataForCurrentBounds(); 
        }
    } catch (e) { showToast("Error connecting.", "error"); }
}

async function openReviewsList(facilityId, name) {
    document.getElementById('reviewsListModal').style.display = 'flex';
    document.getElementById('listModalFacilityName').innerText = name + " Reviews";
    const container = document.getElementById('reviewsContainer');
    container.innerHTML = "Loading...";
    
    const res = await fetch(`${BACKEND_URL}/api/reviews/${facilityId}`);
    const data = await res.json();
    container.innerHTML = data.reviews.map(r => `<div class="review-card"><b style="color:#f59e0b;">★ ${r.rating}</b><br>${r.review_text.replace(/</g, "<").replace(/>/g, ">")}</div>`).join('') || "No text reviews.";
}
function closeReviewsList() { document.getElementById('reviewsListModal').style.display = 'none'; }

map.whenReady(() => findNearest());

// --- Mobile Drag-to-Expand Logic ---
const sidebarElement = document.querySelector('.sidebar');
const handleElement = document.querySelector('.mobile-handle');

let startY = 0;
let currentY = 0;
let startHeight = 0;
let isDragging = false;
let wasCollapsed = false;

handleElement.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    currentY = startY;
    startHeight = sidebarElement.getBoundingClientRect().height;
    wasCollapsed = sidebarElement.classList.contains('collapsed');
    isDragging = true;
    
    // Disable the smooth CSS transition so it sticks exactly to your finger
    sidebarElement.style.transition = 'none'; 
}, { passive: true });

handleElement.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;

    // THE FIX: The moment you drag UP, reveal the list so the card can physically stretch
    if (wasCollapsed && deltaY < 0) {
        sidebarElement.classList.remove('collapsed');
    }

    let newHeight = startHeight - deltaY;
    
    // Stop the card from stretching too high or crushing too low
    if (newHeight < 150) newHeight = 150; 
    if (newHeight > window.innerHeight * 0.65) newHeight = window.innerHeight * 0.65;

    // THE FIX: Apply actual height as well as max-height
    sidebarElement.style.height = `${newHeight}px`;
    sidebarElement.style.maxHeight = `${newHeight}px`;
}, { passive: true });

handleElement.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    
    // Hand control back to CSS for the final smooth snap
    sidebarElement.style.transition = ''; 
    sidebarElement.style.height = ''; 
    sidebarElement.style.maxHeight = ''; 
    
    const deltaY = currentY - startY;
    
    // Snap logic
    if (deltaY < -40) {
        sidebarElement.classList.remove('collapsed'); // Snap open
    } else if (deltaY > 40) {
        sidebarElement.classList.add('collapsed'); // Snap closed
    } else {
        // If they barely dragged it, snap it back to wherever it started
        if (wasCollapsed) {
            sidebarElement.classList.add('collapsed');
        } else {
            sidebarElement.classList.remove('collapsed');
        }
    }
});