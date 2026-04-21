const map = L.map('map', { zoomControl: false }).setView([-37.8300, 144.8500], 14);
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const savedTheme = localStorage.getItem('loofinder-theme');
let themeMode = savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : (prefersDark ? 'dark' : 'light');
let baseMapLayer = null;

function applyTheme(theme, persist = true) {
    themeMode = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('theme-dark', themeMode === 'dark');

    const iconEl = document.getElementById('theme-toggle-icon');
    if (iconEl) {
        iconEl.textContent = themeMode === 'dark' ? 'light_mode' : 'dark_mode';
    }

    if (baseMapLayer) {
        map.removeLayer(baseMapLayer);
    }

    baseMapLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/${themeMode === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
        { maxZoom: 20 }
    ).addTo(map);

    if (persist) {
        localStorage.setItem('loofinder-theme', themeMode);
    }
}

function toggleTheme() {
    applyTheme(themeMode === 'dark' ? 'light' : 'dark');
}

applyTheme(themeMode, false);

const supportMenuMobileEl = document.getElementById('support-menu-mobile');
const supportMenuToggleEl = document.getElementById('support-menu-toggle');

function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function setSupportMenuOpen(isOpen) {
    if (!supportMenuMobileEl || !supportMenuToggleEl) {
        return;
    }

    supportMenuMobileEl.classList.toggle('open', isOpen);
    supportMenuToggleEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    const dropdownEl = document.getElementById('support-menu-dropdown');
    if (dropdownEl) {
        dropdownEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
}

function syncSupportMenuForViewport() {
    if (!supportMenuMobileEl || !supportMenuToggleEl) {
        return;
    }

    if (!isMobileViewport()) {
        setSupportMenuOpen(false);
        return;
    }
}

if (supportMenuToggleEl) {
    supportMenuToggleEl.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const isOpen = supportMenuMobileEl && supportMenuMobileEl.classList.contains('open');
        setSupportMenuOpen(!isOpen);
    });
}

document.addEventListener('click', (event) => {
    if (!supportMenuMobileEl || !supportMenuMobileEl.classList.contains('open')) {
        return;
    }

    if (supportMenuMobileEl.contains(event.target)) {
        return;
    }

    setSupportMenuOpen(false);
});

window.addEventListener('resize', syncSupportMenuForViewport);
syncSupportMenuForViewport();

// Environment Configuration
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '';
const BACKEND_URL = IS_LOCAL ? "http://localhost:8000" : "https://loofinder-api.onrender.com";

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];
let allToiletData = { features: [] };
let ratingCache = {};
let ratingSummaryCache = {};
let userLocationMarker = null;
let currentMapLayer = null;
let activeFilters = { accessible: false, baby: false };
let disableFacilityNameSaves = false;
let backendUnavailable = false;
let currentLoadToken = 0;
let progressiveRenderTimer = null;
let feedbackSubmitting = false;
const RATING_SUMMARY_TTL_MS = 60 * 1000;
const ratingSummaryInFlight = new Set();

function markBackendUnavailable(reason) {
    if (!backendUnavailable) {
        console.warn(`Backend unavailable (${reason}). Running in limited mode.`);
    }
    backendUnavailable = true;
    disableFacilityNameSaves = true;
}

// Track unique ID alongside the name
let currentReviewFacilityId = "";
let currentReviewFacilityName = "";
let currentRating = 0;

// Escape HTML to prevent XSS from map data
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

// Custom Map Pin
const toiletIcon = L.divIcon({
    className: 'custom-pin',
    html: '<span class="material-symbols-outlined" style="font-size: 16px;">wc</span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
});

// --- Resolved Name Cache (from Backend) ---
const nameCache = {}; // Cache resolved names to avoid repeated API calls

// Get resolved name from backend (cached in database)
async function getResolvedNameFromBackend(facilityId) {
    if (backendUnavailable) {
        return null;
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/facilities/${facilityId}`);
        if (!response.ok) {
            if (response.status >= 500) {
                markBackendUnavailable('facility lookup');
            }
            return null;
        }

        const data = await response.json();
        if (data.facility && data.facility.resolved_name) {
            return data.facility.resolved_name;
        }
        return null;
    } catch {
        markBackendUnavailable('facility lookup');
        return null;
    }
}

let lastNominatimCall = 0;
// Geocode address from coordinates using Nominatim
async function geocodeAddress(lat, lon) {
    const now = Date.now();
    const timeToWait = Math.max(0, 1000 - (now - lastNominatimCall));
    if (timeToWait > 0) {
        await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
    lastNominatimCall = Date.now();

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: { 'User-Agent': 'LooFinder Web App' }
        });
        const data = await response.json();
        
        const addr = data.address;
        if (addr.house_number && addr.road) {
            return `${addr.house_number} ${addr.road}`;
        } else if (addr.road) {
            return addr.road;
        } else if (addr.suburb) {
            return addr.suburb;
        }
        return null;
    } catch (e) {
        console.error("Geocoding error:", e);
        return null;
    }
}

// Save resolved name to backend for caching
async function saveResolvedNameToBackend(facilityId, name, lat, lon) {
    if (disableFacilityNameSaves || backendUnavailable) {
        return;
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/facilities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: facilityId.toString(),
                name: name || "Public Toilet",
                resolved_name: name,
                latitude: lat,
                longitude: lon,
                accessible: false,
                baby_change: false
            })
        });

        if (!response.ok) {
            if (response.status >= 500) {
                markBackendUnavailable('facility save');
            }
            return;
        }
    } catch {
        markBackendUnavailable('facility save');
    }
}

// Get display name for a facility (with caching)
async function getDisplayName(facilityId, lat, lon) {
    // Check memory cache first
    if (nameCache[facilityId]) {
        return nameCache[facilityId];
    }
    
    // Check backend cache
    const cachedName = await getResolvedNameFromBackend(facilityId);
    if (cachedName) {
        nameCache[facilityId] = cachedName;
        return cachedName;
    }
    
    // Geocode and save to backend
    const geocodedName = await geocodeAddress(lat, lon);
    if (geocodedName) {
        nameCache[facilityId] = geocodedName;
        // Save to backend for future use (don't await, let it happen in background)
        saveResolvedNameToBackend(facilityId, geocodedName, lat, lon);
        return geocodedName;
    }
    
    return "Public Toilet";
}

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

async function fetchOverpassJson(query) {
    let lastError = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);

            if (!response.ok) {
                lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                continue;
            }

            return await response.json();
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("All Overpass endpoints failed");
}

function dedupeFeatures(features) {
    const byId = new Map();
    for (const feature of features) {
        byId.set(feature.properties.id, feature);
    }
    return Array.from(byId.values());
}

function elementsToFeatures(elements) {
    return elements
        .map((el) => {
            const lat = el.lat ?? el.center?.lat;
            const lon = el.lon ?? el.center?.lon;
            if (lat == null || lon == null) {
                return null;
            }

            const featureId = el.type === "node" ? el.id : `${el.type}-${el.id}`;

            return {
                type: "Feature",
                properties: {
                    id: featureId,
                    Name: "Public Toilet",
                    lat,
                    lon,
                    Accessible: false,
                    BabyChange: false
                },
                geometry: { type: "Point", coordinates: [lon, lat] }
            };
        })
        .filter(Boolean);
}

async function resolveNamesInBackground(loadToken, features) {
    for (const feature of features) {
        if (!feature || !feature.properties) continue;
        if (loadToken !== currentLoadToken) return;

        const props = feature.properties;
        const resolvedName = await getDisplayName(props.id, props.lat, props.lon);

        if (loadToken !== currentLoadToken) return;

        if (resolvedName && props.Name !== resolvedName) {
            props.Name = resolvedName;
            
            // Direct DOM update instead of full render
            const listTitleEl = document.getElementById(`list-title-${props.id}`);
            if (listTitleEl) listTitleEl.innerText = escapeHTML(resolvedName);
            
            // Re-bind popup
            if (feature.layerRef) {
                const safeName = escapeHTML(resolvedName);
                const safeId = "rt-" + props.id; 
                const lat = feature.geometry.coordinates[1];
                const lng = feature.geometry.coordinates[0];
                const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

                feature.layerRef.setPopupContent(`
                    <div class="popup-title">${safeName}</div>
                    <div id="${safeId}" class="popup-rating">${getRatingHtml(props.id, safeName, getCachedRatingSummary(props.id))}</div>
                    <div style="display: flex; gap: 8px;">
                        <a href="${mapsUrl}" target="_blank" class="btn-action-small btn-directions" style="flex:1;">
                            <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
                        </a>
                        <button class="btn-action-small btn-rate" style="flex:1;" onclick="openModal('${props.id}', '${safeName.replace(/'/g, "\\'")}')">
                            <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                        </button>
                    </div>
                `);
            }
        }
    }
}

// --- Data Fetching (Comprehensive Detection) ---
async function loadDataForCurrentBounds() {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('btn-search-area').style.display = 'none';

    const loadToken = ++currentLoadToken;
    const bounds = map.getBounds();
    
    try {
        const query = `
            [out:json][timeout:15];
            (
              node["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
              way["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
              relation["amenity"="toilets"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
            );
            out center;
        `;

        let data = null;
        try {
            data = await fetchOverpassJson(query);
        } catch (primaryError) {
            const center = map.getCenter();
            const fallbackQuery = `
                [out:json][timeout:15];
                (
                  node["amenity"="toilets"](around:2500,${center.lat},${center.lng});
                  way["amenity"="toilets"](around:2500,${center.lat},${center.lng});
                  relation["amenity"="toilets"](around:2500,${center.lat},${center.lng});
                );
                out center;
            `;
            data = await fetchOverpassJson(fallbackQuery);
            console.warn("BBox query failed, used wider center-radius fallback.", primaryError);
        }

        if (loadToken !== currentLoadToken) {
            return;
        }

        allToiletData.features = dedupeFeatures(elementsToFeatures(data.elements || []));
        renderMapPoints();

        resolveNamesInBackground(loadToken, allToiletData.features).catch((error) => {
            console.error("Background name resolution failed:", error);
        });

    } catch (e) { 
        console.error("Overpass API Error:", e); 
        showToast("Error finding toilets in this area. Try zooming in or moving to a different area.", "error");
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
    });

    displayFeatures.sort((a,b) => a.properties.dist - b.properties.dist);

    fetchRatingSummaries(displayFeatures.map(f => f.properties.id)).then((updated) => {
        if (updated) {
            displayFeatures.forEach(feature => {
                const facilityId = feature.properties.id;
                const summary = getCachedRatingSummary(facilityId);
                if (summary) {
                    const listRatingEl = document.getElementById(`list-rating-${facilityId}`);
                    if (listRatingEl) {
                        listRatingEl.innerHTML = getListRatingHtml(facilityId, summary);
                    }
                    const popupRatingEl = document.getElementById(`rt-${facilityId}`);
                    if (popupRatingEl) {
                        popupRatingEl.innerHTML = getRatingHtml(facilityId, escapeHTML(feature.properties.Name), summary);
                    }
                }
            });
        }
    });

    currentMapLayer = L.geoJSON({type: "FeatureCollection", features: displayFeatures}, {
        pointToLayer: function (feature, latlng) {
            return L.marker(latlng, {icon: toiletIcon});
        },
        onEachFeature: (f, l) => {
            const name = f.properties.Name;
            const safeName = escapeHTML(name);
            const facilityId = f.properties.id;
            const safeId = "rt-" + facilityId; 
            const lat = f.geometry.coordinates[1];
            const lng = f.geometry.coordinates[0];
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

            l.bindPopup(`
                <div class="popup-title">${safeName}</div>
                <div id="${safeId}" class="popup-rating">${getRatingHtml(facilityId, safeName, getCachedRatingSummary(facilityId))}</div>
                <div style="display: flex; gap: 8px;">
                    <a href="${mapsUrl}" target="_blank" class="btn-action-small btn-directions" style="flex:1;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
                    </a>
                    <button class="btn-action-small btn-rate" style="flex:1;" onclick="openModal('${facilityId}', '${safeName.replace(/'/g, "\\'")}')">
                        <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                    </button>
                </div>
            `);
            
            l.on('popupopen', () => {
                fetchAndDisplayRating(facilityId, safeName, safeId);
                collapseSidebar(); // Snaps the sheet down so you can see the popup
            });
            f.layerRef = l;
        }
    }).addTo(map);

    const top5Nearest = displayFeatures.slice(0, 5);
    
    top5Nearest.forEach(feature => {
        const name = feature.properties.Name;
        const safeName = escapeHTML(name);
        const facilityId = feature.properties.id;
        const ratingSummary = getCachedRatingSummary(facilityId);
        const listRatingHtml = getListRatingHtml(facilityId, ratingSummary);
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
                <div id="list-title-${facilityId}" class="list-item-title">${safeName}</div>
                <div class="distance-badge">${distanceKm} km</div>
            </div>
            <div id="list-rating-${facilityId}" class="list-item-rating">${listRatingHtml}</div>
            <div class="list-item-features">${accIcon} ${babyIcon}</div>
            <div class="list-item-actions">
                <a href="${mapsUrl}" target="_blank" class="btn-action-small btn-directions" onclick="event.stopPropagation();">
                    <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
                </a>
                <button class="btn-action-small btn-rate" onclick="event.stopPropagation(); openModal('${facilityId}', '${safeName.replace(/'/g, "\\'")}')">
                    <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
                </button>
            </div>
        `;
        
        listItem.onclick = () => {
            map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
            if (feature.layerRef) {
                feature.layerRef.openPopup();
            }
        };
        
        listContainer.appendChild(listItem);
    });
}

function getCachedRatingSummary(facilityId) {
    const summary = ratingSummaryCache[facilityId];
    if (!summary) {
        return null;
    }

    if (Date.now() - summary.fetchedAt > RATING_SUMMARY_TTL_MS) {
        return null;
    }

    return summary;
}

function getRatingHtml(facilityId, safeName, summary) {
    if (!summary || !summary.review_count) {
        return `<div class="empty-state-rating" onclick="openModal('${facilityId}', '${safeName.replace(/'/g, "\\'")}')">
                    <span class="material-symbols-outlined">add_comment</span>
                    <span>Be the first to review!</span>
                </div>`;
    }

    const avg = Number(summary.avg_rating || 0).toFixed(1);
    return `<span class="clickable-rating" onclick="openReviewsList('${facilityId}', '${safeName.replace(/'/g, "\\'")}')">
                <span class="material-symbols-outlined" style="font-size:16px; color:#f59e0b;">star</span> ${avg} (${summary.review_count})
            </span>`;
}

function getListRatingHtml(facilityId, summary) {
    if (summary && summary.review_count) {
        const avg = Number(summary.avg_rating || 0).toFixed(1);
        return `<span class="score">★ ${avg}</span> <span class="count">(${summary.review_count})</span>`;
    }

    if (ratingSummaryInFlight.has(facilityId)) {
        return `<span class="pending">Loading rating...</span>`;
    }

    return `<span class="empty-actionable">No reviews - Add one!</span>`;
}

async function fetchRatingSummaries(facilityIds, force = false) {
    if (backendUnavailable) {
        return false;
    }

    const ids = Array.from(new Set((facilityIds || []).filter(Boolean).map(id => id.toString())));
    if (ids.length === 0) {
        return false;
    }

    const now = Date.now();
    const idsToFetch = ids.filter((id) => {
        if (ratingSummaryInFlight.has(id)) {
            return false;
        }
        if (force) {
            return true;
        }
        const cached = ratingSummaryCache[id];
        return !cached || (now - cached.fetchedAt > RATING_SUMMARY_TTL_MS);
    });

    if (idsToFetch.length === 0) {
        return false;
    }

    idsToFetch.forEach((id) => ratingSummaryInFlight.add(id));

    try {
        const response = await fetch(`${BACKEND_URL}/api/reviews-summary?ids=${encodeURIComponent(idsToFetch.join(','))}`);
        if (!response.ok) {
            if (response.status >= 500) {
                markBackendUnavailable('rating summaries');
            }
            return false;
        }

        const data = await response.json();
        const summaries = data.summaries || {};
        const fetchedAt = Date.now();

        idsToFetch.forEach((facilityId) => {
            const summary = summaries[facilityId] || { review_count: 0, avg_rating: 0 };
            ratingSummaryCache[facilityId] = {
                review_count: Number(summary.review_count || 0),
                avg_rating: Number(summary.avg_rating || 0),
                fetchedAt,
            };
        });

        return true;
    } catch {
        markBackendUnavailable('rating summaries');
        return false;
    } finally {
        idsToFetch.forEach((id) => ratingSummaryInFlight.delete(id));
    }
}

async function waitForRatingSummaryInFlight(facilityId, timeoutMs = 3000) {
    const startedAt = Date.now();

    while (ratingSummaryInFlight.has(facilityId) && (Date.now() - startedAt) < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 80));
    }

    return getCachedRatingSummary(facilityId);
}

async function fetchAndDisplayRating(facilityId, name, htmlId) {
    const el = document.getElementById(htmlId);
    if (!el) return;

    const cachedSummary = getCachedRatingSummary(facilityId);
    if (cachedSummary) {
        el.innerHTML = getRatingHtml(facilityId, name, cachedSummary);
        return;
    }

    el.innerHTML = `<span style="font-size:13px; font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">hourglass_top</span> Loading rating...</span>`;
    const updated = await fetchRatingSummaries([facilityId], true);

    let summary = getCachedRatingSummary(facilityId);
    if (!summary && ratingSummaryInFlight.has(facilityId)) {
        summary = await waitForRatingSummaryInFlight(facilityId);
    }

    if (summary) {
        el.innerHTML = getRatingHtml(facilityId, name, summary);
        return;
    }

    if (!updated) {
        el.innerHTML = `<span style="font-size:13px; color:#e74c3c;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">error</span> Rating unavailable</span>`;
        return;
    }

    el.innerHTML = getRatingHtml(facilityId, name, getCachedRatingSummary(facilityId));
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

function openFeedbackModal() {
    const modalEl = document.getElementById('feedbackModal');
    if (!modalEl) {
        return;
    }

    setSupportMenuOpen(false);
    modalEl.style.display = 'flex';
}

function closeFeedbackModal() {
    const modalEl = document.getElementById('feedbackModal');
    if (!modalEl) {
        return;
    }

    modalEl.style.display = 'none';
}

async function submitFeedback() {
    if (feedbackSubmitting) {
        return;
    }

    const messageEl = document.getElementById('feedbackText');
    const emailEl = document.getElementById('feedbackEmail');
    const message = (messageEl?.value || '').trim();
    const email = (emailEl?.value || '').trim();

    if (message.length < 10) {
        showToast('Please add at least 10 characters.', 'error');
        return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('Please enter a valid email.', 'error');
        return;
    }

    feedbackSubmitting = true;
    try {
        const res = await fetch(`${BACKEND_URL}/api/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                message,
                context: {
                    page: window.location.href,
                    user_agent: navigator.userAgent,
                    theme: themeMode
                }
            })
        });

        if (!res.ok) {
            throw new Error('request failed');
        }

        showToast('Feedback sent. Thank you!', 'success');
        if (messageEl) {
            messageEl.value = '';
        }
        if (emailEl) {
            emailEl.value = '';
        }
        closeFeedbackModal();
    } catch (e) {
        showToast('Unable to send feedback right now.', 'error');
    } finally {
        feedbackSubmitting = false;
    }
}

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
            delete ratingSummaryCache[currentReviewFacilityId];
            loadDataForCurrentBounds(); 
        }
    } catch (e) { showToast("Error connecting.", "error"); }
}

async function openReviewsList(facilityId, name) {
    document.getElementById('reviewsListModal').style.display = 'flex';
    document.getElementById('listModalFacilityName').innerText = name + " Reviews";
    const container = document.getElementById('reviewsContainer');
    container.innerHTML = "Loading...";
    
    try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${facilityId}`);
        if (!res.ok) {
            container.textContent = "Reviews unavailable right now.";
            return;
        }

        const data = await res.json();
        const reviews = Array.isArray(data.reviews) ? data.reviews : [];

        container.innerHTML = "";
        if (reviews.length === 0) {
            container.textContent = "No text reviews.";
            return;
        }

        reviews.forEach((review) => {
            const card = document.createElement('div');
            card.className = 'review-card';

            const ratingEl = document.createElement('b');
            ratingEl.style.color = '#f59e0b';
            const safeRating = Number.isFinite(Number(review.rating)) ? Number(review.rating) : 0;
            ratingEl.textContent = `★ ${safeRating}`;

            const br = document.createElement('br');
            const textNode = document.createTextNode(review.review_text || '');

            card.appendChild(ratingEl);
            card.appendChild(br);
            card.appendChild(textNode);
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading reviews:', error);
        container.textContent = "Reviews unavailable right now.";
    }
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