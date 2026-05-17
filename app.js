// Initialize map with default coordinates (will be updated to user location if available)
const map = L.map('map', { zoomControl: false }).setView([-37.8300, 144.8500], 14);
const savedTheme = localStorage.getItem('loofinder-theme');
let baseMapLayer = null;
let userLat = -37.8300; // Default to Melbourne
let userLng = 144.8500;  // Default to Melbourne
let themeUpdateInterval = null;

// Calculate sunrise/sunset times (UTC) for the given date using NOAA-style approximation.
// Returns { sunrise, sunset } as Date objects in UTC. Null means polar day/night.
function calculateSunriseSunset(lat, lng, date) {
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;

    // Day of year (1-366), UTC-based to avoid TZ drift
    const startOfYearUTC = Date.UTC(date.getUTCFullYear(), 0, 0);
    const dayOfYear = Math.floor((date.getTime() - startOfYearUTC) / 86400000);

    // Solar declination (radians)
    const P = Math.asin(0.39795 * Math.cos(0.98563 * (dayOfYear - 173) * rad));

    // Hour angle (radians). Argument can exceed [-1, 1] near poles -> polar day/night.
    const cosH = (Math.sin(-0.83 * rad) - Math.sin(lat * rad) * Math.sin(P)) /
                 (Math.cos(lat * rad) * Math.cos(P));
    if (cosH > 1 || cosH < -1) {
        return { sunrise: null, sunset: null };
    }
    const hourAngleDeg = Math.acos(cosH) * deg;

    // Solar noon (UTC hours) at this longitude
    const solarNoonUTC = 12 - lng / 15;
    const sunriseUTC = solarNoonUTC - hourAngleDeg / 15;
    const sunsetUTC = solarNoonUTC + hourAngleDeg / 15;

    const toDate = (utcHours) => {
        const ms = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) +
                   utcHours * 3600 * 1000;
        return new Date(ms);
    };

    return { sunrise: toDate(sunriseUTC), sunset: toDate(sunsetUTC) };
}

// Determine if it's currently nighttime based on location
function isNighttime(lat, lng) {
    const now = new Date();
    const { sunrise, sunset } = calculateSunriseSunset(lat, lng, now);

    // Polar day/night fallback: use latitude sign + month hemisphere heuristic
    if (!sunrise || !sunset) {
        const hour = now.getHours();
        return hour < 6 || hour >= 19;
    }

    // 30 min buffer after sunset
    const sunsetWithBuffer = new Date(sunset.getTime() + 30 * 60 * 1000);
    return now < sunrise || now > sunsetWithBuffer;
}

// Get theme based on time of day and location
function getTimeBasedTheme(lat, lng) {
    return isNighttime(lat, lng) ? 'dark' : 'light';
}

// Check if coordinates are within Australia (approximate bounding box)
function isWithinAustralia(lat, lng) {
    // Australia approximate bounding box
    const AUS_BOUNDS = {
        north: -10.0,   // Northern tip (Cape York)
        south: -43.5,   // Southern tip (Tasmania)
        east: 153.5,    // Easternmost point (Cape Byron)
        west: 113.0     // Westernmost point (Western Australia)
    };
    
    return lat >= AUS_BOUNDS.south && 
           lat <= AUS_BOUNDS.north && 
           lng >= AUS_BOUNDS.west && 
           lng <= AUS_BOUNDS.east;
}

// Show location error modal for users outside Australia
function showLocationErrorModal() {
    const modalEl = document.getElementById('locationErrorModal');
    if (modalEl) {
        openModalOverlay(modalEl, {
            initialFocusSelector: '.btn-primary',
            onClose: hideLocationErrorModal
        });
    }
}

// Hide location error modal
function hideLocationErrorModal() {
    const modalEl = document.getElementById('locationErrorModal');
    if (modalEl) {
        closeModalOverlay(modalEl);
    }
}

// Continue anyway despite location warning
function continueAnyway() {
    hideLocationErrorModal();
    // User has chosen to continue, don't show this warning again for this session
    sessionStorage.setItem('locationWarningDismissed', 'true');
}

// Update theme based on current time and location
function updateTimeBasedTheme() {
    const timeBasedTheme = getTimeBasedTheme(userLat, userLng);
    
    // Only update if user hasn't manually set a theme preference
    if (!savedTheme || (savedTheme !== 'dark' && savedTheme !== 'light')) {
        applyTheme(timeBasedTheme, false); // Don't persist time-based theme
    }
}

// Initialize theme mode
let themeMode;
if (savedTheme === 'dark' || savedTheme === 'light') {
    // User has manually set a preference
    themeMode = savedTheme;
} else {
    // Use time-based theme as default
    themeMode = getTimeBasedTheme(userLat, userLng);
}

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
const supportMenuDropdownEl = document.getElementById('support-menu-dropdown');
const supportDesktopMenuEl = document.getElementById('support-desktop-menu');
const supportDesktopToggleEl = document.getElementById('support-desktop-toggle');
const supportDesktopDropdownEl = document.getElementById('support-desktop-dropdown');

let activeModalEl = null;
let activeModalCloseHandler = null;
let lastFocusedElement = null;

function getFocusableElements(container) {
    if (!container) {
        return [];
    }
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter((el) => {
        if (el.getAttribute('aria-hidden') === 'true' || el.inert) {
            return false;
        }
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
}

function getMenuItems(menuEl) {
    if (!menuEl) {
        return [];
    }
    return Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
}

function focusFirstMenuItem(menuEl) {
    const [first] = getMenuItems(menuEl);
    if (first) {
        first.focus();
    }
}

function moveMenuFocus(menuEl, direction) {
    const items = getMenuItems(menuEl);
    if (items.length === 0) {
        return;
    }
    const currentIndex = items.indexOf(document.activeElement);
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (startIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
}

function handleMenuKeydown(event, menuEl) {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveMenuFocus(menuEl, 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveMenuFocus(menuEl, -1);
    } else if (event.key === 'Home') {
        event.preventDefault();
        const [first] = getMenuItems(menuEl);
        if (first) {
            first.focus();
        }
    } else if (event.key === 'End') {
        event.preventDefault();
        const items = getMenuItems(menuEl);
        const last = items[items.length - 1];
        if (last) {
            last.focus();
        }
    }
}

function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function setSupportDesktopMenuOpen(isOpen) {
    if (!supportDesktopMenuEl || !supportDesktopToggleEl || !supportDesktopDropdownEl) {
        return;
    }

    supportDesktopMenuEl.classList.toggle('is-open', isOpen);
    supportDesktopToggleEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    supportDesktopDropdownEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function setSupportMenuOpen(isOpen) {
    if (!supportMenuMobileEl || !supportMenuToggleEl) {
        return;
    }

    supportMenuMobileEl.classList.toggle('open', isOpen);
    supportMenuToggleEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (supportMenuDropdownEl) {
        supportMenuDropdownEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
}

function syncSupportMenuForViewport() {
    if (isMobileViewport()) {
        setSupportDesktopMenuOpen(false);
    } else {
        setSupportMenuOpen(false);
    }
}

if (supportMenuToggleEl) {
    supportMenuToggleEl.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const isOpen = supportMenuMobileEl && supportMenuMobileEl.classList.contains('open');
        setSupportMenuOpen(!isOpen);
    });

    supportMenuToggleEl.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSupportMenuOpen(true);
            focusFirstMenuItem(supportMenuDropdownEl);
        } else if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            const isOpen = supportMenuMobileEl && supportMenuMobileEl.classList.contains('open');
            setSupportMenuOpen(!isOpen);
            if (!isOpen) {
                focusFirstMenuItem(supportMenuDropdownEl);
            }
        } else if (event.key === 'Escape') {
            setSupportMenuOpen(false);
        }
    });
}

if (supportMenuDropdownEl) {
    supportMenuDropdownEl.addEventListener('keydown', (event) => {
        handleMenuKeydown(event, supportMenuDropdownEl);
        if (event.key === 'Escape') {
            event.preventDefault();
            setSupportMenuOpen(false);
            supportMenuToggleEl?.focus();
        }
    });
}

if (supportDesktopMenuEl) {
    supportDesktopMenuEl.addEventListener('mouseenter', () => setSupportDesktopMenuOpen(true));
    supportDesktopMenuEl.addEventListener('mouseleave', () => setSupportDesktopMenuOpen(false));
    supportDesktopMenuEl.addEventListener('focusin', () => setSupportDesktopMenuOpen(true));
    supportDesktopMenuEl.addEventListener('focusout', (event) => {
        if (!supportDesktopMenuEl.contains(event.relatedTarget)) {
            setSupportDesktopMenuOpen(false);
        }
    });
}

if (supportDesktopToggleEl) {
    supportDesktopToggleEl.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSupportDesktopMenuOpen(true);
            focusFirstMenuItem(supportDesktopDropdownEl);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setSupportDesktopMenuOpen(false);
        }
    });
}

if (supportDesktopDropdownEl) {
    supportDesktopDropdownEl.addEventListener('keydown', (event) => {
        handleMenuKeydown(event, supportDesktopDropdownEl);
        if (event.key === 'Escape') {
            event.preventDefault();
            setSupportDesktopMenuOpen(false);
            supportDesktopToggleEl?.focus();
        }
    });
}

document.addEventListener('click', (event) => {
    if (supportMenuMobileEl && supportMenuMobileEl.classList.contains('open') && !supportMenuMobileEl.contains(event.target)) {
        setSupportMenuOpen(false);
    }

    if (supportDesktopMenuEl && supportDesktopMenuEl.classList.contains('is-open') && !supportDesktopMenuEl.contains(event.target)) {
        setSupportDesktopMenuOpen(false);
    }
});

function trapFocusInActiveModal(event) {
    const focusableElements = getFocusableElements(activeModalEl);
    if (focusableElements.length === 0) {
        event.preventDefault();
        return;
    }

    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];
    const isOnFirst = document.activeElement === firstEl;
    const isOnLast = document.activeElement === lastEl;

    if (event.shiftKey && isOnFirst) {
        event.preventDefault();
        lastEl.focus();
    } else if (!event.shiftKey && isOnLast) {
        event.preventDefault();
        firstEl.focus();
    }
}

document.addEventListener('keydown', (event) => {
    if (activeModalEl) {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (activeModalCloseHandler) {
                activeModalCloseHandler();
            }
            return;
        }

        if (event.key === 'Tab') {
            trapFocusInActiveModal(event);
        }
        return;
    }

    if (event.key === 'Escape') {
        setSupportMenuOpen(false);
        setSupportDesktopMenuOpen(false);
    }
});

window.addEventListener('resize', syncSupportMenuForViewport);
syncSupportMenuForViewport();

// Environment Configuration
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '';
const BACKEND_URL = IS_LOCAL ? "http://localhost:8000" : "https://loofinder-api.onrender.com";
const APP_VERSION = "11.7";

function getAnalyticsSessionId() {
    const key = 'loofinder-analytics-session-id';
    let id = sessionStorage.getItem(key);
    if (!id) {
        id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(key, id);
    }
    return id;
}

function trackEvent(eventName, properties = {}) {
    if (!eventName) return;

    const payload = JSON.stringify({
        event_name: eventName,
        session_id: getAnalyticsSessionId(),
        app_version: APP_VERSION,
        path: window.location.pathname,
        referrer: document.referrer || null,
        properties
    });

    const url = `${BACKEND_URL}/api/analytics/events`;
    try {
        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
            return;
        }
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(() => {});
    } catch {}
}

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];
let allToiletData = { features: [] };
let ratingCache = {};
let ratingSummaryCache = {};
let userLocationMarker = null;
let currentMapLayer = null;
let activeFilters = { accessible: false, baby: false, free: false, unisex: false };
let disableFacilityNameSaves = false;
let backendUnavailable = false;
let backendRetryAfterMs = 0;
let currentLoadToken = 0;
let progressiveRenderTimer = null;
let feedbackSubmitting = false;
const RATING_SUMMARY_TTL_MS = 60 * 1000;
const BACKEND_RECOVERY_RETRY_MS = 30 * 1000;
const ratingSummaryInFlight = new Set();

function shouldAttemptBackendRequest() {
    return !backendUnavailable || Date.now() >= backendRetryAfterMs;
}

function markBackendRecovered(source) {
    if (!backendUnavailable) {
        return;
    }

    backendUnavailable = false;
    disableFacilityNameSaves = false;
    backendRetryAfterMs = 0;
    trackEvent('backend_recovered', { source });

    if (_pendingFacilitySaves.length && !_pendingFacilitySaveTimer) {
        _pendingFacilitySaveTimer = setTimeout(flushFacilitySaves, 0);
    }
}

function markBackendUnavailable(reason) {
    if (!backendUnavailable) {
        console.warn(`Backend unavailable (${reason}). Running in limited mode.`);
        trackEvent('backend_unavailable_marked', { reason });
    }
    backendUnavailable = true;
    disableFacilityNameSaves = true;
    backendRetryAfterMs = Date.now() + BACKEND_RECOVERY_RETRY_MS;
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

// --- Safe facility-action registry ---------------------------------------
// Rather than inlining facility names into JS string literals inside onclick
// (fragile against backslashes, quotes, </script>, non-BMP chars), we keep a
// map from facility_id -> name and dispatch via delegated click listeners
// using [data-action] + [data-facility-id] attributes. data-* attrs only
// require HTML escaping, which escapeHTML handles.
const facilityNameRegistry = new Map();

function rememberFacility(id, name) {
    if (id == null) return;
    facilityNameRegistry.set(String(id), name || "Public Toilet");
}

function getFacilityName(id) {
    return facilityNameRegistry.get(String(id)) || "Public Toilet";
}

document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const facilityId = target.dataset.facilityId;
    if (!facilityId) return;
    const name = getFacilityName(facilityId);

    if (action === 'rate') {
        event.preventDefault();
        event.stopPropagation();
        openModal(facilityId, name);
    } else if (action === 'open-reviews') {
        event.preventDefault();
        event.stopPropagation();
        openReviewsList(facilityId, name);
    } else if (action === 'directions') {
        trackEvent('directions_clicked', { source: 'popup', facility_id: String(facilityId) });
    }
});

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
    if (!shouldAttemptBackendRequest()) {
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
        markBackendRecovered('facility lookup');

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

// Sticky flags for endpoints that may not exist on older API deployments.
// If the bulk/geocode endpoints 404 we fall back to the legacy per-id GET
// and direct-to-Nominatim paths so name resolution keeps working until the
// API is redeployed.
let _bulkFacilitiesEndpointAvailable = true;
let _geocodeProxyEndpointAvailable = true;

// Bulk fetch resolved names. Returns Map<string, string> for hits only.
// Falls back to per-id lookups if the bulk endpoint isn't deployed.
async function getResolvedNamesBulk(facilityIds) {
    if (!facilityIds.length || !shouldAttemptBackendRequest()) {
        return new Map();
    }
    const unique = Array.from(new Set(facilityIds.map(String)));
    const result = new Map();

    if (_bulkFacilitiesEndpointAvailable) {
        const chunks = [];
        for (let i = 0; i < unique.length; i += 100) {
            chunks.push(unique.slice(i, i + 100));
        }
        for (const chunk of chunks) {
            try {
                const res = await fetch(`${BACKEND_URL}/api/facilities?ids=${encodeURIComponent(chunk.join(','))}`);
                if (res.status === 404) {
                    // Endpoint not deployed yet; remember and fall back.
                    _bulkFacilitiesEndpointAvailable = false;
                    break;
                }
                if (!res.ok) {
                    if (res.status >= 500) markBackendUnavailable('facility bulk lookup');
                    continue;
                }
                markBackendRecovered('facility bulk lookup');
                const data = await res.json();
                const facilities = data.facilities || {};
                for (const id of Object.keys(facilities)) {
                    const f = facilities[id];
                    if (f && f.resolved_name) result.set(String(id), f.resolved_name);
                }
            } catch {
                markBackendUnavailable('facility bulk lookup');
                return result;
            }
        }
        if (_bulkFacilitiesEndpointAvailable) return result;
    }

    // Legacy fallback: one GET per id (slower, but works with older deployments).
    for (const id of unique) {
        if (!shouldAttemptBackendRequest()) break;
        const name = await getResolvedNameFromBackend(id);
        if (name) result.set(id, name);
    }
    return result;
}

// Buffered bulk save of newly geocoded facilities.
const _pendingFacilitySaves = [];
let _pendingFacilitySaveTimer = null;
function queueFacilitySave(payload) {
    if (disableFacilityNameSaves && !backendUnavailable) return;
    _pendingFacilitySaves.push(payload);
    if (_pendingFacilitySaveTimer) return;
    _pendingFacilitySaveTimer = setTimeout(flushFacilitySaves, 1500);
}

async function flushFacilitySaves() {
    _pendingFacilitySaveTimer = null;
    if (!_pendingFacilitySaves.length) return;
    if (!shouldAttemptBackendRequest()) {
        _pendingFacilitySaveTimer = setTimeout(flushFacilitySaves, BACKEND_RECOVERY_RETRY_MS);
        return;
    }
    const batch = _pendingFacilitySaves.splice(0, 200);
    try {
        const res = await fetch(`${BACKEND_URL}/api/facilities/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ facilities: batch })
        });
        if (!res.ok && res.status >= 500) {
            markBackendUnavailable('facility bulk save');
        } else if (res.ok) {
            markBackendRecovered('facility bulk save');
        }
    } catch {
        markBackendUnavailable('facility bulk save');
        _pendingFacilitySaves.unshift(...batch);
    }
    // If more accumulated during the request, schedule another flush
    if (_pendingFacilitySaves.length) {
        _pendingFacilitySaveTimer = setTimeout(flushFacilitySaves, 1500);
    }
}

// Reverse-geocode via our backend proxy (preferred — it sends Nominatim a
// proper User-Agent and caches results). If the proxy isn't deployed we
// fall back to calling Nominatim directly so older API deployments still
// resolve names.
let _lastDirectNominatimCall = 0;

async function _geocodeDirectFromNominatim(lat, lon) {
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - _lastDirectNominatimCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastDirectNominatimCall = Date.now();
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`
        );
        if (!res.ok) return null;
        const data = await res.json();
        const addr = data.address || {};
        if (addr.house_number && addr.road) return `${addr.house_number} ${addr.road}`;
        if (addr.road) return addr.road;
        if (addr.suburb) return addr.suburb;
        if (addr.neighbourhood) return addr.neighbourhood;
        return null;
    } catch (e) {
        console.error('Direct Nominatim error:', e);
        return null;
    }
}

async function geocodeAddress(lat, lon) {
    if (_geocodeProxyEndpointAvailable && shouldAttemptBackendRequest()) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/geocode/reverse?lat=${lat}&lon=${lon}`);
            if (res.status === 404) {
                // Proxy not deployed; flip flag and fall through.
                _geocodeProxyEndpointAvailable = false;
            } else if (res.ok) {
                markBackendRecovered('geocode');
                const data = await res.json();
                return data.name || null;
            } else {
                if (res.status >= 500) markBackendUnavailable('geocode');
                return null;
            }
        } catch {
            markBackendUnavailable('geocode');
            // fall through to direct Nominatim as a last resort
        }
    }
    return _geocodeDirectFromNominatim(lat, lon);
}

// Queue a facility for bulk save to the backend's cache.
function saveResolvedNameToBackend(facilityId, name, lat, lon) {
    queueFacilitySave({
        id: String(facilityId),
        name: name || "Public Toilet",
        resolved_name: name,
        latitude: lat,
        longitude: lon,
        accessible: false,
        baby_change: false,
    });
}

// Get display name for a single facility (used as a fallback; the main path
// goes through resolveNamesInBackground which does a bulk fetch first).
async function getDisplayName(facilityId, lat, lon) {
    if (nameCache[facilityId]) {
        return nameCache[facilityId];
    }

    const cachedName = await getResolvedNameFromBackend(facilityId);
    if (cachedName) {
        nameCache[facilityId] = cachedName;
        return cachedName;
    }

    const geocodedName = await geocodeAddress(lat, lon);
    if (geocodedName) {
        nameCache[facilityId] = geocodedName;
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
    if (!container) {
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const icon = type === 'success' ? 'check_circle' : 'error';
    const iconEl = document.createElement('span');
    iconEl.className = 'material-symbols-outlined';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;

    const messageEl = document.createElement('span');
    messageEl.textContent = message;

    toast.appendChild(iconEl);
    toast.appendChild(messageEl);
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
            const tags = el.tags || {};

            const tagBool = (v) => {
                if (!v) return false;
                const s = String(v).toLowerCase();
                return s === "yes" || s === "designated";
            };
            const accessible = tagBool(tags.wheelchair);
            const babyChange = tagBool(tags.changing_table) || tagBool(tags.baby_changing);
            const fee = (tags.fee || "").toLowerCase();
            const free = fee === "no" || fee === "free";
            const unisex = tagBool(tags.unisex);
            const openingHours = tags.opening_hours || null;
            const access = (tags.access || "").toLowerCase();

            return {
                type: "Feature",
                properties: {
                    id: featureId,
                    Name: "Public Toilet",
                    lat,
                    lon,
                    Accessible: accessible,
                    BabyChange: babyChange,
                    Free: free,
                    Unisex: unisex,
                    OpeningHours: openingHours,
                    Access: access,
                },
                geometry: { type: "Point", coordinates: [lon, lat] }
            };
        })
        .filter(Boolean);
}

function applyResolvedName(feature, resolvedName) {
    const props = feature.properties;
    if (!resolvedName || props.Name === resolvedName) return;
    props.Name = resolvedName;
    nameCache[props.id] = resolvedName;
    rememberFacility(props.id, resolvedName);

    const listTitleEl = document.getElementById(`list-title-${props.id}`);
    if (listTitleEl) listTitleEl.textContent = resolvedName;

    if (feature.layerRef) {
        const lat = feature.geometry.coordinates[1];
        const lng = feature.geometry.coordinates[0];
        feature.layerRef.setPopupContent(buildPopupHtml(props.id, resolvedName, lat, lng));
    }
}

async function resolveNamesInBackground(loadToken, features) {
    if (!features.length) return;

    // Phase 1: single bulk lookup for all ids we don't already have in memory
    const idsToLookup = features
        .map((f) => f && f.properties && f.properties.id)
        .filter((id) => id != null && !nameCache[id]);

    let resolvedMap = new Map();
    if (idsToLookup.length) {
        resolvedMap = await getResolvedNamesBulk(idsToLookup);
        if (loadToken !== currentLoadToken) return;
    }

    const needsGeocoding = [];
    for (const feature of features) {
        if (!feature || !feature.properties) continue;
        const props = feature.properties;
        const cached = nameCache[props.id] || resolvedMap.get(String(props.id));
        if (cached) {
            applyResolvedName(feature, cached);
        } else {
            needsGeocoding.push(feature);
        }
    }

    // Phase 2: geocode misses serially (Nominatim 1 req/sec policy) and
    // queue saves via the buffered bulk-save path.
    for (const feature of needsGeocoding) {
        if (loadToken !== currentLoadToken) return;
        const props = feature.properties;
        const geocodedName = await geocodeAddress(props.lat, props.lon);
        if (loadToken !== currentLoadToken) return;
        if (geocodedName) {
            applyResolvedName(feature, geocodedName);
            saveResolvedNameToBackend(props.id, geocodedName, props.lat, props.lon);
        }
    }
}

// Build popup HTML. Name is HTML-escaped and the action buttons rely on the
// delegated click handler + data-action/data-facility-id attributes rather
// than inline onclick handlers (which are XSS-fragile).
function buildPopupHtml(facilityId, name, lat, lng) {
    const safeName = escapeHTML(name);
    const safeFacilityId = escapeHTML(String(facilityId));
    const safeRatingElId = "rt-" + safeFacilityId;
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
    rememberFacility(facilityId, name);

    return `
        <div class="popup-title">${safeName}</div>
        <div id="${safeRatingElId}" class="popup-rating">${getRatingHtml(facilityId, getCachedRatingSummary(facilityId))}</div>
        <div style="display: flex; gap: 8px;">
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action-small btn-directions" style="flex:1;" data-action="directions" data-facility-id="${safeFacilityId}">
                <span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions
            </a>
            <button class="btn-action-small btn-rate" style="flex:1;" data-action="rate" data-facility-id="${safeFacilityId}" type="button">
                <span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate
            </button>
        </div>
    `;
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
        await renderMapPoints();

        resolveNamesInBackground(loadToken, allToiletData.features).catch((error) => {
            console.error("Background name resolution failed:", error);
        });

    } catch (e) { 
        console.error("Overpass API Error:", e); 
        trackEvent('overpass_fetch_failed', { message: e && e.message ? e.message : 'unknown' });
        showToast("Error finding toilets in this area. Try zooming in or moving to a different area.", "error");
    } finally { 
        document.getElementById('loader').style.display = 'none'; 
    }
}

// --- Map & Sidebar Rendering ---
async function renderMapPoints() {
    if (currentMapLayer) map.removeLayer(currentMapLayer);
    const listContainer = document.getElementById('facility-list');
    listContainer.innerHTML = '';
    
    const referencePoint = userLocationMarker ? userLocationMarker.getLatLng() : map.getCenter();

    let displayFeatures = allToiletData.features.filter(f => {
        const p = f.properties;
        if (activeFilters.accessible && !p.Accessible) return false;
        if (activeFilters.baby && !p.BabyChange) return false;
        if (activeFilters.free && !p.Free) return false;
        if (activeFilters.unisex && !p.Unisex) return false;
        return true;
    });

    displayFeatures.forEach(f => {
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];
        f.properties.dist = map.distance(referencePoint, L.latLng(lat, lng));
    });

    displayFeatures.sort((a,b) => a.properties.dist - b.properties.dist);

    // Remember names for delegated click handlers
    displayFeatures.forEach(f => rememberFacility(f.properties.id, f.properties.Name));

    // Render pins immediately, then backfill ratings once the fetch resolves
    fetchRatingSummaries(displayFeatures.map(f => f.properties.id)).then(() => {
        displayFeatures.forEach(feature => {
            const facilityId = feature.properties.id;
            const summary = getCachedRatingSummary(facilityId);
            if (summary) {
                const listRatingEl = document.getElementById(`list-rating-${facilityId}`);
                if (listRatingEl) listRatingEl.innerHTML = getListRatingHtml(facilityId, summary);
                const popupRatingEl = document.getElementById(`rt-${facilityId}`);
                if (popupRatingEl) popupRatingEl.innerHTML = getRatingHtml(facilityId, summary);
            }
        });
    });

    // Use markercluster to avoid browser lag at city zoom (falls back to a
    // plain layer group if the plugin isn't loaded).
    currentMapLayer = (typeof L.markerClusterGroup === "function")
        ? L.markerClusterGroup({
            maxClusterRadius: 50,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
        })
        : L.layerGroup();

    displayFeatures.forEach(f => {
        const facilityId = f.properties.id;
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];
        const marker = L.marker([lat, lng], {icon: toiletIcon});
        marker.bindPopup(buildPopupHtml(facilityId, f.properties.Name, lat, lng));
        marker.on('popupopen', () => {
            fetchAndDisplayRating(facilityId, "rt-" + facilityId);
            collapseSidebar();
        });
        f.layerRef = marker;
        currentMapLayer.addLayer(marker);
    });
    map.addLayer(currentMapLayer);

    const top5Nearest = displayFeatures.slice(0, 5);

    top5Nearest.forEach(feature => {
        const facilityId = feature.properties.id;
        const name = feature.properties.Name;
        const ratingSummary = getCachedRatingSummary(facilityId);
        const distanceKm = (feature.properties.dist / 1000).toFixed(2);
        const lat = feature.geometry.coordinates[1];
        const lng = feature.geometry.coordinates[0];
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

        const listItem = document.createElement('div');
        listItem.className = 'list-item';

        // Build via DOM APIs so names are never interpolated into JS/HTML strings
        const header = document.createElement('div');
        header.className = 'list-item-header';
        const title = document.createElement('div');
        title.id = `list-title-${facilityId}`;
        title.className = 'list-item-title';
        title.textContent = name; // safe: textContent
        const badge = document.createElement('div');
        badge.className = 'distance-badge';
        badge.textContent = `${distanceKm} km`;
        header.append(title, badge);

        const ratingWrap = document.createElement('div');
        ratingWrap.id = `list-rating-${facilityId}`;
        ratingWrap.className = 'list-item-rating';
        ratingWrap.innerHTML = getListRatingHtml(facilityId, ratingSummary);

        const features = document.createElement('div');
        features.className = 'list-item-features';
        if (feature.properties.Accessible) {
            features.insertAdjacentHTML('beforeend',
                '<span class="material-symbols-outlined" title="Accessible" style="font-size:16px;">accessible</span>');
        }
        if (feature.properties.BabyChange) {
            features.insertAdjacentHTML('beforeend',
                ' <span class="material-symbols-outlined" title="Baby Change" style="font-size:16px;">baby_changing_station</span>');
        }

        const actions = document.createElement('div');
        actions.className = 'list-item-actions';
        const dirLink = document.createElement('a');
        dirLink.href = mapsUrl;
        dirLink.target = '_blank';
        dirLink.rel = 'noopener noreferrer';
        dirLink.className = 'btn-action-small btn-directions';
        dirLink.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">directions</span> Directions';
        dirLink.addEventListener('click', (e) => {
            e.stopPropagation();
            trackEvent('directions_clicked', { source: 'list', facility_id: String(facilityId) });
        });
        const rateBtn = document.createElement('button');
        rateBtn.type = 'button';
        rateBtn.className = 'btn-action-small btn-rate';
        rateBtn.dataset.action = 'rate';
        rateBtn.dataset.facilityId = String(facilityId);
        rateBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">star</span> Rate';
        rateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openModal(facilityId, name);
        });
        actions.append(dirLink, rateBtn);

        listItem.append(header, ratingWrap, features, actions);
        listItem.addEventListener('click', () => {
            map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
            if (feature.layerRef) feature.layerRef.openPopup();
        });

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

function getRatingHtml(facilityId, summary) {
    const safeFacilityId = escapeHTML(String(facilityId));

    if (!summary || !summary.review_count) {
        return `<div class="empty-state-rating" data-action="rate" data-facility-id="${safeFacilityId}" role="button" tabindex="0">
                    <span class="material-symbols-outlined">add_comment</span>
                    <span>Be the first to review!</span>
                </div>`;
    }

    const avg = Number(summary.avg_rating || 0).toFixed(1);
    const count = Number(summary.review_count) | 0;
    return `<span class="clickable-rating" data-action="open-reviews" data-facility-id="${safeFacilityId}" role="button" tabindex="0">
                <span class="material-symbols-outlined" style="font-size:16px; color:#f59e0b;">star</span> ${avg} (${count})
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
    if (!shouldAttemptBackendRequest()) {
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
        markBackendRecovered('rating summaries');

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

async function fetchAndDisplayRating(facilityId, htmlId) {
    const el = document.getElementById(htmlId);
    if (!el) return;

    const cachedSummary = getCachedRatingSummary(facilityId);
    if (cachedSummary) {
        el.innerHTML = getRatingHtml(facilityId, cachedSummary);
        return;
    }

    el.innerHTML = `<span style="font-size:13px; font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">hourglass_top</span> Loading rating...</span>`;
    const updated = await fetchRatingSummaries([facilityId], true);

    let summary = getCachedRatingSummary(facilityId);
    if (!summary && ratingSummaryInFlight.has(facilityId)) {
        summary = await waitForRatingSummaryInFlight(facilityId);
    }

    if (summary) {
        el.innerHTML = getRatingHtml(facilityId, summary);
        return;
    }

    if (!updated) {
        el.innerHTML = `<span style="font-size:13px; color:#e74c3c;"><span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">error</span> Rating unavailable</span>`;
        return;
    }

    el.innerHTML = getRatingHtml(facilityId, getCachedRatingSummary(facilityId));
}

// --- GPS Logic ---
function findNearest() {
    trackEvent('use_my_location_clicked');
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
    }, (error) => {
        // If user denies location, show a toast and load data for current view
        if (error.code === error.PERMISSION_DENIED) {
            trackEvent('geolocation_failed', { reason: 'permission_denied' });
            showToast("Location denied. Showing toilets for default area.", "error");
        } else {
            trackEvent('geolocation_failed', { reason: 'unavailable' });
            showToast("Unable to get your location.", "error");
        }
        // Load data for the current (default) view
        setTimeout(loadDataForCurrentBounds, 500);
    });
}

// Initialize map with user location on page load
function initializeWithUserLocation() {
    if (!navigator.geolocation) {
        trackEvent('geolocation_failed', { reason: 'not_supported' });
        showToast("Geolocation not supported by your browser.", "error");
        setTimeout(loadDataForCurrentBounds, 500);
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            
            // Check if user is within Australia
            if (!isWithinAustralia(lat, lng)) {
                // Check if user has already dismissed the warning for this session
                const warningDismissed = sessionStorage.getItem('locationWarningDismissed');
                if (!warningDismissed) {
                    showLocationErrorModal();
                }
            }
            
            // Update user coordinates for theme calculation
            userLat = lat;
            userLng = lng;
            
            // Set map to user location immediately
            map.setView([lat, lng], 15);
            
            // Add user location marker
            const icon = L.divIcon({ className: 'custom-user-marker', html: '<div class="user-location-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
            userLocationMarker = L.marker([lat, lng], { icon }).addTo(map);
            
            // Update theme based on new location and start periodic checks
            updateTimeBasedTheme();
            startPeriodicThemeUpdates();
            
            // Load data for user's area
            setTimeout(loadDataForCurrentBounds, 1000);
        },
        (error) => {
            // If user denies location or there's an error, keep default view and load data
            if (error.code === error.PERMISSION_DENIED) {
                trackEvent('geolocation_failed', { reason: 'permission_denied' });
                showToast("Location denied. Showing toilets for Melbourne area.", "error");
            } else {
                trackEvent('geolocation_failed', { reason: 'unavailable' });
                showToast("Unable to get your location. Showing default area.", "error");
            }
            
            // Start periodic theme updates with default coordinates
            startPeriodicThemeUpdates();
            
            // Load data for the default (Melbourne) view
            setTimeout(loadDataForCurrentBounds, 500);
        }
    );
}

// Start periodic theme updates to check for day/night changes
function startPeriodicThemeUpdates() {
    // Clear any existing interval
    if (themeUpdateInterval) {
        clearInterval(themeUpdateInterval);
    }
    
    // Check every 5 minutes for theme changes
    themeUpdateInterval = setInterval(updateTimeBasedTheme, 5 * 60 * 1000);
}

map.on('moveend', () => { document.getElementById('btn-search-area').style.display = 'block'; });
function triggerSearchArea() { trackEvent('search_this_area_clicked'); loadDataForCurrentBounds(); }

// ... (rest of the code remains the same)
// --- Modals & Filters ---
function toggleFilter(t) { activeFilters[t] = !activeFilters[t]; document.getElementById('chip-'+t).classList.toggle('active'); trackEvent('filter_toggled', { filter: t, enabled: activeFilters[t] }); renderMapPoints(); }
function toggleMoreFilters() {
    const extra = document.getElementById('filters-extra');
    const label = document.getElementById('chip-more-label');
    const chip = document.getElementById('chip-more');
    const isHidden = extra.style.display === 'none' || extra.style.display === '';
    extra.style.display = isHidden ? 'flex' : 'none';
    label.textContent = isHidden ? 'Hide filters' : 'All filters';
    chip.classList.toggle('active', isHidden);
}

function openModalOverlay(modalEl, options = {}) {
    if (!modalEl) {
        return;
    }

    if (activeModalEl && activeModalEl !== modalEl && activeModalCloseHandler) {
        activeModalCloseHandler();
    }

    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeModalEl = modalEl;
    activeModalCloseHandler = typeof options.onClose === 'function' ? options.onClose : null;

    modalEl.style.display = 'flex';
    modalEl.setAttribute('aria-hidden', 'false');

    const contentEl = modalEl.querySelector('.modal-content');
    const preferredFocusEl = options.initialFocusSelector
        ? modalEl.querySelector(options.initialFocusSelector)
        : null;

    requestAnimationFrame(() => {
        if (preferredFocusEl && preferredFocusEl.offsetParent !== null) {
            preferredFocusEl.focus();
            return;
        }

        const focusable = getFocusableElements(contentEl || modalEl);
        if (focusable.length > 0) {
            focusable[0].focus();
            return;
        }

        if (contentEl && typeof contentEl.focus === 'function') {
            contentEl.focus();
        }
    });
}

function closeModalOverlay(modalEl) {
    if (!modalEl) {
        return;
    }

    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');

    if (activeModalEl === modalEl) {
        activeModalEl = null;
        activeModalCloseHandler = null;

        if (lastFocusedElement && document.contains(lastFocusedElement)) {
            requestAnimationFrame(() => {
                lastFocusedElement.focus();
            });
        }
        lastFocusedElement = null;
    }
}

function initModalOverlayInteractions() {
    const modalSelectors = [
        '#reviewModal',
        '#feedbackModal',
        '#installHelpModal',
        '#reviewsListModal',
        '#locationErrorModal'
    ];

    modalSelectors.forEach((selector) => {
        const modalEl = document.querySelector(selector);
        if (!modalEl) {
            return;
        }

        modalEl.addEventListener('mousedown', (event) => {
            if (event.target === modalEl && activeModalCloseHandler) {
                activeModalCloseHandler();
            }
        });
    });
}

function openModal(id, name) { 
    currentReviewFacilityId = id; 
    currentReviewFacilityName = name;
    document.getElementById('modalFacilityName').innerText = name; 
    openModalOverlay(document.getElementById('reviewModal'), {
        initialFocusSelector: '.star[tabindex="0"]',
        onClose: closeModal
    });
    currentRating = 0; 
    updateStarsUI(); 
    trackEvent('rate_modal_opened', { facility_id: String(id) });
}

function closeModal() {
    closeModalOverlay(document.getElementById('reviewModal'));
}

function setRating(r) {
    const nextRating = Math.max(0, Math.min(5, Number(r) || 0));
    currentRating = nextRating;
    updateStarsUI();
}

function focusRatingStar(ratingValue) {
    const starEl = document.querySelector(`.star[data-value="${ratingValue}"]`);
    if (starEl) {
        starEl.focus();
    }
}

function updateStarsUI() {
    const stars = Array.from(document.querySelectorAll('.star'));
    stars.forEach((star) => {
        const starValue = parseInt(star.dataset.value, 10);
        const isSelected = currentRating > 0 && starValue <= currentRating;
        const isChecked = currentRating === starValue;
        const shouldBeTabStop = (currentRating === 0 && starValue === 5) || isChecked;

        star.classList.toggle('selected', isSelected);
        star.setAttribute('aria-checked', isChecked ? 'true' : 'false');
        star.setAttribute('tabindex', shouldBeTabStop ? '0' : '-1');
    });

    const ratingStatusEl = document.getElementById('ratingSelectionStatus');
    if (ratingStatusEl) {
        ratingStatusEl.textContent = currentRating > 0 ? `${currentRating} ${currentRating === 1 ? 'star' : 'stars'} selected.` : 'No rating selected.';
    }
}

function handleStarKeydown(event) {
    const currentStarValue = parseInt(event.currentTarget.dataset.value, 10);
    if (Number.isNaN(currentStarValue)) {
        return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setRating(currentStarValue);
        focusRatingStar(currentStarValue);
        return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        const nextValue = Math.min(5, currentStarValue + 1);
        setRating(nextValue);
        focusRatingStar(nextValue);
        return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        const nextValue = Math.max(1, currentStarValue - 1);
        setRating(nextValue);
        focusRatingStar(nextValue);
        return;
    }

    if (event.key === 'Home') {
        event.preventDefault();
        setRating(1);
        focusRatingStar(1);
        return;
    }

    if (event.key === 'End') {
        event.preventDefault();
        setRating(5);
        focusRatingStar(5);
    }
}

function initStarRatingAccessibility() {
    document.querySelectorAll('.star').forEach((starEl) => {
        starEl.addEventListener('keydown', handleStarKeydown);
    });
}

initStarRatingAccessibility();
updateStarsUI();
initModalOverlayInteractions();

function openFeedbackModal() {
    const modalEl = document.getElementById('feedbackModal');
    if (!modalEl) {
        return;
    }

    setSupportMenuOpen(false);
    setSupportDesktopMenuOpen(false);
    openModalOverlay(modalEl, {
        initialFocusSelector: '#feedbackText',
        onClose: closeFeedbackModal
    });
}

function closeFeedbackModal() {
    const modalEl = document.getElementById('feedbackModal');
    if (!modalEl) {
        return;
    }

    closeModalOverlay(modalEl);
}

function openInstallHelpModal() {
    const modalEl = document.getElementById('installHelpModal');
    if (!modalEl) {
        return;
    }

    setSupportMenuOpen(false);
    setSupportDesktopMenuOpen(false);
    updateInstallNowButton();
    openModalOverlay(modalEl, {
        initialFocusSelector: '#install-now-button',
        onClose: closeInstallHelpModal
    });
    trackEvent('install_help_opened', { native_prompt_available: Boolean(_deferredInstallPrompt) });
}

function closeInstallHelpModal() {
    const modalEl = document.getElementById('installHelpModal');
    if (!modalEl) {
        return;
    }

    closeModalOverlay(modalEl);
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
        markBackendRecovered('feedback submit');

        trackEvent('feedback_submitted_success');
        showToast('Feedback sent. Thank you!', 'success');
        if (messageEl) {
            messageEl.value = '';
        }
        if (emailEl) {
            emailEl.value = '';
        }
        closeFeedbackModal();
    } catch (e) {
        trackEvent('feedback_submitted_failed', { reason: 'network' });
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
            markBackendRecovered('review submit');
            trackEvent('review_submitted_success', { facility_id: String(currentReviewFacilityId), rating: currentRating });
            showToast("Review saved!", "success"); 
            closeModal(); 
            delete ratingCache[currentReviewFacilityId]; 
            delete ratingSummaryCache[currentReviewFacilityId];
            loadDataForCurrentBounds(); 
        } else {
            trackEvent('review_submitted_failed', { status: res.status });
        }
    } catch (e) {
        trackEvent('review_submitted_failed', { reason: 'network' });
        showToast("Error connecting.", "error");
    }
}

const REVIEWS_PAGE_SIZE = 50;
let _currentReviewsFacilityId = null;
let _currentReviewsOffset = 0;

function appendReviewCards(container, reviews) {
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
}

function removeLoadMoreButton() {
    const btn = document.getElementById('load-more-reviews-btn');
    if (btn) btn.remove();
}

async function loadMoreReviews() {
    const container = document.getElementById('reviewsContainer');
    const btn = document.getElementById('load-more-reviews-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
    try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${_currentReviewsFacilityId}?limit=${REVIEWS_PAGE_SIZE}&offset=${_currentReviewsOffset}`);
        if (!res.ok) {
            removeLoadMoreButton();
            return;
        }
        markBackendRecovered('reviews list paging');
        const data = await res.json();
        const reviews = Array.isArray(data.reviews) ? data.reviews : [];
        const total = Number.isFinite(Number(data.total)) ? Number(data.total) : reviews.length;

        _currentReviewsOffset += reviews.length;
        appendReviewCards(container, reviews);

        removeLoadMoreButton();
        const remaining = total - _currentReviewsOffset;
        if (remaining > 0 && reviews.length > 0) {
            const moreBtn = document.createElement('button');
            moreBtn.id = 'load-more-reviews-btn';
            moreBtn.className = 'btn-cancel';
            moreBtn.style.width = '100%';
            moreBtn.style.marginTop = '12px';
            moreBtn.textContent = `Show more (${remaining} left)`;
            moreBtn.onclick = loadMoreReviews;
            container.appendChild(moreBtn);
        }
    } catch (error) {
        console.error('Error loading more reviews:', error);
        removeLoadMoreButton();
    }
}

async function openReviewsList(facilityId, name) {
    openModalOverlay(document.getElementById('reviewsListModal'), {
        initialFocusSelector: '.btn-cancel',
        onClose: closeReviewsList
    });
    document.getElementById('listModalFacilityName').textContent = (name || 'Facility') + " Reviews";
    const container = document.getElementById('reviewsContainer');
    container.innerHTML = "Loading...";
    _currentReviewsFacilityId = facilityId;
    _currentReviewsOffset = 0;

    try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${facilityId}?limit=${REVIEWS_PAGE_SIZE}&offset=0`);
        if (!res.ok) {
            container.textContent = "Reviews unavailable right now.";
            return;
        }
        markBackendRecovered('reviews list open');

        const data = await res.json();
        const reviews = Array.isArray(data.reviews) ? data.reviews : [];
        const total = Number.isFinite(Number(data.total)) ? Number(data.total) : reviews.length;

        container.innerHTML = "";
        if (reviews.length === 0) {
            container.textContent = "No text reviews.";
            return;
        }

        _currentReviewsOffset = reviews.length;
        appendReviewCards(container, reviews);

        const remaining = total - _currentReviewsOffset;
        if (remaining > 0) {
            const moreBtn = document.createElement('button');
            moreBtn.id = 'load-more-reviews-btn';
            moreBtn.className = 'btn-cancel';
            moreBtn.style.width = '100%';
            moreBtn.style.marginTop = '12px';
            moreBtn.textContent = `Show more (${remaining} left)`;
            moreBtn.onclick = loadMoreReviews;
            container.appendChild(moreBtn);
        }
    } catch (error) {
        console.error('Error loading reviews:', error);
        container.textContent = "Reviews unavailable right now.";
    }
}
function closeReviewsList() {
    closeModalOverlay(document.getElementById('reviewsListModal'));
}

window.addEventListener('error', (event) => {
    trackEvent('frontend_error', {
        message: event.message || 'unknown',
        source: event.filename ? event.filename.split('/').pop() : null,
        line: event.lineno || null
    });
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    trackEvent('frontend_unhandled_rejection', {
        message: reason && reason.message ? reason.message : String(reason || 'unknown')
    });
});

map.whenReady(() => {
    trackEvent('app_loaded', { hostname: window.location.hostname });
    initializeWithUserLocation();
});

// --- PWA: service worker registration + install prompt + offline indicator ---
let _deferredInstallPrompt = null;

// True when the page is launched as a standalone installed PWA (Android/iOS).
// In that case we never want to nag the user to "install" the app they're
// already inside.
function isStandalonePWA() {
    return (
        window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
    ) || window.navigator.standalone === true;
}

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/service-worker.js")
            .then((reg) => {
                // When a new SW takes over, refresh once so the user gets the new assets.
                let refreshing = false;
                navigator.serviceWorker.addEventListener("controllerchange", () => {
                    if (refreshing) return;
                    refreshing = true;
                    window.location.reload();
                });
                // Nudge a waiting SW to activate immediately on next load.
                if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
            })
            .catch((err) => console.warn("SW registration failed:", err));
    });
}

function updateInstallNowButton() {
    const buttonEl = document.getElementById("install-now-button");
    if (!buttonEl) {
        return;
    }

    buttonEl.style.display = _deferredInstallPrompt && !isStandalonePWA() ? "" : "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    if (isStandalonePWA()) return; // already installed; don't surface the prompt
    _deferredInstallPrompt = e;
    updateInstallNowButton();
});

window.addEventListener("appinstalled", () => {
    _deferredInstallPrompt = null;
    updateInstallNowButton();
    closeInstallHelpModal();
    showToast("LooFinder installed!", "success");
});

async function triggerInstallPrompt() {
    if (!_deferredInstallPrompt) {
        showToast("Use your browser menu or Share button to install LooFinder.", "error");
        return;
    }
    _deferredInstallPrompt.prompt();
    try {
        await _deferredInstallPrompt.userChoice;
    } catch {}
    _deferredInstallPrompt = null;
    updateInstallNowButton();
}

window.addEventListener("online", () => showToast("Back online", "success"));
window.addEventListener("offline", () =>
    showToast("You're offline — showing cached data", "error")
);

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