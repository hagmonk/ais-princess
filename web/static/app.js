/**
 * AIS Vessel Tracker - Frontend Application
 * Uses @preact/signals-core for reactive state management.
 */

import {
    // Core signals
    vessels,
    tracks,
    messages,
    selectedMmsi,
    selectedMessage,
    highlightPoint,
    clickedPoint,
    timelinePosition,
    timelineOldest,
    timelineNewest,
    mapStyle,
    connected,
    mapInitialized,
    typeFilter,
    searchText,
    settings,
    viewportBounds,
    // Computed signals
    filteredVessels,
    visibleVesselCount,
    totalVesselCount,
    messageCount,
    selectedVessel,
    selectedTrack,
    viewportFilteredTrack,
    timelineValue,
    timelineCutoff,
    timelineEnd,
    // Actions
    updateVessel,
    addTrackPoint,
    setTrack,
    addMessage,
    selectVessel as selectVesselAction,
    deselectVessel,
    setHighlightPoint,
    setClickedPoint,
    setTimelinePosition,
    setTimelineRange,
    setTypeFilter,
    setSearchText,
    setMapStyle,
    setConnected,
    setMapInitialized,
    setViewportBounds,
    updateSettings,
    updateChartSettings,
    resetSettings,
    batchUpdate,
    registerEffect,
    // Constants
    SHIP_TYPES,
    NAV_STATUS,
    ATON_TYPES,
    MAX_MESSAGES,
} from './state.js';

const MAX_TRACK_POINTS = Infinity;  // No limit - load all available history

// ============================================================================
// Settings Management (uses signals from state.js)
// ============================================================================

function applySettings() {
    const s = settings.value;
    // Apply vessel names toggle
    const namesBtn = document.getElementById('names-btn');
    if (s.showVesselNames) {
        namesBtn.classList.add('active');
    } else {
        namesBtn.classList.remove('active');
    }

    // Apply chart visibility
    const speedWrapper = document.getElementById('speed-chart-wrapper');
    const courseWrapper = document.getElementById('course-chart-wrapper');
    const draughtWrapper = document.getElementById('draught-chart-wrapper');

    if (speedWrapper) speedWrapper.style.display = s.charts.speed ? 'flex' : 'none';
    if (courseWrapper) courseWrapper.style.display = s.charts.course ? 'flex' : 'none';
    if (draughtWrapper) draughtWrapper.style.display = s.charts.draught ? 'flex' : 'none';
}

function updateSettingsModal() {
    const s = settings.value;
    document.getElementById('setting-vessel-age').value = s.vesselAgeCutoff;
    document.getElementById('setting-show-names').checked = s.showVesselNames;
    document.getElementById('setting-chart-speed').checked = s.charts.speed;
    document.getElementById('setting-chart-course').checked = s.charts.course;
    document.getElementById('setting-chart-draught').checked = s.charts.draught;
}

function openSettingsModal() {
    updateSettingsModal();
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function saveSettingsFromModal() {
    updateSettings({
        vesselAgeCutoff: parseInt(document.getElementById('setting-vessel-age').value, 10),
        showVesselNames: document.getElementById('setting-show-names').checked,
    });
    updateChartSettings({
        speed: document.getElementById('setting-chart-speed').checked,
        course: document.getElementById('setting-chart-course').checked,
        draught: document.getElementById('setting-chart-draught').checked,
    });
    closeSettingsModal();
    updateVesselTable();  // Refresh table for age cutoff changes
    updateLayers();       // Refresh map for all settings changes
    updateVoyageMarkers();  // Refresh HTML voyage markers
}

function initSettings() {
    // Settings button
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);

    // Modal close buttons
    document.querySelector('#settings-modal .modal-close').addEventListener('click', closeSettingsModal);
    document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', closeSettingsModal);

    // Save and reset buttons
    document.getElementById('settings-save').addEventListener('click', saveSettingsFromModal);
    document.getElementById('settings-reset').addEventListener('click', () => {
        resetSettings();
        updateSettingsModal();
    });

    // Names toggle button (quick toggle without opening settings)
    document.getElementById('names-btn').addEventListener('click', () => {
        updateSettings({ showVesselNames: !settings.value.showVesselNames });
        updateLayers();  // Refresh map to show/hide names
        updateVoyageMarkers();  // Refresh HTML voyage markers
    });

    // Apply initial settings
    applySettings();
}

// ============================================================================
// Port Database (UN/LOCODE format: 2-letter country + 3-letter location)
// ============================================================================
const PORTS = {
    // United States - West Coast
    'USLAX': { name: 'Los Angeles', lat: 33.7361, lon: -118.2922 },
    'USLGB': { name: 'Long Beach', lat: 33.7546, lon: -118.2165 },
    'USSFO': { name: 'San Francisco', lat: 37.8044, lon: -122.4200 },
    'USOAK': { name: 'Oakland', lat: 37.7956, lon: -122.2789 },
    'USSEA': { name: 'Seattle', lat: 47.5834, lon: -122.3482 },
    'USPDX': { name: 'Portland', lat: 45.5895, lon: -122.7178 },
    'USSAN': { name: 'San Diego', lat: 32.7157, lon: -117.1611 },
    // United States - Hawaii
    'USHLO': { name: 'Hilo', lat: 19.7297, lon: -155.0900 },
    'USHNL': { name: 'Honolulu', lat: 21.3069, lon: -157.8583 },
    'USKAH': { name: 'Kahului', lat: 20.8947, lon: -156.4700 },
    'USNWH': { name: 'Nawiliwili', lat: 21.9544, lon: -159.3561 },
    'USITO': { name: 'Hilo', lat: 19.7297, lon: -155.0900 }, // Alias
    // United States - East Coast
    'USNYC': { name: 'New York', lat: 40.6892, lon: -74.0445 },
    'USMIA': { name: 'Miami', lat: 25.7617, lon: -80.1918 },
    'USSAV': { name: 'Savannah', lat: 32.0809, lon: -81.0912 },
    'USBAL': { name: 'Baltimore', lat: 39.2858, lon: -76.5972 },
    'USBOS': { name: 'Boston', lat: 42.3601, lon: -71.0589 },
    'USHOU': { name: 'Houston', lat: 29.7604, lon: -95.3698 },
    'USNOR': { name: 'New Orleans', lat: 29.9511, lon: -90.0715 },
    // Canada
    'CAVAN': { name: 'Vancouver', lat: 49.2827, lon: -123.1207 },
    'CATOR': { name: 'Toronto', lat: 43.6532, lon: -79.3832 },
    'CAMTR': { name: 'Montreal', lat: 45.5017, lon: -73.5673 },
    // Mexico
    'MXMZT': { name: 'Mazatlan', lat: 23.2494, lon: -106.4111 },
    'MXPVR': { name: 'Puerto Vallarta', lat: 20.6534, lon: -105.2253 },
    'MXCUN': { name: 'Cancun', lat: 21.1619, lon: -86.8515 },
    'MXCOZ': { name: 'Cozumel', lat: 20.4229, lon: -86.9223 },
    // Caribbean
    'JMKIN': { name: 'Kingston', lat: 17.9714, lon: -76.7936 },
    'BSNAS': { name: 'Nassau', lat: 25.0480, lon: -77.3554 },
    'KWGEC': { name: 'Georgetown', lat: 19.2869, lon: -81.3674 },
    // Central/South America
    'PAPTY': { name: 'Panama City', lat: 8.9824, lon: -79.5199 },
    'PAPBF': { name: 'Panama (Balboa)', lat: 8.9500, lon: -79.5667 },
    // Pacific Islands
    'FJSUV': { name: 'Suva', lat: -18.1416, lon: 178.4419 },
    'PFPPT': { name: 'Papeete', lat: -17.5516, lon: -149.5585 },
    'WSAPW': { name: 'Apia', lat: -13.8333, lon: -171.7500 },
    // Australia/New Zealand
    'AUSYD': { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
    'AUMEL': { name: 'Melbourne', lat: -37.8136, lon: 144.9631 },
    'NZAKL': { name: 'Auckland', lat: -36.8485, lon: 174.7633 },
    'NZWLG': { name: 'Wellington', lat: -41.2865, lon: 174.7762 },
    // Asia - Japan
    'JPTYO': { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
    'JPYOK': { name: 'Yokohama', lat: 35.4437, lon: 139.6380 },
    'JPOSA': { name: 'Osaka', lat: 34.6937, lon: 135.5023 },
    'JPKOB': { name: 'Kobe', lat: 34.6901, lon: 135.1956 },
    'JPNGO': { name: 'Nagoya', lat: 35.1815, lon: 136.9066 },
    // Asia - Other
    'SGSIN': { name: 'Singapore', lat: 1.2644, lon: 103.8200 },
    'HKHKG': { name: 'Hong Kong', lat: 22.3193, lon: 114.1694 },
    'CNSHA': { name: 'Shanghai', lat: 31.2304, lon: 121.4737 },
    'KRPUS': { name: 'Busan', lat: 35.1796, lon: 129.0756 },
    'TWKHH': { name: 'Kaohsiung', lat: 22.6273, lon: 120.3014 },
    'VNSGN': { name: 'Ho Chi Minh', lat: 10.8231, lon: 106.6297 },
    'THBKK': { name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
    // Europe
    'GBSOU': { name: 'Southampton', lat: 50.9097, lon: -1.4044 },
    'GBLGP': { name: 'Liverpool', lat: 53.4084, lon: -2.9916 },
    'NLRTM': { name: 'Rotterdam', lat: 51.9225, lon: 4.4792 },
    'DEHAM': { name: 'Hamburg', lat: 53.5511, lon: 9.9937 },
    'FRLEH': { name: 'Le Havre', lat: 49.4944, lon: 0.1079 },
    'ESALG': { name: 'Algeciras', lat: 36.1408, lon: -5.4536 },
    'ESBCN': { name: 'Barcelona', lat: 41.3784, lon: 2.1765 },
    'ITGOA': { name: 'Genoa', lat: 44.4056, lon: 8.9463 },
    'ITCVV': { name: 'Civitavecchia', lat: 42.0930, lon: 11.7969 },
    'GRATH': { name: 'Athens (Piraeus)', lat: 37.9474, lon: 23.6370 },
    'TRIST': { name: 'Istanbul', lat: 41.0082, lon: 28.9784 },
    // Middle East
    'AEDXB': { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
    'AEAUH': { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773 },
    'OMDMC': { name: 'Muscat', lat: 23.5880, lon: 58.3829 },
};

// AIS Message Type Names
const MESSAGE_TYPE_NAMES = {
    1: 'Class A Position',
    2: 'Class A Position',
    3: 'Class A Position',
    4: 'Base Station',
    5: 'Static/Voyage',
    6: 'Binary Addressed',
    7: 'Binary Ack',
    8: 'Binary Broadcast',
    9: 'SAR Aircraft',
    10: 'UTC Inquiry',
    11: 'UTC Response',
    12: 'Safety Addressed',
    13: 'Safety Ack',
    14: 'Safety Broadcast',
    15: 'Interrogation',
    16: 'Assignment Mode',
    17: 'DGNSS Broadcast',
    18: 'Class B Position',
    19: 'Class B Extended',
    20: 'Data Link Mgmt',
    21: 'Aid to Navigation',
    22: 'Channel Mgmt',
    23: 'Group Assignment',
    24: 'Static Data',
    25: 'Binary Single Slot',
    26: 'Binary Multi Slot',
    27: 'Long Range Position',
};

function getMessageTypeName(msgType) {
    return MESSAGE_TYPE_NAMES[msgType] || `Type ${msgType}`;
}

// Look up destination port from vessel destination string
function lookupDestinationPort(destination) {
    if (!destination) return null;

    const dest = destination.trim().toUpperCase().replace(/\s+/g, '');

    // Try exact match first
    if (PORTS[dest]) {
        return { code: dest, ...PORTS[dest] };
    }

    // Try first 5 characters (UN/LOCODE format)
    const code5 = dest.substring(0, 5);
    if (PORTS[code5]) {
        return { code: code5, ...PORTS[code5] };
    }

    // Try to find by name match
    const destLower = destination.toLowerCase();
    for (const [code, port] of Object.entries(PORTS)) {
        if (destLower.includes(port.name.toLowerCase())) {
            return { code, ...port };
        }
    }

    return null;
}

// Calculate great circle distance in nautical miles
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Earth radius in nautical miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Look up port by code and return distance info
function getDistanceToDestination(vessel) {
    if (!vessel.destination || vessel.lat == null || vessel.lon == null) return null;

    // Try exact match first, then try common variations
    const dest = vessel.destination.trim().toUpperCase().replace(/\s+/g, '');
    const port = PORTS[dest] || PORTS[dest.substring(0, 5)];

    if (!port) return null;

    const distance = calculateDistance(vessel.lat, vessel.lon, port.lat, port.lon);
    const etaHours = vessel.speed > 0 ? distance / vessel.speed : null;

    return {
        portName: port.name,
        distance: distance,
        etaHours: etaHours
    };
}

// ============================================================================
// Unified Update System
// ============================================================================
// All data changes should flow through these functions to ensure consistent updates

let pendingChartUpdate = false;
let chartUpdateTimer = null;
const CHART_UPDATE_THROTTLE = 1000; // ms - don't rebuild charts more than once per second

// Called when track data changes (new point added, history loaded, etc.)
function onTrackDataChanged(mmsi) {
    // Always update layers immediately
    updateLayers();

    // Update charts if this is the selected vessel
    if (selectedMmsi.value === mmsi) {
        // Schedule throttled chart update
        scheduleChartUpdate();
        // Update mobile time scrubber
        updateTimeScrubber();
    }
}

// Called when vessel data changes (position, static data, etc.)
function onVesselDataChanged(mmsi) {
    updateVesselTable();

    if (selectedMmsi.value === mmsi) {
        updateVesselDetails();
    }
}

// Schedule a chart update (throttled for performance)
function scheduleChartUpdate() {
    if (pendingChartUpdate) return; // Already scheduled

    pendingChartUpdate = true;
    if (chartUpdateTimer) clearTimeout(chartUpdateTimer);

    chartUpdateTimer = setTimeout(() => {
        pendingChartUpdate = false;
        updateCharts();
    }, CHART_UPDATE_THROTTLE);
}

// Force immediate chart update (for user-initiated actions)
function forceChartUpdate() {
    if (chartUpdateTimer) clearTimeout(chartUpdateTimer);
    pendingChartUpdate = false;
    updateCharts();
}

const MAP_STYLES = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
};

// ============================================================================
// Map and Layers
// ============================================================================

let map = null;
let deckOverlay = null;
let highlightMarker = null;

function initMap() {
    map = new maplibregl.Map({
        container: 'map-container',
        style: MAP_STYLES[mapStyle.value],
        center: [0, 0],
        zoom: 2,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    map.on('load', () => {
        initDeckOverlay();
    });

    // Update highlight marker position when map moves (continuous)
    map.on('move', () => {
        updateHighlightMarker();
    });

    // Update viewport bounds for chart filtering and trigger chart rebuild
    map.on('moveend', () => {
        const bounds = map.getBounds();
        setViewportBounds({
            sw: { lat: bounds.getSouthWest().lat, lng: bounds.getSouthWest().lng },
            ne: { lat: bounds.getNorthEast().lat, lng: bounds.getNorthEast().lng },
        });
        if (selectedMmsi.value) {
            updateCharts();
        }
    });
}

function initDeckOverlay() {
    deckOverlay = new deck.MapboxOverlay({
        layers: [],
        getTooltip: getVesselTooltip,
        onClick: (info, event) => {
            // If no object was clicked, deselect vessel (click on empty map area)
            if (!info.object && selectedMmsi.value) {
                closeDetails();
            }
        },
    });
    map.addControl(deckOverlay);
    updateLayers();
}

function updateLayers() {
    if (!deckOverlay) return;

    const layers = [];
    const mmsi = selectedMmsi.value;
    const tracksMap = tracks.value;
    const clicked = clickedPoint.value;
    const highlight = highlightPoint.value;
    const s = settings.value;

    // Track layer - only show for selected vessel with history
    if (mmsi && tracksMap.has(mmsi)) {
        const trackData = getFilteredTrack(mmsi);
        if (trackData.length > 1) {
            // Track path line
            layers.push(new deck.PathLayer({
                id: 'track-layer',
                data: [{ path: trackData.map(p => [p.lon, p.lat]) }],
                getPath: d => d.path,
                getColor: [0, 217, 255, 120],
                getWidth: 2,
                widthMinPixels: 1,
            }));

            // Track points (base layer - all points same style)
            // Use larger touch targets on mobile for better tappability
            const isMobile = window.innerWidth <= 768;
            layers.push(new deck.ScatterplotLayer({
                id: 'track-points-layer',
                data: trackData,
                getPosition: d => [d.lon, d.lat],
                getRadius: isMobile ? 8 : 4,
                getFillColor: d => getTrackPointColor(d.msgType),
                radiusMinPixels: isMobile ? 6 : 3,
                radiusMaxPixels: isMobile ? 12 : 8,
                pickable: true,
                onClick: ({ object }) => {
                    if (object) onPointClick(object);
                },
                onHover: ({ object }) => {
                    onPointHover(object, 'track');
                },
            }));

            // Clicked point layer - persistent selection (renders first, below hover)
            if (clicked) {
                layers.push(new deck.ScatterplotLayer({
                    id: 'clicked-point-layer',
                    data: [clicked],
                    getPosition: d => [d.lon, d.lat],
                    getRadius: 16,
                    getFillColor: [255, 100, 100, 200],  // Red for clicked
                    radiusMinPixels: 10,
                    radiusMaxPixels: 24,
                    pickable: false,
                }));
            }

            // Hover highlight layer - temporary highlight (renders on top)
            if (highlight) {
                layers.push(new deck.ScatterplotLayer({
                    id: 'highlight-point-layer',
                    data: [highlight],
                    getPosition: d => [d.lon, d.lat],
                    getRadius: 12,
                    getFillColor: [255, 170, 0, 255],  // Orange for hover
                    radiusMinPixels: 8,
                    radiusMaxPixels: 20,
                    pickable: false,
                }));
            }

            // Port stop and voyage markers are now rendered as HTML markers
            // via updateVoyageMarkers() for full CSS styling control
        }
    }

    // Use computed filteredVessels signal - already filtered by timeline, type, and search
    const vesselData = filteredVessels.value;

    layers.push(new deck.IconLayer({
        id: 'vessel-icons-layer',
        data: vesselData,
        getPosition: d => [d.lon, d.lat],
        getIcon: d => getVesselIcon(d),
        getSize: d => d.mmsi === mmsi ? 36 : 24,
        getAngle: d => d.isAtoN ? 0 : -(d.heading != null && d.heading !== 511 ? d.heading : d.course || 0),
        sizeMinPixels: 14,
        sizeMaxPixels: 50,
        pickable: true,
        onClick: ({ object }) => {
            if (object) selectVessel(object.mmsi);
        },
    }));

    // Vessel names layer (optional)
    if (s.showVesselNames) {
        layers.push(new deck.TextLayer({
            id: 'vessel-names-layer',
            data: vesselData.filter(v => v.shipname),
            getPosition: d => [d.lon, d.lat],
            getText: d => d.shipname,
            getColor: [255, 255, 255, 200],
            getSize: 12,
            getTextAnchor: 'start',
            getAlignmentBaseline: 'center',
            getPixelOffset: [15, 0],
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'normal',
            background: true,
            getBackgroundColor: [0, 0, 0, 150],
            backgroundPadding: [2, 1],
        }));
    }

    // Destination marker for selected vessel
    if (mmsi) {
        const vessel = vessels.value.get(mmsi);
        // Use API-resolved port if available, fallback to local lookup
        const destPort = vessel?.destination_port
            ? { code: vessel.destination_port.locode, name: vessel.destination_port.name, lat: vessel.destination_port.lat, lon: vessel.destination_port.lon }
            : (vessel ? lookupDestinationPort(vessel.destination) : null);
        if (destPort) {
            // Draw line from vessel to destination
            layers.push(new deck.PathLayer({
                id: 'destination-route-layer',
                data: [{ path: [[vessel.lon, vessel.lat], [destPort.lon, destPort.lat]] }],
                getPath: d => d.path,
                getColor: [255, 170, 0, 100],  // Orange, semi-transparent
                getWidth: 2,
                widthMinPixels: 1,
                getDashArray: [8, 4],  // Dashed line
            }));

            // Destination marker (icon-like circle with pin)
            layers.push(new deck.ScatterplotLayer({
                id: 'destination-marker-layer',
                data: [destPort],
                getPosition: d => [d.lon, d.lat],
                getRadius: 12,
                getFillColor: [255, 100, 100, 200],  // Red destination marker
                getLineColor: [255, 255, 255, 255],
                lineWidthMinPixels: 2,
                stroked: true,
                radiusMinPixels: 8,
                radiusMaxPixels: 16,
                pickable: true,
                onClick: () => {
                    // Zoom to destination
                    map.flyTo({ center: [destPort.lon, destPort.lat], zoom: 10 });
                },
            }));

            // Destination label
            layers.push(new deck.TextLayer({
                id: 'destination-label-layer',
                data: [destPort],
                getPosition: d => [d.lon, d.lat],
                getText: d => `📍 ${d.name}`,
                getColor: [255, 100, 100, 255],
                getSize: 14,
                getTextAnchor: 'start',
                getAlignmentBaseline: 'center',
                getPixelOffset: [12, 0],
                fontFamily: 'Arial, sans-serif',
                fontWeight: 'bold',
                background: true,
                getBackgroundColor: [0, 0, 0, 180],
                backgroundPadding: [4, 2],
            }));
        }
    }

    deckOverlay.setProps({ layers });

    // Update highlight marker on map
    updateHighlightMarker();
}

function isHighlighted(point) {
    const hp = highlightPoint.value;
    if (!hp) return false;
    return point.time === hp.time;
}

function getFilteredTrack(mmsi, forCharts = false) {
    const track = tracks.value.get(mmsi) || [];

    // For selected vessel, show full track
    if (selectedMmsi.value === mmsi) {
        // For charts, filter to visible viewport for performance
        if (forCharts && map) {
            return getViewportFilteredTrack(track);
        }
        // Return a copy so deck.gl detects the change (shallow comparison)
        return track.slice();
    }

    // For unselected vessels, filter based on timeline (using computed signals)
    const cutoff = timelineCutoff.value;
    const end = timelineEnd.value;
    return track.filter(p => p.time >= cutoff && p.time <= end);
}

function getViewportFilteredTrack(track) {
    if (!map || track.length === 0) return track;

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // Add small padding to bounds
    const latPad = (ne.lat - sw.lat) * 0.1;
    const lonPad = (ne.lng - sw.lng) * 0.1;

    return track.filter(p =>
        p.lat >= sw.lat - latPad && p.lat <= ne.lat + latPad &&
        p.lon >= sw.lng - lonPad && p.lon <= ne.lng + lonPad
    );
}

function getTrackPointColor(msgType) {
    switch (msgType) {
        case 1: case 2: case 3: return [0, 217, 255, 180];   // Cyan - Class A
        case 5: return [255, 100, 255, 255];                  // Magenta - Static
        case 9: return [255, 255, 0, 255];                    // Yellow - SAR
        case 18: case 19: return [100, 255, 100, 180];       // Green - Class B
        case 21: return [255, 150, 50, 255];                  // Orange - Nav aid
        case 27: return [200, 100, 255, 180];                // Purple - Long range
        default: return [150, 150, 150, 180];                // Gray
    }
}

// Format port stop label for map display (combined for single TextLayer)
function formatPortStopLabel(stop) {
    const primary = formatPortStopPrimary(stop);
    const secondary = formatPortStopSecondary(stop);
    return `${primary}\n${secondary}`;
}

// Primary: Port name with duration - "Kahului (11h)"
function formatPortStopPrimary(stop) {
    const hours = stop.duration_hours;
    const mins = Math.round((hours % 1) * 60);
    const durationStr = hours >= 24
        ? `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`
        : mins > 0
            ? `${Math.floor(hours)}h ${mins}m`
            : `${Math.round(hours)}h`;
    return `${stop.name} (${durationStr})`;
}

// Secondary: Date with time range - "Jan 9: 7:40 AM → 6:38 PM"
function formatPortStopSecondary(stop) {
    const arrival = new Date(stop.arrival);
    const timeOpts = { hour: 'numeric', minute: '2-digit' };
    const arrDate = arrival.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const arrTime = arrival.toLocaleTimeString([], timeOpts);

    if (stop.departure) {
        const departure = new Date(stop.departure);
        const depDate = departure.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const depTime = departure.toLocaleTimeString([], timeOpts);

        if (arrDate === depDate) {
            return `${arrDate}: ${arrTime} → ${depTime}`;
        } else {
            return `${arrDate}: ${arrTime} → ${depDate}: ${depTime}`;
        }
    }
    return `${arrDate}: ${arrTime}`;
}

// Format voyage segment label for map display (combined for single TextLayer)
function formatVoyageSegmentLabel(segment) {
    const primary = formatVoyageSegmentPrimary(segment);
    const secondary = formatVoyageSegmentSecondary(segment);
    return `${primary}\n${secondary}`;
}

// Primary: Route - "Honolulu → Kahului"
function formatVoyageSegmentPrimary(segment) {
    const fromName = segment.from_port?.name || 'Departure';
    const toName = segment.to_port?.name || (segment.in_progress ? 'En route' : 'Arrival');
    return `${fromName} → ${toName}`;
}

// Secondary: Duration @ speed - "12h 54m @ 15 kts" (no dates - ports have them)
function formatVoyageSegmentSecondary(segment) {
    const hours = segment.duration_hours;
    const mins = Math.round((hours % 1) * 60);
    const durationStr = hours >= 24
        ? `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`
        : mins > 0
            ? `${Math.floor(hours)}h ${mins}m`
            : `${Math.round(hours)}h`;

    return `${durationStr} @ ${segment.avg_speed.toFixed(0)} kts`;
}

function getVesselColor(vessel) {
    if (vessel.mmsi === selectedMmsi.value) return '#ffc800';
    // AtoN gets distinct yellow color
    if (vessel.isAtoN) {
        if (vessel.virtual_aid) return '#ffff00';    // Virtual AtoN - bright yellow
        return '#ffcc00';                            // Physical AtoN - gold
    }
    const type = vessel.ship_type || 0;
    if (type >= 60 && type < 70) return '#00c8ff';   // Passenger
    if (type >= 70 && type < 80) return '#64ff64';   // Cargo
    if (type >= 80 && type < 90) return '#ff6464';   // Tanker
    if (type === 30) return '#ff9632';               // Fishing
    if (type === 52) return '#c864ff';               // Tug
    if (type === 36 || type === 37) return '#ffffff'; // Sailing
    return '#969696';
}

const iconCache = new Map();

function getVesselIcon(vessel) {
    const color = getVesselColor(vessel);
    const isSelected = vessel.mmsi === selectedMmsi.value;
    const isAtoN = vessel.isAtoN;
    const cacheKey = `${color}-${isSelected}-${isAtoN ? 'aton' : 'vessel'}`;

    if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

    const stroke = isSelected ? '#ffffff' : '#000000';
    const strokeWidth = isSelected ? 2 : 1;

    let svg;
    if (isAtoN) {
        // Diamond shape for AtoN
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <path d="M16 4 L28 16 L16 28 L4 16 Z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        </svg>`;
    } else {
        // Triangle (arrow) shape for vessels
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <path d="M16 4 L24 26 L16 20 L8 26 Z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        </svg>`;
    }

    const icon = {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        width: 32, height: 32, anchorX: 16, anchorY: 16,
    };
    iconCache.set(cacheKey, icon);
    return icon;
}

function getVesselTooltip({ object }) {
    if (!object) return null;
    const name = object.shipname || `MMSI: ${object.mmsi}`;

    if (object.isAtoN) {
        const atonType = ATON_TYPES[object.aid_type] || 'AtoN';
        return {
            html: `<div class="vessel-tooltip"><div class="name">${name}</div><div class="info">${atonType}${object.virtual_aid ? ' (Virtual)' : ''}</div></div>`,
            style: { background: 'none', border: 'none', padding: 0 },
        };
    }

    const speed = object.speed != null ? `${object.speed} kts` : 'N/A';
    const course = object.course != null ? `${object.course}°` : 'N/A';
    return {
        html: `<div class="vessel-tooltip"><div class="name">${name}</div><div class="info">Speed: ${speed} | Course: ${course}</div></div>`,
        style: { background: 'none', border: 'none', padding: 0 },
    };
}

function updateHighlightMarker() {
    // Highlight marker disabled - deck.gl ScatterplotLayer handles highlighting
    // Just clean up any existing marker
    if (highlightMarker) {
        highlightMarker.remove();
        highlightMarker = null;
    }
}

function zoomToFitAllVessels() {
    const allVessels = Array.from(vessels.value.values()).filter(v =>
        v.lat != null && v.lon != null &&
        v.lat >= -90 && v.lat <= 90 &&
        v.lon >= -180 && v.lon <= 180
    );
    if (allVessels.length === 0) return;

    if (allVessels.length === 1) {
        map.flyTo({ center: [allVessels[0].lon, allVessels[0].lat], zoom: 12 });
        return;
    }

    const bounds = new maplibregl.LngLatBounds();
    allVessels.forEach(v => bounds.extend([v.lon, v.lat]));
    map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
}

// ============================================================================
// Vessel Table
// ============================================================================

let vesselTable = null;

function initVesselTable() {
    vesselTable = new Tabulator('#vessel-table', {
        data: [],
        layout: 'fitColumns',
        height: '100%',
        selectable: 1,
        columns: [
            { title: 'Name', field: 'shipname', minWidth: 100, formatter: nameFormatter },
            { title: 'MMSI', field: 'mmsi', width: 90 },
            { title: 'Type', field: 'ship_type', width: 60, formatter: typeFormatter },
            { title: 'Spd', field: 'speed', width: 50, formatter: speedFormatter },
            { title: 'Crs', field: 'course', width: 50, formatter: courseFormatter },
        ],
    });

    // Use on() for rowClick - more reliable in Tabulator 6.x
    vesselTable.on('rowClick', (e, row) => selectVessel(row.getData().mmsi));
}

function nameFormatter(cell) {
    const data = cell.getRow().getData();
    return data.shipname || data.mmsi;
}

function typeFormatter(cell) {
    const type = cell.getValue();
    if (type >= 60 && type < 70) return 'Pass';
    if (type >= 70 && type < 80) return 'Cargo';
    if (type >= 80 && type < 90) return 'Tank';
    if (type === 30) return 'Fish';
    if (type === 52) return 'Tug';
    return type || '-';
}

function speedFormatter(cell) {
    const val = cell.getValue();
    return val != null ? val.toFixed(1) : '-';
}

function courseFormatter(cell) {
    const val = cell.getValue();
    return val != null ? `${Math.round(val)}°` : '-';
}

function updateVesselTable() {
    if (!vesselTable) return;
    // Use filteredVessels computed signal - already filtered by timeline, type, and search
    const data = filteredVessels.value;
    vesselTable.replaceData(data);

    // Count vessels available in current time window (ignoring type/search filters)
    // This gives a meaningful "total" that represents what's currently receivable
    const cutoff = timelineCutoff.value;
    let availableInTimeWindow = 0;
    vessels.value.forEach(v => {
        if (v.lat == null || v.lon == null) return;
        const lastUpdate = v.lastUpdate ? new Date(v.lastUpdate).getTime() : 0;
        if (cutoff > 0 && lastUpdate < cutoff) return;
        availableInTimeWindow++;
    });

    const filtered = data.length;
    document.getElementById('vessel-count').textContent = filtered === availableInTimeWindow
        ? `${availableInTimeWindow} ${availableInTimeWindow === 1 ? 'vessel' : 'vessels'}`
        : `${filtered}/${availableInTimeWindow} vessels`;
    updateTypeCounts();
}

// ============================================================================
// Type Filters
// ============================================================================

function initTypeFilters() {
    document.querySelectorAll('.type-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            setTypeFilter(chip.dataset.type);
            // Signal change triggers automatic updates via effects
            updateVesselTable();
            updateLayers();
        });
    });
}

function getVesselCategory(vessel) {
    // Can be called with vessel object or just ship_type number for backwards compat
    if (typeof vessel === 'object') {
        if (vessel.isAtoN) return 'aton';
        const type = vessel.ship_type || 0;
        if (type >= 60 && type < 70) return 'passenger';
        if (type >= 70 && type < 80) return 'cargo';
        if (type >= 80 && type < 90) return 'tanker';
        if (type === 30) return 'fishing';
        if (type === 52) return 'tug';
        return 'other';
    }
    // Legacy: called with just type number
    const type = vessel || 0;
    if (type >= 60 && type < 70) return 'passenger';
    if (type >= 70 && type < 80) return 'cargo';
    if (type >= 80 && type < 90) return 'tanker';
    if (type === 30) return 'fishing';
    if (type === 52) return 'tug';
    return 'other';
}

// Note: applyFilters is no longer needed as filteredVessels computed signal handles filtering
// Left as placeholder for backwards compatibility

function updateTypeCounts() {
    // Count only vessels that pass the time filter (but ignore type/search filters)
    // This shows how many of each type are available within the current time window
    const cutoff = timelineCutoff.value;
    const counts = { all: 0, passenger: 0, cargo: 0, tanker: 0, fishing: 0, tug: 0, aton: 0, other: 0 };

    vessels.value.forEach(v => {
        // Must have position
        if (v.lat == null || v.lon == null) return;

        // Filter by last update time (same as filteredVessels)
        const lastUpdate = v.lastUpdate ? new Date(v.lastUpdate).getTime() : 0;
        if (cutoff > 0 && lastUpdate < cutoff) return;

        counts.all++;
        counts[getVesselCategory(v)]++;
    });

    document.querySelectorAll('.type-chip').forEach(chip => {
        const type = chip.dataset.type;
        const count = counts[type] || 0;
        const label = chip.textContent.split(' ')[0];
        chip.textContent = count > 0 ? `${label} (${count})` : label;
    });
}

// ============================================================================
// Selection and Details
// ============================================================================

function selectVessel(mmsi) {
    console.log(`selectVessel called with mmsi=${mmsi}`);
    selectVesselAction(mmsi);  // Use action from state.js which sets all selection state

    // Update URL hash for debugging
    updateUrlHash(mmsi);

    // Get vessel info for nav title
    const vessel = vessels.value.get(mmsi);
    const vesselName = vessel?.shipname || `MMSI ${mmsi}`;

    // Navigate to vessel detail view
    navigateTo('vessel-detail', vesselName);

    updateVesselDetails();
    updateLayers();
    forceChartUpdate();  // User action - immediate update

    // Fetch historical track data from backend
    fetchTrack(mmsi);

    // Fetch vessel details from API (includes resolved destination)
    fetchVesselDetails(mmsi);

    // Zoom to vessel on map
    zoomToVessel(mmsi);

    // Hide mobile global timeline when vessel is selected
    updateMobileTimelineVisibility();
}

// Fetch vessel details from API (includes resolved destination port)
async function fetchVesselDetails(mmsi) {
    try {
        const response = await fetch(`/api/vessel/${mmsi}`);
        if (!response.ok) return;

        const data = await response.json();

        // Update vessel with resolved destination data
        const vessel = vessels.value.get(mmsi);
        if (vessel && data.destination_port) {
            vessel.destination_port = data.destination_port;
            vessel.destination_distance_nm = data.destination_distance_nm;
            vessel.destination_eta_hours = data.destination_eta_hours;

            // Re-render vessel details with resolved port
            if (selectedMmsi.value === mmsi) {
                updateVesselDetails();
                updateLayers();  // Update destination marker
            }
        }
    } catch (err) {
        console.error('Failed to fetch vessel details:', err);
    }
}

// Store port stops and voyage segments for map display
let currentPortStops = [];
let currentVoyageSegments = [];

// HTML markers for voyage pills (MapLibre markers)
let voyageMarkers = [];

// Create HTML for a port stop pill
function createPortStopHTML(stop, pointerClass = 'pointer-bottom-left') {
    const primary = formatPortStopPrimary(stop);
    const secondary = formatPortStopSecondary(stop);
    // Style arrow in secondary text
    const styledSecondary = escapeHtml(secondary).replace('→', '<span class="arrow">→</span>');
    return `<div class="voyage-pill port ${pointerClass}">
        <div class="voyage-pill-primary">${escapeHtml(primary)}</div>
        <div class="voyage-pill-secondary">${styledSecondary}</div>
    </div>`;
}

// Create HTML for a transit segment pill
function createTransitHTML(segment, pointerClass = 'pointer-bottom') {
    const primary = formatVoyageSegmentPrimary(segment);
    const secondary = formatVoyageSegmentSecondary(segment);
    // Replace arrow with styled span
    const styledPrimary = primary.replace('→', '<span class="arrow">→</span>');
    return `<div class="voyage-pill transit ${pointerClass}">
        <div class="voyage-pill-primary">${styledPrimary}</div>
        <div class="voyage-pill-secondary">${escapeHtml(secondary)}</div>
    </div>`;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Get pointer class from angle (angle from pill center to anchor point)
function getPointerClassFromAngle(angle) {
    // Normalize angle to 0-360
    const deg = ((angle * 180 / Math.PI) + 360) % 360;

    // 8 directions: pointer points TOWARDS anchor
    if (deg >= 337.5 || deg < 22.5) return 'pointer-right';      // Anchor is to the right
    if (deg >= 22.5 && deg < 67.5) return 'pointer-bottom-right'; // Anchor is bottom-right
    if (deg >= 67.5 && deg < 112.5) return 'pointer-bottom';      // Anchor is below
    if (deg >= 112.5 && deg < 157.5) return 'pointer-bottom-left';// Anchor is bottom-left
    if (deg >= 157.5 && deg < 202.5) return 'pointer-left';       // Anchor is to the left
    if (deg >= 202.5 && deg < 247.5) return 'pointer-top-left';   // Anchor is top-left
    if (deg >= 247.5 && deg < 292.5) return 'pointer-top';        // Anchor is above
    return 'pointer-top-right';                                    // Anchor is top-right
}

// Update voyage markers on map (simple version without collision detection)
function updateVoyageMarkers() {
    // Remove existing markers
    voyageMarkers.forEach(m => m.remove());
    voyageMarkers = [];

    // Only show if vessel names are enabled
    if (!settings.value.showVesselNames || !map) return;

    // Create port stop markers
    currentPortStops.forEach((stop, index) => {
        const el = document.createElement('div');
        el.innerHTML = createPortStopHTML(stop, 'pointer-bottom');
        el.style.pointerEvents = 'none';
        el.style.zIndex = String(100 + index);

        const marker = new maplibregl.Marker({
            element: el,
            anchor: 'bottom',
            offset: [0, -10]
        })
            .setLngLat([stop.lon, stop.lat])
            .addTo(map);
        voyageMarkers.push(marker);
    });

    // Create transit segment markers
    currentVoyageSegments.forEach((segment, index) => {
        const el = document.createElement('div');
        el.innerHTML = createTransitHTML(segment, 'pointer-bottom');
        el.style.pointerEvents = 'none';
        el.style.zIndex = String(index);

        const marker = new maplibregl.Marker({
            element: el,
            anchor: 'bottom',
            offset: [0, -10]
        })
            .setLngLat([segment.midpoint_lon, segment.midpoint_lat])
            .addTo(map);
        voyageMarkers.push(marker);
    });
}

// Clear voyage markers (called when vessel deselected)
function clearVoyageMarkers() {
    voyageMarkers.forEach(m => m.remove());
    voyageMarkers = [];
    currentPortStops = [];
    currentVoyageSegments = [];
}

// Fetch historical track from backend API
async function fetchTrack(mmsi) {
    try {
        const response = await fetch(`/api/vessel/${mmsi}/track?include_analysis=true`);
        if (!response.ok) {
            console.error(`Failed to fetch track for ${mmsi}: ${response.status}`);
            return;
        }

        const data = await response.json();
        if (!data.positions || data.positions.length === 0) {
            console.log(`No track data for vessel ${mmsi}`);
            return;
        }

        // Store port stops and voyage segments for map markers
        currentPortStops = data.port_stops || [];
        currentVoyageSegments = data.voyage_segments || [];
        console.log(`Track analysis: ${currentPortStops.length} port stops, ${currentVoyageSegments.length} voyage segments`);

        // Update HTML voyage markers
        updateVoyageMarkers();

        console.log(`Fetched ${data.positions.length} track points for vessel ${mmsi}`);

        // Get vessel's draught from state (static data from Type 5 messages)
        const vessel = vessels.value.get(mmsi);
        const vesselDraught = vessel?.draught ?? null;

        // Convert positions to track point format
        const historicalTrack = data.positions.map(p => ({
            lat: p.lat,
            lon: p.lon,
            time: new Date(p.timestamp).getTime(),
            timestamp: p.timestamp,
            speed: p.speed,
            course: p.course,
            mmsi: mmsi,
            msgType: p.msg_type || 1,
            heading: p.heading,
            nav_status: p.nav_status,
            draught: vesselDraught,
        }));

        // Get existing track (from real-time WebSocket messages)
        const existingTrack = tracks.value.get(mmsi) || [];

        // Merge: historical data + any newer real-time points
        // Historical data comes sorted DESC, so reverse for chronological order
        historicalTrack.reverse();

        // Find the latest historical timestamp
        const latestHistorical = historicalTrack.length > 0
            ? historicalTrack[historicalTrack.length - 1].time
            : 0;

        // Keep only real-time points newer than historical data
        const newerPoints = existingTrack.filter(p => p.time > latestHistorical);

        // Combine: historical + newer real-time
        const mergedTrack = [...historicalTrack, ...newerPoints];

        // Update state using action
        setTrack(mmsi, mergedTrack);

        console.log(`Track for ${mmsi}: ${historicalTrack.length} historical + ${newerPoints.length} real-time = ${mergedTrack.length} total`);

        // Update display if this vessel is still selected
        if (selectedMmsi.value === mmsi) {
            onTrackDataChanged(mmsi);
        }
    } catch (err) {
        console.error(`Error fetching track for ${mmsi}:`, err);
    }
}

function selectMessage(msg) {
    selectedMessage.value = msg;
    setHighlightPoint(msg.lat && msg.lon ? {
        time: new Date(msg.timestamp).getTime(),
        lat: msg.lat, lon: msg.lon,
        speed: msg.speed, course: msg.course
    } : null);

    // Show message details panel
    const sidebarBottom = document.getElementById('sidebar-bottom');
    sidebarBottom.classList.remove('hidden');
    document.getElementById('detail-title').textContent = 'Message Details';
    document.getElementById('vessel-details').classList.add('hidden');
    document.getElementById('message-details').classList.remove('hidden');

    updateMessageDetails();
    updateLayers();
    forceChartUpdate();  // User action - immediate update
}

function closeDetails() {
    // Navigate back to vessels list
    navigateToRoot('vessels');

    // Reset timeline slider to 100 (now)
    const slider = document.getElementById('timeline-slider');
    slider.value = 100;
    updateTimelineLabel();

    updateLayers();
}

function formatETA(v) {
    if (v.eta_month == null || v.eta_day == null) return 'N/A';
    // AIS ETA doesn't include year, assume current/next occurrence
    const now = new Date();
    let year = now.getUTCFullYear();
    // If the ETA month is before current month, assume next year
    if (v.eta_month < now.getUTCMonth() + 1) year++;

    const eta = new Date(Date.UTC(year, v.eta_month - 1, v.eta_day, v.eta_hour || 0, v.eta_minute || 0));
    const diffMs = eta - now;
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    const dateStr = eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = eta.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    if (diffHours > 0 && diffHours < 24 * 30) {
        const days = Math.floor(diffHours / 24);
        const hours = diffHours % 24;
        const remaining = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
        return `${dateStr} ${timeStr} (${remaining})`;
    }
    return `${dateStr} ${timeStr}`;
}

function updateVesselDetails() {
    const container = document.getElementById('vessel-details');
    const mmsi = selectedMmsi.value;
    if (!mmsi || !vessels.value.has(mmsi)) {
        container.innerHTML = '<p class="no-selection">Select a vessel</p>';
        return;
    }

    const v = vessels.value.get(mmsi);

    // AtoN (Aid-to-Navigation) details
    if (v.isAtoN) {
        const atonType = ATON_TYPES[v.aid_type] || v.aid_type || 'Unknown';
        const length = (v.to_bow || 0) + (v.to_stern || 0);
        const width = (v.to_port || 0) + (v.to_starboard || 0);
        const dims = length && width ? `${length}m × ${width}m` : 'N/A';

        container.innerHTML = `
            <div class="vessel-name">${v.shipname || 'Unknown AtoN'}</div>
            <div class="vessel-mmsi">MMSI: ${v.mmsi}</div>
            <div class="detail-section">
                <h3>Position</h3>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Lat</div><div class="detail-value">${v.lat?.toFixed(5) || 'N/A'}°</div></div>
                    <div class="detail-item"><div class="detail-label">Lon</div><div class="detail-value">${v.lon?.toFixed(5) || 'N/A'}°</div></div>
                </div>
            </div>
            <div class="detail-section">
                <h3>Aid Info</h3>
                <div class="detail-grid">
                    <div class="detail-item"><div class="detail-label">Type</div><div class="detail-value">${atonType}</div></div>
                    <div class="detail-item"><div class="detail-label">Virtual</div><div class="detail-value">${v.virtual_aid ? 'Yes' : 'No'}</div></div>
                    <div class="detail-item"><div class="detail-label">Off Position</div><div class="detail-value">${v.off_position ? 'Yes' : 'No'}</div></div>
                    <div class="detail-item"><div class="detail-label">Dimensions</div><div class="detail-value">${dims}</div></div>
                </div>
            </div>
        `;
        return;
    }

    // Regular vessel details
    const shipType = SHIP_TYPES[v.ship_type] || v.ship_type || 'Unknown';
    const navStatus = NAV_STATUS[v.status] || v.status || 'Unknown';
    const length = (v.to_bow || 0) + (v.to_stern || 0);
    const width = (v.to_port || 0) + (v.to_starboard || 0);
    const dims = length && width ? `${length}m × ${width}m` : 'N/A';
    const draught = v.draught != null ? `${v.draught}m` : 'N/A';
    const eta = formatETA(v);

    // Use API-resolved destination if available, fallback to local lookup
    let distanceStr = 'N/A';
    let calcEtaStr = '';
    if (v.destination_port) {
        // Use server-resolved port data
        const portName = v.destination_port.name;
        const distance = v.destination_distance_nm;
        const etaHours = v.destination_eta_hours;

        if (distance != null) {
            distanceStr = `${Math.round(distance)} nm to ${portName}`;
            if (etaHours != null) {
                const days = Math.floor(etaHours / 24);
                const hours = Math.round(etaHours % 24);
                calcEtaStr = days > 0 ? ` (~${days}d ${hours}h at current speed)` : ` (~${hours}h at current speed)`;
            }
        } else {
            distanceStr = portName;  // Port resolved but no position to calculate from
        }
    } else {
        // Fallback to local PORTS lookup
        const distInfo = getDistanceToDestination(v);
        if (distInfo) {
            distanceStr = `${Math.round(distInfo.distance)} nm to ${distInfo.portName}`;
            if (distInfo.etaHours != null) {
                const days = Math.floor(distInfo.etaHours / 24);
                const hours = Math.round(distInfo.etaHours % 24);
                calcEtaStr = days > 0 ? ` (~${days}d ${hours}h at current speed)` : ` (~${hours}h at current speed)`;
            }
        }
    }

    // Format port visits if available
    let portVisitsHtml = '';
    if (v.port_visits && v.port_visits.length > 0) {
        const visitItems = v.port_visits.map(visit => {
            const arrivalDate = new Date(visit.arrival);
            const dateStr = arrivalDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const durationStr = visit.duration_hours
                ? `${Math.round(visit.duration_hours)}h`
                : '';
            return `<div class="port-visit-item">
                <span class="port-visit-date">${dateStr}</span>
                <span class="port-visit-name">${visit.name}</span>
                <span class="port-visit-duration">${durationStr}</span>
            </div>`;
        }).join('');

        portVisitsHtml = `
        <div class="detail-section">
            <h3>Recent Ports</h3>
            <div class="port-visits-list">${visitItems}</div>
        </div>`;
    }

    container.innerHTML = `
        <div class="vessel-name">${v.shipname || 'Unknown Vessel'}</div>
        <div class="vessel-mmsi">MMSI: ${v.mmsi}${v.callsign ? ` | ${v.callsign}` : ''}</div>
        <div class="detail-section">
            <h3>Position</h3>
            <div class="detail-grid">
                <div class="detail-item"><div class="detail-label">Lat</div><div class="detail-value">${v.lat?.toFixed(5) || 'N/A'}°</div></div>
                <div class="detail-item"><div class="detail-label">Lon</div><div class="detail-value">${v.lon?.toFixed(5) || 'N/A'}°</div></div>
                <div class="detail-item"><div class="detail-label">Speed</div><div class="detail-value">${v.speed != null ? v.speed + ' kts' : 'N/A'}</div></div>
                <div class="detail-item"><div class="detail-label">Course</div><div class="detail-value">${v.course != null ? v.course + '°' : 'N/A'}</div></div>
                <div class="detail-item"><div class="detail-label">Heading</div><div class="detail-value">${v.heading != null && v.heading !== 511 ? v.heading + '°' : 'N/A'}</div></div>
                <div class="detail-item"><div class="detail-label">Status</div><div class="detail-value">${navStatus}</div></div>
            </div>
        </div>
        <div class="detail-section">
            <h3>Voyage</h3>
            <div class="detail-grid">
                <div class="detail-item"><div class="detail-label">Destination</div><div class="detail-value">${v.destination || 'N/A'}</div></div>
                <div class="detail-item"><div class="detail-label">Distance</div><div class="detail-value">${distanceStr}${calcEtaStr}</div></div>
                <div class="detail-item"><div class="detail-label">ETA</div><div class="detail-value">${eta}</div></div>
                <div class="detail-item"><div class="detail-label">Draught</div><div class="detail-value">${draught}</div></div>
            </div>
        </div>
        ${portVisitsHtml}
        <div class="detail-section">
            <h3>Vessel Info</h3>
            <div class="detail-grid">
                <div class="detail-item"><div class="detail-label">Type</div><div class="detail-value">${shipType}</div></div>
                <div class="detail-item"><div class="detail-label">IMO</div><div class="detail-value">${v.imo || 'N/A'}</div></div>
                <div class="detail-item"><div class="detail-label">Dimensions</div><div class="detail-value">${dims}</div></div>
            </div>
        </div>
    `;
}

// Human-readable field labels and formatting
const MESSAGE_FIELD_CONFIG = {
    msg_type: { label: 'Message Type', format: v => `Type ${v} (${MESSAGE_TYPE_NAMES[v] || 'Unknown'})` },
    mmsi: { label: 'MMSI' },
    shipname: { label: 'Ship Name' },
    callsign: { label: 'Call Sign' },
    imo: { label: 'IMO Number' },
    lat: { label: 'Latitude', format: v => `${v.toFixed(5)}°` },
    lon: { label: 'Longitude', format: v => `${v.toFixed(5)}°` },
    speed: { label: 'Speed', format: v => `${v.toFixed(1)} kts` },
    course: { label: 'Course', format: v => `${v.toFixed(1)}°` },
    heading: { label: 'Heading', format: v => v === 511 ? 'N/A' : `${v}°` },
    status: { label: 'Nav Status', format: v => NAV_STATUS[v] || `Unknown (${v})` },
    nav_status: { label: 'Nav Status', format: v => NAV_STATUS[v] || `Unknown (${v})` },
    turn: { label: 'Rate of Turn', format: v => v === 128 ? 'N/A' : `${v}°/min` },
    accuracy: { label: 'Position Accuracy', format: v => v ? 'High (<10m)' : 'Low (>10m)' },
    maneuver: { label: 'Maneuver', format: v => v === 0 ? 'Not available' : v === 1 ? 'No special' : 'Special maneuver' },
    raim: { label: 'RAIM Flag', format: v => v ? 'In use' : 'Not in use' },
    radio: { label: 'Radio Status' },
    second: { label: 'UTC Second' },
    ship_type: { label: 'Ship Type', format: v => SHIP_TYPES[v] || `Unknown (${v})` },
    destination: { label: 'Destination' },
    to_bow: { label: 'Bow Distance', format: v => `${v} m` },
    to_stern: { label: 'Stern Distance', format: v => `${v} m` },
    to_port: { label: 'Port Distance', format: v => `${v} m` },
    to_starboard: { label: 'Starboard Distance', format: v => `${v} m` },
    timestamp: { label: 'Timestamp', format: v => new Date(v).toLocaleString() },
    time: { label: 'Time', format: v => typeof v === 'string' ? v : new Date(v).toLocaleTimeString() },
    repeat: { label: 'Repeat Indicator' },
    id: { label: 'Message ID' },
    // Binary message fields
    message_type: { label: 'Category' },
    dac: { label: 'DAC (Designated Area Code)' },
    fid: { label: 'FID (Function ID)' },
    dest_mmsi: { label: 'Destination MMSI' },
    text: { label: 'Safety Text' },
    // Hide internal fields
    raw_message_id: { hidden: true },
    raw_data: { hidden: true },
    decoded_json: { hidden: true, custom: true },  // Custom rendering
};

function updateMessageDetails() {
    const container = document.getElementById('message-details');
    const msg = selectedMessage.value;
    if (!msg) {
        container.innerHTML = '';
        return;
    }

    // Filter and format standard fields
    const fields = Object.entries(msg)
        .filter(([k]) => {
            const config = MESSAGE_FIELD_CONFIG[k];
            return !config?.hidden && !['raw_nmea'].includes(k);
        })
        .map(([k, v]) => {
            const config = MESSAGE_FIELD_CONFIG[k];
            const label = config?.label || k;
            const formatted = config?.format ? config.format(v) : formatValue(v);
            return `<div class="message-field"><span class="message-field-key">${label}</span><span class="message-field-value">${formatted}</span></div>`;
        })
        .join('');

    // Render decoded binary data if present
    let decodedSection = '';
    if (msg.decoded_json) {
        try {
            const decoded = typeof msg.decoded_json === 'string' ? JSON.parse(msg.decoded_json) : msg.decoded_json;
            if (decoded && typeof decoded === 'object') {
                decodedSection = renderDecodedBinaryData(decoded);
            }
        } catch (e) {
            console.error('Failed to parse decoded_json:', e);
        }
    }

    container.innerHTML = `<div class="message-fields">${fields}</div>${decodedSection}`;
}

function renderDecodedBinaryData(decoded) {
    // Check if it's an error message from the decoder
    if (decoded.error) {
        return `<div class="decoded-section decoded-error">
            <h4>Binary Payload</h4>
            <div class="decoded-note">${decoded.error}</div>
        </div>`;
    }

    // Render decoded fields
    const fields = Object.entries(decoded)
        .filter(([k]) => k !== 'error')
        .map(([k, v]) => {
            const label = formatDecodedFieldLabel(k);
            const value = formatDecodedValue(k, v);
            return `<div class="message-field"><span class="message-field-key">${label}</span><span class="message-field-value">${value}</span></div>`;
        })
        .join('');

    return `<div class="decoded-section">
        <h4>Decoded Payload</h4>
        <div class="decoded-fields">${fields}</div>
    </div>`;
}

function formatDecodedFieldLabel(key) {
    // Convert snake_case to Title Case
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDecodedValue(key, value) {
    if (value === null || value === undefined) return 'N/A';

    // Handle specific field types
    if (key.includes('lat') || key.includes('latitude')) {
        return typeof value === 'number' ? `${value.toFixed(5)}°` : value;
    }
    if (key.includes('lon') || key.includes('longitude')) {
        return typeof value === 'number' ? `${value.toFixed(5)}°` : value;
    }
    if (key.includes('speed')) {
        return typeof value === 'number' ? `${value.toFixed(1)} kts` : value;
    }
    if (key.includes('course') || key.includes('direction') || key.includes('heading')) {
        return typeof value === 'number' ? `${value.toFixed(1)}°` : value;
    }
    if (key.includes('temperature') || key.includes('temp')) {
        return typeof value === 'number' ? `${value.toFixed(1)}°C` : value;
    }
    if (key.includes('pressure')) {
        return typeof value === 'number' ? `${value.toFixed(1)} hPa` : value;
    }
    if (key.includes('wind')) {
        return typeof value === 'number' ? `${value.toFixed(1)} m/s` : value;
    }

    // Handle arrays and objects
    if (Array.isArray(value)) {
        return value.map(v => formatDecodedValue('', v)).join(', ');
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

function formatValue(v) {
    if (v === null || v === undefined) return 'N/A';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(4);
    return String(v);
}

// Find and select the message corresponding to a track point
function selectTrackPointMessage(trackPoint) {
    // Find message with matching timestamp and coordinates
    const targetTime = trackPoint.time;
    const msg = messages.value.find(m => {
        const msgTime = new Date(m.timestamp).getTime();
        return Math.abs(msgTime - targetTime) < 1000 && // Within 1 second
               m.lat != null && m.lon != null;
    });

    if (msg) {
        selectMessage(msg);
    }
}

// ============================================================================
// Global Highlight
// ============================================================================

// Unified hover handler - called by BOTH track points and chart cursor
// This ensures consistent behavior regardless of where the hover originates
function onPointHover(point, source) {
    if (!point) {
        // Mouse left - clear hover highlight
        setHighlightPoint(null);

        // If there's a clicked point, show its info; otherwise hide info
        const clicked = clickedPoint.value;
        if (clicked) {
            updateLayers();  // Will show clickedPoint layer
            showHighlightInfo(clicked);
        } else {
            updateLayers();
            showHighlightInfo(null);
        }
        return;
    }

    setHighlightPoint(point);
    updateLayers();
    showHighlightInfo(point);

    // Sync charts only if hover came from track point (avoid infinite loop)
    if (source === 'track') {
        syncChartsToPoint(point);
    }
}

// Unified click handler - called by BOTH track points and chart click
// Sets a persistent highlight that survives hover changes
function onPointClick(point) {
    if (!point) return;

    setClickedPoint(point);
    setHighlightPoint(point);
    updateLayers();
    showHighlightInfo(point);
    syncChartsToPoint(point);
    selectTrackPointMessage(point);
}

// Note: setHighlightPoint is now imported from state.js
// Legacy wrapper removed to avoid conflict

function showHighlightInfo(point) {
    const info = document.getElementById('highlight-info');
    if (!point) {
        info.classList.add('hidden');
        return;
    }
    info.classList.remove('hidden');
    const time = new Date(point.timestamp || point.time).toLocaleTimeString();
    const draughtStr = point.draught != null ? ` | Draught: ${point.draught}m` : '';
    info.textContent = `${time} | Speed: ${point.speed?.toFixed(1) || 'N/A'} kts | Course: ${point.course?.toFixed(0) || 'N/A'}°${draughtStr}`;
}

// ============================================================================
// Charts
// ============================================================================

let speedChart = null;
let courseChart = null;
let draughtChart = null;

function updateCharts() {
    const chartsPanel = document.getElementById('charts-panel');
    const mmsi = selectedMmsi.value;

    if (!mmsi || !tracks.value.has(mmsi)) {
        chartsPanel.classList.add('hidden');
        return;
    }

    // Use viewport-filtered track for charts (forCharts=true)
    const track = getFilteredTrack(mmsi, true);
    if (track.length < 2) {
        chartsPanel.classList.add('hidden');
        return;
    }

    chartsPanel.classList.remove('hidden');

    const times = track.map(p => p.time / 1000);
    const speeds = track.map(p => p.speed ?? null);
    const courses = track.map(p => p.course ?? null);
    const draughts = track.map(p => p.draught ?? null);

    const speedContainer = document.getElementById('speed-chart');
    const courseContainer = document.getElementById('course-chart');
    const draughtContainer = document.getElementById('draught-chart');
    const chartHeight = speedContainer.parentElement.offsetHeight - 24;
    const chartWidth = speedContainer.offsetWidth;

    if (chartWidth < 50 || chartHeight < 30) return;

    // Speed chart - x-axis reversed (newest on left)
    speedContainer.innerHTML = '';
    if (speeds.some(s => s != null)) {
        speedChart = new uPlot({
            width: chartWidth,
            height: chartHeight,
            cursor: { show: true, sync: { key: 'ais' }, drag: { x: true, y: false } },
            select: { show: true, over: true },
            legend: { show: false },
            scales: { x: { time: true, dir: -1 } },
            axes: [
                { stroke: '#a0a0a0', grid: { stroke: '#2a2a4a' }, font: '10px sans-serif' },
                { stroke: '#a0a0a0', grid: { stroke: '#2a2a4a' }, font: '10px sans-serif' },
            ],
            series: [
                {},
                { stroke: '#00d9ff', width: 2, fill: 'rgba(0, 217, 255, 0.1)' },
            ],
            hooks: {
                setCursor: [syncCursor],
                setSelect: [handleChartSelect],
            },
        }, [times, speeds], speedContainer);

        // Add click handler for point selection
        speedChart.over.addEventListener('click', () => handleChartClick(speedChart));
    }

    // Course chart - x-axis reversed (newest on left)
    courseContainer.innerHTML = '';
    if (courses.some(c => c != null)) {
        courseChart = new uPlot({
            width: chartWidth,
            height: chartHeight,
            cursor: { show: true, sync: { key: 'ais' }, drag: { x: true, y: false } },
            select: { show: true, over: true },
            legend: { show: false },
            scales: { x: { time: true, dir: -1 }, y: { range: [0, 360] } },
            axes: [
                { stroke: '#a0a0a0', grid: { stroke: '#2a2a4a' }, font: '10px sans-serif' },
                { stroke: '#a0a0a0', grid: { stroke: '#2a2a4a' }, font: '10px sans-serif' },
            ],
            series: [
                {},
                { stroke: '#ff9632', width: 2, fill: 'rgba(255, 150, 50, 0.1)' },
            ],
            hooks: {
                setCursor: [syncCursor],
                setSelect: [handleChartSelect],
            },
        }, [times, courses], courseContainer);

        // Add click handler for point selection
        courseChart.over.addEventListener('click', () => handleChartClick(courseChart));
    }

    // Draught chart - x-axis reversed (newest on left)
    draughtContainer.innerHTML = '';
    if (draughts.some(d => d != null)) {
        draughtChart = new uPlot({
            width: chartWidth,
            height: chartHeight,
            cursor: { show: true, sync: { key: 'ais' }, drag: { x: true, y: false } },
            select: { show: true, over: true },
            legend: { show: false },
            scales: { x: { time: true, dir: -1 } },
            axes: [
                { stroke: '#a0a0a0', grid: { stroke: '#2a2a4a' }, font: '10px sans-serif' },
                { stroke: '#a0a0a0', grid: { stroke: '#2a2a4a' }, font: '10px sans-serif' },
            ],
            series: [
                {},
                { stroke: '#00ff88', width: 2, fill: 'rgba(0, 255, 136, 0.1)' },
            ],
            hooks: {
                setCursor: [syncCursor],
                setSelect: [handleChartSelect],
            },
        }, [times, draughts], draughtContainer);

        // Add click handler for point selection
        draughtChart.over.addEventListener('click', () => handleChartClick(draughtChart));
    }
}

// Handle click on chart to select a point
function handleChartClick(u) {
    const idx = u.cursor.idx;
    const mmsi = selectedMmsi.value;
    if (idx == null || !mmsi) return;

    const track = getFilteredTrack(mmsi, true);
    if (idx >= 0 && idx < track.length) {
        onPointClick(track[idx]);
    }
}

function handleChartSelect(u) {
    const selection = u.select;
    const mmsi = selectedMmsi.value;

    // Handle click - select the point at cursor position
    if (selection.width < 10) {
        const idx = u.cursor.idx;
        if (idx != null && mmsi) {
            const track = getFilteredTrack(mmsi, true);
            if (idx >= 0 && idx < track.length) {
                onPointClick(track[idx]);
            }
        }
    }

    // Clear the selection rectangle
    u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
}

function syncCursor(u) {
    const idx = u.cursor.idx;
    const mmsi = selectedMmsi.value;
    if (idx == null || !mmsi) {
        // Cursor left chart - use unified hover handler to clear
        onPointHover(null, 'chart');
        return;
    }

    // Use the same viewport-filtered track as the charts
    const track = getFilteredTrack(mmsi, true);
    if (idx >= 0 && idx < track.length) {
        const point = track[idx];
        // Use unified hover handler
        onPointHover(point, 'chart');
    }
}

function syncChartsToPoint(point) {
    const mmsi = selectedMmsi.value;
    if (!speedChart || !courseChart || !mmsi) {
        return;
    }

    // Use the same viewport-filtered track as the charts
    const track = getFilteredTrack(mmsi, true);
    const idx = track.findIndex(p => p.time === point.time);

    if (idx >= 0) {
        // Get the time value at this index (in seconds, as used by charts)
        const timeVal = point.time / 1000;

        // Convert time value to pixel position
        const left = speedChart.valToPos(timeVal, 'x');
        const top = speedChart.valToPos(speedChart.data[1][idx], 'y');

        // Set cursor position on all charts
        speedChart.setCursor({ left, top });
        courseChart.setCursor({ left, top: courseChart.valToPos(courseChart.data[1][idx], 'y') });
        if (draughtChart) {
            draughtChart.setCursor({ left, top: draughtChart.valToPos(draughtChart.data[1][idx], 'y') });
        }
    }
}

// ============================================================================
// Global Timeline Slider
// ============================================================================

async function fetchTimeRange() {
    try {
        const response = await fetch('/api/timerange');
        const data = await response.json();
        if (data.oldest && data.newest) {
            setTimelineRange(
                new Date(data.oldest).getTime(),
                new Date(data.newest).getTime()
            );
            console.log(`Timeline range: ${data.oldest} to ${data.newest}`);
        }
    } catch (e) {
        console.warn('Failed to fetch time range:', e);
    }
}

function initTimelineSlider() {
    const slider = document.getElementById('timeline-slider');
    const label = document.getElementById('timeline-label');

    // Fetch time range from backend
    fetchTimeRange();

    slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        setTimelinePosition(value);

        // Sync mobile slider
        const mobileSlider = document.getElementById('mobile-timeline-slider');
        if (mobileSlider) mobileSlider.value = value;

        // Different behavior based on whether a vessel is selected
        if (selectedMmsi.value) {
            // Vessel mode: scrub through vessel's track
            updateVesselTimelineMarker();
        } else {
            // Global mode: filter visible vessels - signals handle value updates
            updateVesselTable();  // Refresh table with new filtered data
            updateLayers();
            updateMobileTimelineLabel();
        }
        updateTimelineLabel();
    });

    // Double-click to reset to now/end
    slider.addEventListener('dblclick', () => {
        slider.value = 100;
        setTimelinePosition(100);
        setHighlightPoint(null);

        // Sync mobile slider
        const mobileSlider = document.getElementById('mobile-timeline-slider');
        if (mobileSlider) mobileSlider.value = 100;

        updateTimelineLabel();
        updateMobileTimelineLabel();
        updateVesselTable();
        updateLayers();
    });

    updateTimelineLabel();
}

function updateVesselTimelineMarker() {
    const mmsi = selectedMmsi.value;
    if (!mmsi) return;

    const track = tracks.value.get(mmsi) || [];
    if (track.length === 0) return;

    // Map slider position (0-100) to track index
    const pos = timelinePosition.value;
    const idx = Math.min(
        Math.floor((pos / 100) * track.length),
        track.length - 1
    );

    const point = track[idx];
    if (point) {
        setHighlightPoint(point);
        updateHighlightMarker();
        updateLayers();
    }
}

// Note: updateTimelineValue is no longer needed - timelineValue is a computed signal

function updateTimelineLabel() {
    const label = document.getElementById('timeline-label');
    const hp = highlightPoint.value;
    const mmsi = selectedMmsi.value;
    const pos = timelinePosition.value;
    const tv = timelineValue.value;

    // Vessel mode: show timestamp from track
    if (mmsi && hp) {
        const date = new Date(hp.time);
        const now = new Date();

        // If same day, show time only
        if (date.toDateString() === now.toDateString()) {
            label.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } else {
            label.textContent = date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
                ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return;
    }

    // Global mode: show timeline position
    if (pos >= 100 || !tv) {
        label.textContent = 'Now';
        return;
    }

    const date = new Date(tv);
    const now = new Date();

    // If same day, show time only
    if (date.toDateString() === now.toDateString()) {
        label.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        // Show date and time
        label.textContent = date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
            ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

// Note: getTimelineCutoff and getTimelineEnd are now computed signals
// Use timelineCutoff.value and timelineEnd.value instead

// ============================================================================
// Geolocation
// ============================================================================

let userLocationMarker = null;

function initGeolocation() {
    const btn = document.getElementById('locate-btn');

    btn.addEventListener('click', () => {
        // Check for secure context (required for geolocation in modern browsers)
        if (!window.isSecureContext) {
            alert('Geolocation requires HTTPS. Please access this page over HTTPS or localhost.');
            console.warn('Geolocation blocked: not a secure context');
            return;
        }

        if (!navigator.geolocation) {
            alert('Geolocation not supported by this browser');
            return;
        }

        btn.classList.add('locating');
        btn.textContent = 'Locating...';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                btn.classList.remove('locating');
                btn.textContent = 'My Location';
                const { latitude, longitude, accuracy } = pos.coords;
                console.log('Geolocation:', latitude, longitude, 'accuracy:', accuracy, 'm');

                map.flyTo({ center: [longitude, latitude], zoom: 14 });

                if (userLocationMarker) userLocationMarker.remove();
                const el = document.createElement('div');
                el.className = 'user-location-marker';
                el.innerHTML = '<div class="pulse"></div><div class="dot"></div>';
                userLocationMarker = new maplibregl.Marker(el)
                    .setLngLat([longitude, latitude])
                    .addTo(map);
            },
            (err) => {
                btn.classList.remove('locating');
                btn.textContent = 'My Location';
                console.error('Geolocation error:', err.code, err.message);

                let msg;
                switch (err.code) {
                    case err.PERMISSION_DENIED:
                        msg = 'Location permission denied. Please allow location access in your browser settings.';
                        break;
                    case err.POSITION_UNAVAILABLE:
                        msg = 'Location information unavailable. Make sure location services are enabled.';
                        break;
                    case err.TIMEOUT:
                        msg = 'Location request timed out. Please try again.';
                        break;
                    default:
                        msg = 'Could not get location: ' + err.message;
                }
                alert(msg);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
        );
    });
}

// ============================================================================
// Resize Handlers
// ============================================================================

function initResizeHandlers() {
    // Sidebar horizontal resize
    const sidebarResize = document.getElementById('sidebar-resize');
    const sidebar = document.getElementById('sidebar');
    let isResizingSidebar = false;

    if (sidebarResize) {
        sidebarResize.addEventListener('mousedown', () => {
            isResizingSidebar = true;
            sidebarResize.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
    }

    // Charts vertical resize
    const chartsResize = document.getElementById('charts-resize');
    const chartsPanel = document.getElementById('charts-panel');
    let isResizingCharts = false;

    if (chartsResize) {
        chartsResize.addEventListener('mousedown', () => {
            isResizingCharts = true;
            chartsResize.classList.add('resizing');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (isResizingSidebar) {
            const mainWidth = document.getElementById('main').offsetWidth;
            const newWidth = mainWidth - e.clientX;
            if (newWidth >= 280 && newWidth <= 500) {
                sidebar.style.width = newWidth + 'px';
            }
        }

        if (isResizingCharts) {
            const appRect = document.getElementById('app').getBoundingClientRect();
            const newHeight = appRect.bottom - e.clientY;
            if (newHeight >= 80 && newHeight <= 300) {
                chartsPanel.style.height = newHeight + 'px';
                updateCharts();
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizingSidebar) {
            isResizingSidebar = false;
            if (sidebarResize) sidebarResize.classList.remove('resizing');
        }
        if (isResizingCharts) {
            isResizingCharts = false;
            if (chartsResize) chartsResize.classList.remove('resizing');
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    // Window resize
    window.addEventListener('resize', () => {
        updateCharts();
    });
}

// ============================================================================
// Close Details Button (Legacy - now handled by back navigation)
// ============================================================================

function initCloseDetails() {
    // Legacy function - close now handled by navigateBack()
}

// ============================================================================
// Search
// ============================================================================

function initSearch() {
    document.getElementById('search-input').addEventListener('input', (e) => {
        setSearchText(e.target.value);
        // Signal change triggers filteredVessels to recompute
        updateVesselTable();
        updateLayers();
    });
}

// ============================================================================
// List Tabs (Legacy - now handled by hierarchical navigation)
// ============================================================================

function initListTabs() {
    // Legacy function - tabs now handled by initNavigation()
    // Kept for backwards compatibility
}

// ============================================================================
// Message Table
// ============================================================================

let messageTable = null;

function initMessageTable() {
    messageTable = new Tabulator('#message-table', {
        data: [],
        layout: 'fitColumns',
        height: '100%',
        selectable: 1,
        columns: [
            { title: 'Time', field: 'time', width: 70 },
            { title: 'Type', field: 'msg_type', width: 40 },
            { title: 'MMSI', field: 'mmsi', width: 90 },
            { title: 'Name', field: 'shipname', minWidth: 80 },
        ],
    });

    // Use on() for rowClick - more reliable in Tabulator 6.x
    messageTable.on('rowClick', (e, row) => {
        const msg = row.getData();
        selectMessage(msg);
        // Also select the vessel if it has a position
        if (msg.mmsi && (msg.lat || msg.lon)) {
            selectVesselAction(msg.mmsi);
        }
    });
}

function updateMessageTable() {
    if (!messageTable) return;
    const displayData = messages.value.slice(0, 200).map(m => ({
        ...m,
        time: new Date(m.timestamp || Date.now()).toLocaleTimeString(),
    }));
    messageTable.replaceData(displayData);
}

// ============================================================================
// Style Selector
// ============================================================================

function initStyleSelector() {
    const selector = document.getElementById('style-selector');
    selector.value = mapStyle.value;
    selector.addEventListener('change', (e) => {
        setMapStyle(e.target.value);
        map.setStyle(MAP_STYLES[e.target.value]);
    });
}

// ============================================================================
// WebSocket
// ============================================================================

let ws = null;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/ais`;
    console.log('Connecting to WebSocket:', wsUrl);
    console.log('Page protocol:', window.location.protocol, 'Host:', window.location.host);

    try {
        ws = new WebSocket(wsUrl);
        console.log('WebSocket object created, readyState:', ws.readyState);
    } catch (e) {
        console.error('WebSocket creation failed:', e.name, e.message);
        return;
    }

    ws.onopen = () => {
        console.log('WebSocket connected, readyState:', ws.readyState);
        setConnected(true);
        updateConnectionStatus();
    };

    ws.onclose = (event) => {
        // Close codes: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
        console.log('WebSocket closed - code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
        setConnected(false);
        updateConnectionStatus();
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        console.error('WebSocket readyState on error:', ws ? ws.readyState : 'null');
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.ping) return;

            // Handle batch history message
            if (msg.type === 'history_batch' && msg.messages) {
                console.log(`Processing ${msg.messages.length} historical messages`);
                // Use batchUpdate for efficient bulk updates
                batchUpdate(() => {
                    for (const m of msg.messages) {
                        handleMessage(m, true); // true = batch mode, skip UI updates
                    }
                });
                // Single UI update after all messages processed
                document.getElementById('message-count').textContent = `${messageCount.value} messages`;
                updateVesselTable();
                updateMessageTable();
                updateLayers();

                // Zoom to fit all vessels after history load (unless URL has specific vessel)
                if (!mapInitialized.value && vessels.value.size > 0) {
                    setMapInitialized(true);
                    // Don't zoom to all if URL hash specifies a vessel
                    if (!parseUrlHash()) {
                        setTimeout(zoomToFitAllVessels, 100);
                    }
                }
                console.log('History batch processed');
                return;
            }

            handleMessage(msg, false);
        } catch (e) {
            console.error('Parse error:', e);
        }
    };
}

function updateConnectionStatus() {
    const el = document.getElementById('connection-status');
    const isConnected = connected.value;
    el.className = isConnected ? 'connected' : 'disconnected';
    el.querySelector('.status-text').textContent = isConnected ? 'Connected' : 'Disconnected';
}

// ============================================================================
// Message Handling
// ============================================================================

function handleMessage(msg, batchMode = false) {
    // Store message using action
    addMessage(msg);

    const mmsi = msg.mmsi;
    if (!mmsi) return;

    const msgType = msg.msg_type;

    // Build vessel update data object
    const vesselUpdate = { mmsi };

    // Always extract static vessel data if present (handles enriched messages from backend)
    if (msg.shipname) vesselUpdate.shipname = msg.shipname.trim();
    if (msg.callsign) vesselUpdate.callsign = msg.callsign.trim();
    if (msg.imo) vesselUpdate.imo = msg.imo;
    if (msg.ship_type != null) vesselUpdate.ship_type = msg.ship_type;
    if (msg.destination) vesselUpdate.destination = msg.destination.trim();
    if (msg.to_bow != null) vesselUpdate.to_bow = msg.to_bow;
    if (msg.to_stern != null) vesselUpdate.to_stern = msg.to_stern;
    if (msg.to_port != null) vesselUpdate.to_port = msg.to_port;
    if (msg.to_starboard != null) vesselUpdate.to_starboard = msg.to_starboard;
    // Backend sends nav_status, frontend uses status
    if (msg.nav_status != null) vesselUpdate.status = msg.nav_status;
    // Draught and ETA from enriched messages (backend sends eta_month, etc.)
    if (msg.draught != null) vesselUpdate.draught = msg.draught;
    if (msg.eta_month != null) vesselUpdate.eta_month = msg.eta_month;
    if (msg.eta_day != null) vesselUpdate.eta_day = msg.eta_day;
    if (msg.eta_hour != null) vesselUpdate.eta_hour = msg.eta_hour;
    if (msg.eta_minute != null) vesselUpdate.eta_minute = msg.eta_minute;

    let hasPosition = false;

    // Position reports (1, 2, 3)
    if ([1, 2, 3].includes(msgType)) {
        if (msg.lat != null && msg.lon != null && msg.lat !== 91 && msg.lon !== 181) {
            vesselUpdate.lat = msg.lat;
            vesselUpdate.lon = msg.lon;
            hasPosition = true;
        }
        if (msg.speed != null) vesselUpdate.speed = msg.speed;
        if (msg.course != null) vesselUpdate.course = msg.course;
        if (msg.heading != null) vesselUpdate.heading = msg.heading;
        if (msg.status != null) vesselUpdate.status = msg.status;
        vesselUpdate.lastUpdate = msg.timestamp || new Date().toISOString();
    }

    // Static data (5)
    if (msgType === 5) {
        if (msg.shipname) vesselUpdate.shipname = msg.shipname.trim();
        if (msg.callsign) vesselUpdate.callsign = msg.callsign.trim();
        if (msg.imo) vesselUpdate.imo = msg.imo;
        if (msg.ship_type != null) vesselUpdate.ship_type = msg.ship_type;
        if (msg.destination) vesselUpdate.destination = msg.destination.trim();
        if (msg.to_bow != null) vesselUpdate.to_bow = msg.to_bow;
        if (msg.to_stern != null) vesselUpdate.to_stern = msg.to_stern;
        if (msg.to_port != null) vesselUpdate.to_port = msg.to_port;
        if (msg.to_starboard != null) vesselUpdate.to_starboard = msg.to_starboard;
        if (msg.draught != null) vesselUpdate.draught = msg.draught;
        // ETA from AIS (month, day, hour, minute in UTC)
        if (msg.month != null && msg.day != null) {
            vesselUpdate.eta_month = msg.month;
            vesselUpdate.eta_day = msg.day;
            vesselUpdate.eta_hour = msg.hour || 0;
            vesselUpdate.eta_minute = msg.minute || 0;
        }
    }

    // Class B (18, 19)
    if ([18, 19].includes(msgType)) {
        if (msg.lat != null && msg.lon != null && msg.lat !== 91 && msg.lon !== 181) {
            vesselUpdate.lat = msg.lat;
            vesselUpdate.lon = msg.lon;
            hasPosition = true;
        }
        if (msg.speed != null) vesselUpdate.speed = msg.speed;
        if (msg.course != null) vesselUpdate.course = msg.course;
        if (msg.heading != null) vesselUpdate.heading = msg.heading;
        vesselUpdate.lastUpdate = msg.timestamp || new Date().toISOString();
        if (msgType === 19 && msg.shipname) vesselUpdate.shipname = msg.shipname.trim();
    }

    // Class B static (24)
    if (msgType === 24) {
        if (msg.shipname) vesselUpdate.shipname = msg.shipname.trim();
        if (msg.callsign) vesselUpdate.callsign = msg.callsign.trim();
        if (msg.ship_type != null) vesselUpdate.ship_type = msg.ship_type;
    }

    // Aid-to-Navigation (21)
    if (msgType === 21) {
        vesselUpdate.isAtoN = true;
        if (msg.name) vesselUpdate.shipname = msg.name.trim();
        if (msg.name_ext) {
            const existing = vessels.value.get(mmsi);
            vesselUpdate.shipname = (existing?.shipname || '') + msg.name_ext.trim();
        }
        if (msg.aid_type != null) vesselUpdate.aid_type = msg.aid_type;
        if (msg.lat != null && msg.lon != null && msg.lat !== 91 && msg.lon !== 181) {
            vesselUpdate.lat = msg.lat;
            vesselUpdate.lon = msg.lon;
        }
        if (msg.virtual_aid != null) vesselUpdate.virtual_aid = msg.virtual_aid;
        if (msg.off_position != null) vesselUpdate.off_position = msg.off_position;
        if (msg.to_bow != null) vesselUpdate.to_bow = msg.to_bow;
        if (msg.to_stern != null) vesselUpdate.to_stern = msg.to_stern;
        if (msg.to_port != null) vesselUpdate.to_port = msg.to_port;
        if (msg.to_starboard != null) vesselUpdate.to_starboard = msg.to_starboard;
        vesselUpdate.lastUpdate = msg.timestamp || new Date().toISOString();
    }

    // Update vessel using signal action
    updateVessel(mmsi, vesselUpdate);

    // Add track point if we have a position
    if (hasPosition) {
        const time = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
        const vessel = vessels.value.get(mmsi);
        const draught = vessel?.draught ?? null;

        addTrackPoint(mmsi, {
            lat: msg.lat,
            lon: msg.lon,
            time,
            timestamp: msg.timestamp || new Date().toISOString(),
            speed: msg.speed,
            course: msg.course,
            mmsi,
            msgType: msgType || 1,
            draught,
        });
    }

    // Skip UI updates in batch mode
    if (batchMode) return;

    // Update UI through unified system
    document.getElementById('message-count').textContent = `${messageCount.value} messages`;
    updateMessageTable();

    // Use unified update functions for consistent data flow
    onVesselDataChanged(mmsi);
    onTrackDataChanged(mmsi);

    // Update vessel messages view if active
    updateVesselMessagesIfActive(msg);

    // Zoom to fit all vessels on first data
    if (!mapInitialized.value && vessels.value.size > 0) {
        setMapInitialized(true);
        setTimeout(zoomToFitAllVessels, 500);
    }
}

// Local helper removed - now using addTrackPoint action from state.js that takes (mmsi, point)
// The action expects: addTrackPoint(mmsi, { lat, lon, time, timestamp, speed, course, mmsi, msgType, draught })

// Note: addTrackPoint is now imported from state.js and handles track point limits internally

// ============================================================================
// URL Hash Navigation (for debugging)
// ============================================================================

function parseUrlHash() {
    const hash = window.location.hash;
    if (!hash) return null;

    // Support #mmsi=123456789 format
    const match = hash.match(/mmsi=(\d+)/);
    if (match) {
        return parseInt(match[1], 10);
    }
    return null;
}

function updateUrlHash(mmsi) {
    if (mmsi) {
        window.location.hash = `mmsi=${mmsi}`;
    } else {
        history.replaceState(null, '', window.location.pathname);
    }
}

function selectVesselFromHash() {
    const mmsi = parseUrlHash();
    if (mmsi && vessels.value.has(mmsi)) {
        console.log(`Selecting vessel from URL hash: ${mmsi}`);
        selectVessel(mmsi);
        zoomToVessel(mmsi);
    } else if (mmsi) {
        console.log(`Vessel ${mmsi} from URL hash not found yet, will retry...`);
        // Retry after a short delay (data might still be loading)
        setTimeout(() => {
            if (vessels.value.has(mmsi)) {
                console.log(`Selecting vessel from URL hash (retry): ${mmsi}`);
                selectVessel(mmsi);
                zoomToVessel(mmsi);
            }
        }, 1000);
    }
}

function zoomToVessel(mmsi) {
    const vessel = vessels.value.get(mmsi);
    if (vessel && vessel.lat != null && vessel.lon != null &&
        vessel.lat >= -90 && vessel.lat <= 90 &&
        vessel.lon >= -180 && vessel.lon <= 180) {
        map.flyTo({ center: [vessel.lon, vessel.lat], zoom: 14 });
    }
}

// Listen for hash changes
window.addEventListener('hashchange', () => {
    const mmsi = parseUrlHash();
    if (mmsi && vessels.value.has(mmsi)) {
        selectVessel(mmsi);
    }
});

// ============================================================================
// Reactive Effects (automatic UI updates when signals change)
// ============================================================================

function initEffects() {
    // Effect: Update settings UI when settings signal changes
    registerEffect(() => {
        const s = settings.value;
        applySettings();
    });

    // Note: For now, we trigger updates manually when needed.
    // True reactive effects would use registerEffect to automatically
    // call updateVesselTable/updateLayers when signals change.
    // This can be enhanced incrementally.
}

// ============================================================================
// Mobile Sidebar
// ============================================================================

// Global close function for mobile sidebar (called from selectVessel)
let closeMobileSidebar = () => {};

function initMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebarClose = document.getElementById('sidebar-close');

    function openSidebar() {
        sidebar.classList.add('open');
        backdrop.classList.add('visible');
        document.body.style.overflow = 'hidden'; // Prevent scroll behind
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        backdrop.classList.remove('visible');
        document.body.style.overflow = '';
    }

    // Expose close function globally
    closeMobileSidebar = closeSidebar;

    // Toggle button in header
    menuToggle.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    // Close button in sidebar
    sidebarClose.addEventListener('click', closeSidebar);

    // Click backdrop to close
    backdrop.addEventListener('click', closeSidebar);

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });

    // Handle resize - close sidebar if resizing to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && sidebar.classList.contains('open')) {
            closeSidebar();
        }
        // Update mobile timeline visibility on resize/orientation change
        updateMobileTimelineVisibility();
    });
}

// ============================================================================
// Mobile Charts (iOS-style bottom sheet)
// ============================================================================

let currentChartIndex = 0;
const chartNames = ['speed', 'course', 'draught'];

function initMobileCharts() {
    const chartsContainer = document.getElementById('charts-container');
    const indicators = document.getElementById('charts-indicators');
    const pills = indicators.querySelectorAll('.chart-pill');
    const timeScrubber = document.getElementById('time-scrubber-input');
    const timeScrubberLabel = document.getElementById('time-scrubber-label');

    // Pill click to switch charts
    pills.forEach((pill, index) => {
        pill.addEventListener('click', () => {
            scrollToChart(index);
        });
    });

    // Update pills on scroll
    chartsContainer.addEventListener('scroll', () => {
        const scrollLeft = chartsContainer.scrollLeft;
        const width = chartsContainer.offsetWidth;
        const newIndex = Math.round(scrollLeft / width);
        if (newIndex !== currentChartIndex && newIndex >= 0 && newIndex < chartNames.length) {
            currentChartIndex = newIndex;
            updateChartPills();
        }
    }, { passive: true });

    // Time scrubber
    timeScrubber.addEventListener('input', () => {
        const mmsi = selectedMmsi.value;
        if (!mmsi || !tracks.value.has(mmsi)) return;

        const track = tracks.value.get(mmsi);
        if (!track || track.length === 0) return;

        const percent = parseInt(timeScrubber.value);
        const index = Math.floor((percent / 100) * (track.length - 1));
        const point = track[Math.min(index, track.length - 1)];

        if (point) {
            // Update label
            const date = new Date(point.time);
            timeScrubberLabel.textContent = percent === 100 ? 'Now' : formatTime(date);

            // Highlight point on map
            highlightTrackPoint(mmsi, point);
        }
    });

    // Handle touch on charts for uPlot (passive listeners for scroll perf)
    chartsContainer.addEventListener('touchstart', handleChartTouch, { passive: false });
    chartsContainer.addEventListener('touchmove', handleChartTouchMove, { passive: false });
    chartsContainer.addEventListener('touchend', handleChartTouchEnd, { passive: true });
}

function scrollToChart(index) {
    const chartsContainer = document.getElementById('charts-container');
    const width = chartsContainer.offsetWidth;
    chartsContainer.scrollTo({
        left: width * index,
        behavior: 'smooth'
    });
    currentChartIndex = index;
    updateChartPills();
}

function updateChartPills() {
    const pills = document.querySelectorAll('.chart-pill');
    pills.forEach((pill, index) => {
        if (index === currentChartIndex) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });
}

// Touch handling for uPlot charts on mobile
let chartTouchStart = null;
let chartTouchChart = null;

function handleChartTouch(e) {
    // Only handle single touch
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const target = e.target;

    // Check if touching inside a uPlot chart
    const uplotOver = target.closest('.u-over');
    if (!uplotOver) return;

    chartTouchStart = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now()
    };

    // Find which chart
    const wrapper = target.closest('[data-chart]');
    if (wrapper) {
        const chartName = wrapper.dataset.chart;
        if (chartName === 'speed') chartTouchChart = speedChart;
        else if (chartName === 'course') chartTouchChart = courseChart;
        else if (chartName === 'draught') chartTouchChart = draughtChart;
    }

    // Prevent scroll while interacting with chart
    if (chartTouchChart) {
        e.preventDefault();
    }
}

function handleChartTouchMove(e) {
    if (!chartTouchStart || !chartTouchChart || e.touches.length !== 1) return;

    const touch = e.touches[0];

    // Calculate position relative to chart
    const rect = chartTouchChart.over.getBoundingClientRect();
    const x = touch.clientX - rect.left;

    // Update cursor position in uPlot
    if (x >= 0 && x <= rect.width) {
        chartTouchChart.setCursor({ left: x, top: 0 });
        e.preventDefault();
    }
}

function handleChartTouchEnd(e) {
    if (!chartTouchStart || !chartTouchChart) {
        chartTouchStart = null;
        chartTouchChart = null;
        return;
    }

    const duration = Date.now() - chartTouchStart.time;

    // If it was a quick tap (< 300ms), treat as click
    if (duration < 300) {
        handleChartClick(chartTouchChart);
    }

    chartTouchStart = null;
    chartTouchChart = null;
}

// Update time scrubber when track changes
function updateTimeScrubber() {
    const timeScrubber = document.getElementById('time-scrubber-input');
    const timeScrubberLabel = document.getElementById('time-scrubber-label');

    if (!timeScrubber) return;

    const mmsi = selectedMmsi.value;
    if (!mmsi || !tracks.value.has(mmsi)) {
        timeScrubber.value = 100;
        timeScrubberLabel.textContent = 'Now';
        return;
    }

    // Reset to "Now" when track changes
    timeScrubber.value = 100;
    timeScrubberLabel.textContent = 'Now';
}

function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${mins}`;
}

// Highlight a track point on the map
function highlightTrackPoint(mmsi, point) {
    if (!point) return;

    // Update highlighted point using the existing signal
    setHighlightPoint({
        mmsi: mmsi,
        lat: point.lat,
        lon: point.lon,
        time: point.time,
        speed: point.speed,
        course: point.course
    });

    // Update layers to show highlight
    updateLayers();

    // Update highlight info display
    updateHighlightInfo(point);
}

// ============================================================================
// Mobile Global Timeline
// ============================================================================

function initMobileGlobalTimeline() {
    const mobileTimeline = document.getElementById('mobile-timeline');
    const mobileSlider = document.getElementById('mobile-timeline-slider');
    const mobileValue = document.getElementById('mobile-timeline-value');
    const desktopSlider = document.getElementById('timeline-slider');

    if (!mobileSlider) return;

    // Sync mobile slider with desktop slider on input
    mobileSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        setTimelinePosition(value);

        // Sync desktop slider
        if (desktopSlider) {
            desktopSlider.value = value;
        }

        // Update display
        updateMobileTimelineLabel();

        // Filter vessels
        updateVesselTable();
        updateLayers();
    });

    // Double-tap to reset to now
    let lastTap = 0;
    mobileSlider.addEventListener('touchend', () => {
        const now = Date.now();
        if (now - lastTap < 300) {
            mobileSlider.value = 100;
            setTimelinePosition(100);
            if (desktopSlider) desktopSlider.value = 100;
            updateMobileTimelineLabel();
            updateVesselTable();
            updateLayers();
        }
        lastTap = now;
    });

    // Initial label
    updateMobileTimelineLabel();
}

function updateMobileTimelineLabel() {
    const label = document.getElementById('mobile-timeline-value');
    if (!label) return;

    const pos = timelinePosition.value;
    const tv = timelineValue.value;

    if (pos >= 100 || !tv) {
        label.textContent = 'Now';
        return;
    }

    const date = new Date(tv);
    const now = new Date();

    // If same day, show time only
    if (date.toDateString() === now.toDateString()) {
        label.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        label.textContent = date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
            ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

function updateMobileTimelineVisibility() {
    const mobileTimeline = document.getElementById('mobile-timeline');
    if (!mobileTimeline) return;

    // Only show on mobile (CSS handles hiding on desktop)
    const isMobile = window.innerWidth <= 768;
    const hasSelectedVessel = selectedMmsi.value !== null;

    if (isMobile && !hasSelectedVessel) {
        mobileTimeline.classList.remove('hidden');
    } else {
        mobileTimeline.classList.add('hidden');
    }
}

// ============================================================================
// Hierarchical Navigation
// ============================================================================

// Navigation state: tracks the view stack for back navigation
const navStack = [];
let currentView = 'vessels';

function navigateTo(viewId, title, data = null) {
    // Save current view to stack
    if (currentView !== viewId) {
        navStack.push({ view: currentView, title: document.getElementById('nav-title').textContent });
    }

    // Update view
    showView(viewId, title);
    currentView = viewId;

    // Show/hide back button
    const backBtn = document.getElementById('nav-back');
    if (navStack.length > 0) {
        backBtn.classList.remove('hidden');
    } else {
        backBtn.classList.add('hidden');
    }

    // Update bottom tabs
    updateSidebarTabs(viewId);
}

function navigateBack() {
    if (navStack.length === 0) return;

    const prev = navStack.pop();
    showView(prev.view, prev.title);
    currentView = prev.view;

    // Handle deselection when going back to vessels list
    if (prev.view === 'vessels') {
        deselectVessel();
        clearVoyageMarkers();
        updateUrlHash(null);
        document.getElementById('charts-panel').classList.add('hidden');
        updateMobileTimelineVisibility();
    }

    // Hide back button if at root
    const backBtn = document.getElementById('nav-back');
    if (navStack.length === 0) {
        backBtn.classList.add('hidden');
    }

    // Update bottom tabs
    updateSidebarTabs(prev.view);
    updateLayers();
}

function navigateToRoot(viewId) {
    // Clear navigation stack and go to root view
    navStack.length = 0;
    currentView = viewId;

    const titles = {
        'vessels': 'Vessels',
        'all-messages': 'All Messages',
    };

    showView(viewId, titles[viewId] || 'Vessels');
    document.getElementById('nav-back').classList.add('hidden');

    // Deselect vessel when going to root
    if (selectedMmsi.value) {
        deselectVessel();
        clearVoyageMarkers();
        updateUrlHash(null);
        document.getElementById('charts-panel').classList.add('hidden');
        updateMobileTimelineVisibility();
        updateLayers();
    }

    // Update bottom tabs
    updateSidebarTabs(viewId);
}

function showView(viewId, title) {
    // Hide all views
    document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));

    // Show target view
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) {
        targetView.classList.add('active');
    }

    // Update title
    document.getElementById('nav-title').textContent = title;
}

function updateSidebarTabs(viewId) {
    // Map drill-down views to their root tab
    const rootViews = {
        'vessels': 'vessels',
        'vessel-detail': 'vessels',
        'vessel-messages': 'vessels',
        'all-messages': 'all-messages',
    };
    const rootView = rootViews[viewId] || 'vessels';

    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        if (tab.dataset.view === rootView) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
}

function initNavigation() {
    // Back button
    document.getElementById('nav-back').addEventListener('click', navigateBack);

    // Bottom tabs
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const viewId = tab.dataset.view;
            navigateToRoot(viewId);
        });
    });

    // Vessel detail action buttons
    document.getElementById('zoom-to-vessel').addEventListener('click', () => {
        const mmsi = selectedMmsi.value;
        if (mmsi) {
            zoomToVessel(mmsi);
        }
    });

    document.getElementById('show-vessel-messages').addEventListener('click', () => {
        const mmsi = selectedMmsi.value;
        if (mmsi) {
            showVesselMessages(mmsi);
        }
    });

    document.getElementById('show-vessel-track').addEventListener('click', () => {
        // Already showing track on map - just zoom to fit
        const mmsi = selectedMmsi.value;
        if (mmsi) {
            zoomToVesselTrack(mmsi);
        }
    });
}

// ============================================================================
// Vessel Messages View
// ============================================================================

let vesselMessagesTable = null;

// Pagination and filter state
const vesselMessagesState = {
    mmsi: null,
    offset: 0,
    limit: 100,
    total: 0,
    sortOrder: 'desc',  // 'desc' = newest first, 'asc' = oldest first
    hours: 24,          // null = all time
    searchText: '',
    allData: [],        // Store full page for client-side filtering
};

function initVesselMessagesTable() {
    vesselMessagesTable = new Tabulator('#vessel-messages-table', {
        data: [],
        layout: 'fitColumns',
        height: '100%',
        selectable: 1,
        columns: [
            {
                title: 'Time ↓',
                field: 'timestamp',
                width: 90,
                headerClick: () => toggleMessageSort(),
                formatter: cell => {
                    const ts = cell.getValue();
                    if (!ts) return '-';
                    const d = new Date(ts);
                    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                },
            },
            { title: 'Type', field: 'msg_type', width: 110, formatter: cell => {
                const msgType = cell.getValue();
                const name = getMessageTypeName(msgType);
                return `<span title="Type ${msgType}">${name}</span>`;
            }},
            { title: 'Speed', field: 'speed', width: 55, formatter: cell => {
                const val = cell.getValue();
                return val != null ? val.toFixed(1) : '-';
            }},
            { title: 'Course', field: 'course', width: 55, formatter: cell => {
                const val = cell.getValue();
                return val != null ? `${Math.round(val)}°` : '-';
            }},
        ],
    });

    vesselMessagesTable.on('rowClick', (e, row) => {
        const msg = row.getData();
        showMessageDetail(msg);
    });

    // Initialize event listeners for controls
    initVesselMessagesControls();
}

function initVesselMessagesControls() {
    // Hours filter dropdown
    document.getElementById('vessel-messages-hours').addEventListener('change', (e) => {
        const val = e.target.value;
        vesselMessagesState.hours = val === '' ? null : parseInt(val, 10);
        vesselMessagesState.offset = 0;  // Reset to first page
        loadVesselMessages();
    });

    // Search input with debounce
    let searchTimeout = null;
    document.getElementById('vessel-messages-search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            vesselMessagesState.searchText = e.target.value.toLowerCase();
            applyMessagesSearch();
        }, 200);
    });

    // Pagination buttons
    document.getElementById('vessel-messages-prev').addEventListener('click', () => {
        if (vesselMessagesState.offset > 0) {
            vesselMessagesState.offset = Math.max(0, vesselMessagesState.offset - vesselMessagesState.limit);
            loadVesselMessages();
        }
    });

    document.getElementById('vessel-messages-next').addEventListener('click', () => {
        if (vesselMessagesState.offset + vesselMessagesState.limit < vesselMessagesState.total) {
            vesselMessagesState.offset += vesselMessagesState.limit;
            loadVesselMessages();
        }
    });
}

function toggleMessageSort() {
    vesselMessagesState.sortOrder = vesselMessagesState.sortOrder === 'desc' ? 'asc' : 'desc';
    vesselMessagesState.offset = 0;  // Reset to first page when sorting changes

    // Update column header to show sort direction
    updateSortIndicator();

    loadVesselMessages();
}

function updateSortIndicator() {
    const arrow = vesselMessagesState.sortOrder === 'desc' ? '↓' : '↑';
    const sortHint = vesselMessagesState.sortOrder === 'desc' ? 'Newest first' : 'Oldest first';

    // Update the column header (Tabulator doesn't make this easy, so we update hint text)
    document.getElementById('vessel-messages-sort-hint').textContent = sortHint;
}

async function showVesselMessages(mmsi) {
    const vessel = vessels.value.get(mmsi);
    const vesselName = vessel?.shipname || `MMSI ${mmsi}`;

    // Navigate to vessel messages view
    navigateTo('vessel-messages', `${vesselName} Messages`);

    // Reset state for new vessel
    vesselMessagesState.mmsi = mmsi;
    vesselMessagesState.offset = 0;
    vesselMessagesState.searchText = '';

    // Reset UI controls
    document.getElementById('vessel-messages-search-input').value = '';
    document.getElementById('vessel-messages-hours').value = vesselMessagesState.hours || '';
    updateSortIndicator();

    // Hide message details initially
    document.getElementById('message-details').classList.add('hidden');

    // Load messages
    await loadVesselMessages();
}

async function loadVesselMessages() {
    const { mmsi, offset, limit, hours, sortOrder } = vesselMessagesState;
    if (!mmsi) return;

    // Show loading state
    document.getElementById('vessel-messages-count').textContent = 'Loading...';

    try {
        // Build API URL with parameters
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
            sort_order: sortOrder,
        });
        if (hours !== null) {
            params.set('hours', hours.toString());
        }

        const response = await fetch(`/api/vessel/${mmsi}/messages?${params}`);
        const data = await response.json();

        // Store data for client-side filtering
        vesselMessagesState.allData = data.messages;
        vesselMessagesState.total = data.total;

        // Apply search filter and update display
        applyMessagesSearch();

        // Update pagination
        updateMessagesPagination();

    } catch (err) {
        console.error('Failed to fetch vessel messages:', err);
        document.getElementById('vessel-messages-count').textContent = 'Error loading messages';
    }
}

function applyMessagesSearch() {
    const { allData, searchText, total, hours } = vesselMessagesState;

    // Filter data by search text (client-side filter on loaded page)
    let filtered = allData;
    if (searchText) {
        filtered = allData.filter(m => {
            const type = getMessageTypeName(m.msg_type).toLowerCase();
            const ts = m.timestamp || '';
            return type.includes(searchText) || ts.includes(searchText);
        });
    }

    // Update count display
    const hoursText = hours === null ? 'all time' : `${hours}h`;
    if (searchText) {
        document.getElementById('vessel-messages-count').textContent =
            `${filtered.length} of ${allData.length} shown (${total} total, ${hoursText})`;
    } else {
        document.getElementById('vessel-messages-count').textContent =
            `${allData.length} of ${total} messages (${hoursText})`;
    }

    // Update table
    if (vesselMessagesTable) {
        vesselMessagesTable.replaceData(filtered);
    }
}

function updateMessagesPagination() {
    const { offset, limit, total } = vesselMessagesState;

    const currentPage = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);

    document.getElementById('vessel-messages-page-info').textContent =
        totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'No messages';

    document.getElementById('vessel-messages-prev').disabled = offset === 0;
    document.getElementById('vessel-messages-next').disabled = offset + limit >= total;
}

// Update vessel messages when new message arrives for selected vessel
function updateVesselMessagesIfActive(msg) {
    if (vesselMessagesState.mmsi && msg.mmsi === vesselMessagesState.mmsi && currentView === 'vessel-messages') {
        // Only add to top if we're on first page and sorted by newest first
        if (vesselMessagesState.offset === 0 && vesselMessagesState.sortOrder === 'desc') {
            vesselMessagesState.allData.unshift(msg);
            vesselMessagesState.total++;
            applyMessagesSearch();
            updateMessagesPagination();
        }
    }
}

// For backwards compatibility
let currentVesselMessagesMMSI = null;
// Keep in sync
Object.defineProperty(window, 'currentVesselMessagesMMSI', {
    get: () => vesselMessagesState.mmsi,
    set: (v) => { vesselMessagesState.mmsi = v; }
});

function showMessageDetail(msg) {
    selectMessage(msg);
    // Show message details panel within vessel messages view
    const detailsPanel = document.getElementById('message-details');
    detailsPanel.classList.remove('hidden');
    updateMessageDetails();
}

function zoomToVesselTrack(mmsi) {
    const track = tracks.value.get(mmsi);
    if (!track || track.length === 0) return;

    if (track.length === 1) {
        map.flyTo({ center: [track[0].lon, track[0].lat], zoom: 12 });
        return;
    }

    // Fit bounds to track
    const bounds = new maplibregl.LngLatBounds();
    track.forEach(p => {
        if (p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180) {
            bounds.extend([p.lon, p.lat]);
        }
    });

    if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
    }
}

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Initializing AIS Tracker...');
        initSettings();
        console.log('Settings initialized');
        initMap();
        console.log('Map initialized');
        initVesselTable();
        console.log('Vessel table initialized');
        initMessageTable();
        console.log('Message table initialized');
        initVesselMessagesTable();
        console.log('Vessel messages table initialized');
        initNavigation();
        console.log('Navigation initialized');
        initTypeFilters();
        initSearch();
        initTimelineSlider();
        initStyleSelector();
        initGeolocation();
        initResizeHandlers();
        initMobileSidebar();
        initMobileCharts();
        initMobileGlobalTimeline();
        updateMobileTimelineVisibility();
        initEffects();
        console.log('All UI initialized, connecting WebSocket...');
        connectWebSocket();

        // Check for vessel selection in URL hash after a delay
        setTimeout(selectVesselFromHash, 500);
    } catch (e) {
        console.error('Initialization error:', e);
    }
});
