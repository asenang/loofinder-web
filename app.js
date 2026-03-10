const map = L.map('map', { zoomControl: false }).setView([-37.8300, 144.8500], 14);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 20
}).addTo(map);

let allToiletData = { type: "FeatureCollection", features: [] }; 
let currentMapLayer = null;
let activeFilters = { accessible: false, baby: false };
let currentReviewFacility = "";
let currentRating = 0;

// Update this with your live backend URL! Make sure there is NO trailing slash.
const BACKEND_URL = "https://loofinder-api.onrender.com";

// --- Custom Notification System ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// --- Data Fetching ---
async function loadDataForCurrentBounds() {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('btn-search-area').style.display = 'none';
    allToiletData.features = []; 

    try {
        const mockGovData = [
            { "type": "Feature", "properties": { "Name": "Altona Beach Facilities", "Accessible": true, "BabyChange": false, "Source": "Gov" }, "geometry": { "type": "Point", "coordinates": [144.8295, -37.8715] } },
            { "type": "Feature", "properties": { "Name": "Cherry Lake Reserve", "Accessible": true, "BabyChange": true, "Source": "Gov" }, "geometry": { "type": "Point", "coordinates": [144.8350, -37.8590] } }
        ];
        allToiletData.features.push(...mockGovData);

        const bounds = map.getBounds();
        const overpassQuery = `
            [out:json][timeout:25];
            node["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
            out body;
        `;
        const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
        
        const osmResponse = await fetch(overpassUrl);
        const osmData = await osmResponse.json();

        const osmFeatures = osmData.elements.map(node => {
            const isAccessible = node.tags.wheelchair === 'yes';
            const hasBabyChange = node.tags.changing_table === 'yes' || node.tags.diaper === 'yes';
            return {
                "type": "Feature",
                "properties": { "Name": node.tags.name || "Public Toilet", "Accessible": isAccessible, "BabyChange": hasBabyChange, "Source": "OSM" },
                "geometry": { "type": "Point", "coordinates": [node.lon, node.lat] }
            };
        });

        allToiletData.features.push(...osmFeatures);
        renderMapPoints();
    } catch (error) {
        console.error("Map data error:", error);
    } finally {
        document.getElementById('loader').style.display = 'none';
    }
}

// --- Map Rendering & Sidebar ---
function toggleFilter(filterType) {
    activeFilters[filterType] = !activeFilters[filterType];
    document.getElementById('chip-' + filterType).classList.toggle('active');
    renderMapPoints();
}

function renderMapPoints() {
    if (currentMapLayer) map.removeLayer(currentMapLayer);

    const listContainer = document.getElementById('facility-list');
    listContainer.innerHTML = ''; 

    // 1. Get current location (center of the map view)
    const currentCenter = map.getCenter();

    // 2. Filter features based on accessible/baby buttons
    let displayFeatures = allToiletData.features.filter(feature => {
        if (activeFilters.accessible && feature.properties.Accessible !== true) return false;
        if (activeFilters.baby && feature.properties.BabyChange !== true) return false;
        return true;
    });

    if (displayFeatures.length === 0) {
        listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #7f8c8d;">No facilities found in this area. Try moving the map!</div>';
        return;
    }

    // 3. Calculate distance for every toilet (in meters)
    displayFeatures.forEach(feature => {
        const toiletLatLng = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
        feature.properties.distanceMeters = map.distance(currentCenter, toiletLatLng);
    });

    // 4. Sort the list from closest to furthest
    displayFeatures.sort((a, b) => a.properties.distanceMeters - b.properties.distanceMeters);

    // 5. Draw the Map Pins
    currentMapLayer = L.geoJSON({ type: "FeatureCollection", features: displayFeatures }, {
        onEachFeature: function (feature, layer) {
            const name = feature.properties.Name;
            const accIcon = feature.properties.Accessible ? '♿' : '';
            const babyIcon = feature.properties.BabyChange ? '👶' : '';
            const sourceIcon = feature.properties.Source === 'Gov' ? '🏛️ Official' : '🗺️ Community';
            
            const lng = feature.geometry.coordinates[0];
            const lat = feature.geometry.coordinates[1];
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
            const safeId = "rating-" + name.replace(/[^a-zA-Z0-9]/g, '');
            const safeName = name.replace(/'/g, "\\'");

            layer.bindPopup(`
                <div class="toilet-title">${name}</div>
                <div id="${safeId}" style="font-size: 13px; color: #f59e0b; font-weight: 700; margin-bottom: 6px;">
                    ⏳ Loading rating...
                </div>
                <div class="toilet-features">${accIcon} ${babyIcon} <span style="color:#7f8c8d; font-weight:normal; margin-left:8px;">${sourceIcon}</span></div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-review-small" style="flex: 1;" onclick="openModal('${safeName}')">⭐ Rate</button>
                    <a href="${mapsUrl}" target="_blank" style="flex: 1; text-align: center; text-decoration: none; background: #e2e8f0; color: #2c3e50; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">🚶 Route</a>
                </div>
            `);

            layer.on('popupopen', () => fetchAndDisplayRating(name, safeId));
            
            // Save reference to open it later via the list
            feature.layerReference = layer; 
        }
    }).addTo(map);

    // 6. Draw the Sidebar List (Only take the top 5 nearest)
    const top5Nearest = displayFeatures.slice(0, 5);
    
    top5Nearest.forEach(feature => {
        const name = feature.properties.Name;
        const accIcon = feature.properties.Accessible ? '♿' : '';
        const babyIcon = feature.properties.BabyChange ? '👶' : '';
        const sourceIcon = feature.properties.Source === 'Gov' ? '🏛️ Official' : '';
        
        // Convert meters to kilometers and format
        const distanceKm = (feature.properties.distanceMeters / 1000).toFixed(2);

        const listItem = document.createElement('div');
        listItem.className = 'list-item';
        listItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div class="list-item-title">${name}</div>
                <div style="font-size: 12px; font-weight: 600; color: #007aff; background: #eef2ff; padding: 3px 8px; border-radius: 12px; white-space: nowrap;">${distanceKm} km</div>
            </div>
            <div class="list-item-features">${accIcon} ${babyIcon} <span style="margin-left:8px;">${sourceIcon}</span></div>
        `;
        
        listItem.onclick = () => {
            const lat = feature.geometry.coordinates[1];
            const lng = feature.geometry.coordinates[0];
            
            map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
            feature.layerReference.openPopup();
            
            if (window.innerWidth <= 768) window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        
        listContainer.appendChild(listItem);
    });
}

map.whenReady(() => loadDataForCurrentBounds());
map.on('moveend', () => { document.getElementById('btn-search-area').style.display = 'block'; });
function triggerSearchArea() { loadDataForCurrentBounds(); }

function findNearest() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            // This updates the map center, naturally triggering the distance recalculation next
            map.flyTo([position.coords.latitude, position.coords.longitude], 15, { animate: true, duration: 1.5 });
            setTimeout(loadDataForCurrentBounds, 1600);
        });
    } else showToast("Geolocation is not supported by your browser.", "error");
}

// --- Submit Review Modal ---
function openModal(facilityName) {
    currentReviewFacility = facilityName;
    document.getElementById('modalFacilityName').innerText = "Reviewing: " + facilityName;
    document.getElementById('reviewModal').style.display = 'flex';
    currentRating = 0; document.getElementById('reviewText').value = ""; updateStarsUI();
}
function closeModal() { document.getElementById('reviewModal').style.display = 'none'; }
function setRating(rating) { currentRating = rating; updateStarsUI(); }
function updateStarsUI() {
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        if (parseInt(star.getAttribute('data-value')) <= currentRating) star.classList.add('selected');
        else star.classList.remove('selected');
    });
}

async function submitReview() {
    if (currentRating === 0) return showToast("Please select a star rating first!", "error");

    const payload = {
        facility_name: currentReviewFacility,
        rating: currentRating,
        review_text: document.getElementById('reviewText').value
    };

    try {
        const response = await fetch(`${BACKEND_URL}/api/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showToast("Thanks! Your review has been saved.", "success");
            closeModal(); map.closePopup();
        } else showToast("Error saving review. Please try again.", "error");
    } catch (error) {
        console.error("Network Error:", error);
        showToast("Could not connect to the backend.", "error");
    }
}

// --- View Reviews Modal ---
async function fetchAndDisplayRating(facilityName, elementId) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(facilityName)}`);
        const data = await response.json();
        
        const ratingElement = document.getElementById(elementId);
        if (!ratingElement) return;

        if (data.reviews && data.reviews.length > 0) {
            const totalStars = data.reviews.reduce((sum, rev) => sum + rev.rating, 0);
            const average = (totalStars / data.reviews.length).toFixed(1);
            const safeName = facilityName.replace(/'/g, "\\'"); 
            ratingElement.innerHTML = `<span class="clickable-rating" onclick="openReviewsList('${safeName}')">⭐ ${average} / 5.0 (${data.reviews.length} reviews)</span>`;
        } else {
            ratingElement.innerHTML = `⭐ No reviews yet`;
        }
    } catch (error) {
        console.error("Failed to fetch reviews:", error);
        const ratingElement = document.getElementById(elementId);
        if (ratingElement) ratingElement.innerHTML = `⭐ Rating unavailable`;
    }
}

async function openReviewsList(facilityName) {
    document.getElementById('listModalFacilityName').innerText = facilityName + " Reviews";
    const container = document.getElementById('reviewsContainer');
    container.innerHTML = `<div style="text-align:center; padding: 20px; color: #7f8c8d;">⏳ Loading reviews...</div>`;
    document.getElementById('reviewsListModal').style.display = 'flex';

    try {
        const response = await fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(facilityName)}`);
        const data = await response.json();

        if (data.reviews && data.reviews.length > 0) {
            container.innerHTML = data.reviews.reverse().map(rev => {
                const stars = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);
                const safeText = rev.review_text ? rev.review_text.replace(/</g, "<").replace(/>/g, ">") : "<em>No written review provided.</em>";
                return `
                    <div class="review-card">
                        <div class="review-card-header"><span class="review-card-stars">${stars}</span></div>
                        <div>${safeText}</div>
                    </div>
                `;
            }).join('');
        } else container.innerHTML = `<div style="text-align:center; padding: 20px; color: #7f8c8d;">No reviews found.</div>`;
    } catch (error) {
        container.innerHTML = `<div style="text-align:center; padding: 20px; color: #ef4444;">Failed to load reviews.</div>`;
    }
}
function closeReviewsList() { document.getElementById('reviewsListModal').style.display = 'none'; }