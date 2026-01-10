/**
 * AIS Vessel Tracker - Frontend Application
 * Major refactor for hierarchical UI, global history, and highlight sync
 */

// ============================================================================
// State Management
// ============================================================================

const state = {
    vessels: new Map(),      // mmsi -> vessel data
    tracks: new Map(),       // mmsi -> position history array
    messages: [],            // raw message history
    selectedMmsi: null,      // currently selected vessel
    selectedMessage: null,   // currently selected message for detail view
    highlightPoint: null,    // currently hovered point {time, lat, lon, speed, course}
    clickedPoint: null,      // persistently clicked point (survives hover changes)
    historyRange: -1,        // -1 = all, 0 = current only, >0 = seconds
    historyStart: null,      // null or timestamp (ms) for custom range from chart selection
    historyEnd: null,        // null or timestamp (ms) for custom range from chart selection
    mapStyle: 'dark',
    messageCount: 0,
    connected: false,
    mapInitialized: false,
    typeFilter: 'all',
};

// Ship type codes to category names
const SHIP_TYPES = {
    0: 'Unknown',
    20: 'Wing in Ground', 21: 'WIG Hazardous A', 22: 'WIG Hazardous B',
    30: 'Fishing', 31: 'Towing', 32: 'Towing Large', 33: 'Dredging',
    34: 'Diving', 35: 'Military', 36: 'Sailing', 37: 'Pleasure',
    40: 'High Speed', 50: 'Pilot', 51: 'SAR', 52: 'Tug', 53: 'Port Tender',
    54: 'Anti-pollution', 55: 'Law Enforcement', 58: 'Medical', 59: 'Noncombatant',
    60: 'Passenger', 61: 'Passenger', 62: 'Passenger', 63: 'Passenger',
    64: 'Passenger', 69: 'Passenger',
    70: 'Cargo', 71: 'Cargo', 72: 'Cargo', 73: 'Cargo', 74: 'Cargo', 79: 'Cargo',
    80: 'Tanker', 81: 'Tanker', 82: 'Tanker', 83: 'Tanker', 84: 'Tanker', 89: 'Tanker',
    90: 'Other', 91: 'Other', 92: 'Other', 93: 'Other', 94: 'Other', 99: 'Other',
};

const NAV_STATUS = {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
    3: 'Restricted maneuverability', 4: 'Constrained by draught', 5: 'Moored',
    6: 'Aground', 7: 'Fishing', 8: 'Under way sailing', 11: 'Towing astern',
    12: 'Pushing ahead', 14: 'AIS-SART', 15: 'Undefined',
};

// Aid-to-Navigation types (Message Type 21)
const ATON_TYPES = {
    0: 'Unspecified',
    1: 'Reference Point',
    2: 'RACON',
    3: 'Fixed Structure',
    4: 'Emergency Wreck Marking Buoy',
    5: 'Light (no sectors)',
    6: 'Light (with sectors)',
    7: 'Leading Light Front',
    8: 'Leading Light Rear',
    9: 'Beacon, Cardinal N',
    10: 'Beacon, Cardinal E',
    11: 'Beacon, Cardinal S',
    12: 'Beacon, Cardinal W',
    13: 'Beacon, Port Hand',
    14: 'Beacon, Starboard Hand',
    15: 'Beacon, Preferred Channel Port',
    16: 'Beacon, Preferred Channel Starboard',
    17: 'Beacon, Isolated Danger',
    18: 'Beacon, Safe Water',
    19: 'Beacon, Special Mark',
    20: 'Cardinal Mark N',
    21: 'Cardinal Mark E',
    22: 'Cardinal Mark S',
    23: 'Cardinal Mark W',
    24: 'Port Hand Mark',
    25: 'Starboard Hand Mark',
    26: 'Preferred Channel Port',
    27: 'Preferred Channel Starboard',
    28: 'Isolated Danger',
    29: 'Safe Water',
    30: 'Special Mark',
    31: 'Light Vessel / LANBY',
};

const MAX_TRACK_POINTS = Infinity;  // No limit - load all available history
const MAX_MESSAGES = 1000;

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

    // Update history info if this is the selected vessel
    if (state.selectedMmsi === mmsi) {
        updateHistoryInfo();
        // Schedule throttled chart update
        scheduleChartUpdate();
    }
}

// Called when vessel data changes (position, static data, etc.)
function onVesselDataChanged(mmsi) {
    updateVesselTable();

    if (state.selectedMmsi === mmsi) {
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
        style: MAP_STYLES[state.mapStyle],
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

    // Update charts when map viewport changes (zoom/pan)
    map.on('moveend', () => {
        if (state.selectedMmsi && state.historyRange === -1) {
            updateCharts();
            updateHistoryInfo();
        }
    });
}

function initDeckOverlay() {
    deckOverlay = new deck.MapboxOverlay({
        layers: [],
        getTooltip: getVesselTooltip,
    });
    map.addControl(deckOverlay);
    updateLayers();
}

function updateLayers() {
    if (!deckOverlay) return;

    const layers = [];
    const now = Date.now();

    // Track layer - only show for selected vessel with history
    if (state.selectedMmsi && state.tracks.has(state.selectedMmsi)) {
        const trackData = getFilteredTrack(state.selectedMmsi);
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
            layers.push(new deck.ScatterplotLayer({
                id: 'track-points-layer',
                data: trackData,
                getPosition: d => [d.lon, d.lat],
                getRadius: 4,
                getFillColor: d => getTrackPointColor(d.msgType),
                radiusMinPixels: 3,
                radiusMaxPixels: 8,
                pickable: true,
                onClick: ({ object }) => {
                    if (object) onPointClick(object);
                },
                onHover: ({ object }) => {
                    onPointHover(object, 'track');
                },
            }));

            // Clicked point layer - persistent selection (renders first, below hover)
            if (state.clickedPoint) {
                layers.push(new deck.ScatterplotLayer({
                    id: 'clicked-point-layer',
                    data: [state.clickedPoint],
                    getPosition: d => [d.lon, d.lat],
                    getRadius: 16,
                    getFillColor: [255, 100, 100, 200],  // Red for clicked
                    radiusMinPixels: 10,
                    radiusMaxPixels: 24,
                    pickable: false,
                }));
            }

            // Hover highlight layer - temporary highlight (renders on top)
            if (state.highlightPoint) {
                layers.push(new deck.ScatterplotLayer({
                    id: 'highlight-point-layer',
                    data: [state.highlightPoint],
                    getPosition: d => [d.lon, d.lat],
                    getRadius: 12,
                    getFillColor: [255, 170, 0, 255],  // Orange for hover
                    radiusMinPixels: 8,
                    radiusMaxPixels: 20,
                    pickable: false,
                }));
            }
        }
    }

    // Vessel icons
    const vesselData = Array.from(state.vessels.values())
        .filter(v => v.lat != null && v.lon != null);

    layers.push(new deck.IconLayer({
        id: 'vessel-icons-layer',
        data: vesselData,
        getPosition: d => [d.lon, d.lat],
        getIcon: d => getVesselIcon(d),
        getSize: d => d.mmsi === state.selectedMmsi ? 36 : 24,
        getAngle: d => d.isAtoN ? 0 : -(d.heading != null && d.heading !== 511 ? d.heading : d.course || 0),
        sizeMinPixels: 14,
        sizeMaxPixels: 50,
        pickable: true,
        onClick: ({ object }) => {
            if (object) selectVessel(object.mmsi);
        },
    }));

    deckOverlay.setProps({ layers });

    // Update highlight marker on map
    updateHighlightMarker();
}

function isHighlighted(point) {
    if (!state.highlightPoint) return false;
    return point.time === state.highlightPoint.time;
}

function getFilteredTrack(mmsi, forCharts = false) {
    const track = state.tracks.get(mmsi) || [];

    // Custom range from chart selection takes priority
    if (state.historyStart != null && state.historyEnd != null) {
        return track.filter(p => p.time >= state.historyStart && p.time <= state.historyEnd);
    }

    // For selected vessel, use history range; for unselected, show nothing
    if (state.historyRange === 0) {
        // Current only - return last point
        return track.length > 0 ? [track[track.length - 1]] : [];
    }

    if (state.historyRange === -1) {
        // All data - but for charts, filter to visible viewport
        if (forCharts && map) {
            return getViewportFilteredTrack(track);
        }
        // Return a copy so deck.gl detects the change (shallow comparison)
        return track.slice();
    }

    // Time-based filter
    const cutoff = Date.now() - state.historyRange * 1000;
    return track.filter(p => p.time >= cutoff);
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

function getVesselColor(vessel) {
    if (vessel.mmsi === state.selectedMmsi) return '#ffc800';
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
    const isSelected = vessel.mmsi === state.selectedMmsi;
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
    const vessels = Array.from(state.vessels.values()).filter(v => v.lat && v.lon);
    if (vessels.length === 0) return;

    if (vessels.length === 1) {
        map.flyTo({ center: [vessels[0].lon, vessels[0].lat], zoom: 12 });
        return;
    }

    const bounds = new maplibregl.LngLatBounds();
    vessels.forEach(v => bounds.extend([v.lon, v.lat]));
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
    const data = Array.from(state.vessels.values());
    vesselTable.replaceData(data);
    document.getElementById('vessel-count').textContent = `${data.length} ${data.length === 1 ? 'vessel' : 'vessels'}`;
    updateTypeCounts();
    applyFilters();
}

// ============================================================================
// Type Filters
// ============================================================================

function initTypeFilters() {
    document.querySelectorAll('.type-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.typeFilter = chip.dataset.type;
            applyFilters();
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

function applyFilters() {
    if (!vesselTable) return;
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    vesselTable.setFilter((data) => {
        if (state.typeFilter !== 'all') {
            if (getVesselCategory(data) !== state.typeFilter) return false;
        }
        if (searchTerm) {
            const matches = (data.shipname?.toLowerCase().includes(searchTerm)) ||
                           String(data.mmsi).includes(searchTerm) ||
                           (data.callsign?.toLowerCase().includes(searchTerm)) ||
                           (data.destination?.toLowerCase().includes(searchTerm));
            if (!matches) return false;
        }
        return true;
    });
}

function updateTypeCounts() {
    const counts = { all: 0, passenger: 0, cargo: 0, tanker: 0, fishing: 0, tug: 0, aton: 0, other: 0 };
    state.vessels.forEach(v => {
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
    state.selectedMmsi = mmsi;
    state.selectedMessage = null;
    state.highlightPoint = null;
    state.clickedPoint = null;

    // Update URL hash for debugging
    updateUrlHash(mmsi);

    // Show details panel
    const sidebarBottom = document.getElementById('sidebar-bottom');
    sidebarBottom.classList.remove('hidden');
    document.getElementById('detail-title').textContent = 'Vessel Details';
    document.getElementById('vessel-details').classList.remove('hidden');
    document.getElementById('message-details').classList.add('hidden');

    updateVesselDetails();
    updateLayers();
    forceChartUpdate();  // User action - immediate update

    // Fetch historical track data from backend
    fetchTrack(mmsi);

    // Highlight row in table
    if (vesselTable) {
        vesselTable.deselectRow();
        const row = vesselTable.getRows().find(r => r.getData().mmsi === mmsi);
        if (row) { row.select(); row.scrollTo(); }
    }
}

// Fetch historical track from backend API
async function fetchTrack(mmsi) {
    try {
        const response = await fetch(`/api/vessel/${mmsi}/track`);
        if (!response.ok) {
            console.error(`Failed to fetch track for ${mmsi}: ${response.status}`);
            return;
        }

        const data = await response.json();
        if (!data.positions || data.positions.length === 0) {
            console.log(`No track data for vessel ${mmsi}`);
            return;
        }

        console.log(`Fetched ${data.positions.length} track points for vessel ${mmsi}`);

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
        }));

        // Get existing track (from real-time WebSocket messages)
        const existingTrack = state.tracks.get(mmsi) || [];

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

        // Update state
        state.tracks.set(mmsi, mergedTrack);

        console.log(`Track for ${mmsi}: ${historicalTrack.length} historical + ${newerPoints.length} real-time = ${mergedTrack.length} total`);

        // Update display if this vessel is still selected
        if (state.selectedMmsi === mmsi) {
            onTrackDataChanged(mmsi);
        }
    } catch (err) {
        console.error(`Error fetching track for ${mmsi}:`, err);
    }
}

function selectMessage(msg) {
    state.selectedMessage = msg;
    state.highlightPoint = msg.lat && msg.lon ? {
        time: new Date(msg.timestamp).getTime(),
        lat: msg.lat, lon: msg.lon,
        speed: msg.speed, course: msg.course
    } : null;

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
    state.selectedMmsi = null;
    state.selectedMessage = null;
    state.highlightPoint = null;
    state.clickedPoint = null;
    updateUrlHash(null);  // Clear URL hash
    document.getElementById('sidebar-bottom').classList.add('hidden');
    document.getElementById('charts-panel').classList.add('hidden');
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
    if (!state.selectedMmsi || !state.vessels.has(state.selectedMmsi)) {
        container.innerHTML = '<p class="no-selection">Select a vessel</p>';
        return;
    }

    const v = state.vessels.get(state.selectedMmsi);

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

    // Calculate distance to destination
    const distInfo = getDistanceToDestination(v);
    let distanceStr = 'N/A';
    let calcEtaStr = '';
    if (distInfo) {
        distanceStr = `${Math.round(distInfo.distance)} nm to ${distInfo.portName}`;
        if (distInfo.etaHours != null) {
            const days = Math.floor(distInfo.etaHours / 24);
            const hours = Math.round(distInfo.etaHours % 24);
            calcEtaStr = days > 0 ? ` (~${days}d ${hours}h at current speed)` : ` (~${hours}h at current speed)`;
        }
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
    msg_type: { label: 'Message Type', format: v => `Type ${v} (${getMessageTypeName(v)})` },
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
};

function getMessageTypeName(type) {
    const names = {
        1: 'Position Report A', 2: 'Position Report A', 3: 'Position Report A',
        4: 'Base Station', 5: 'Static & Voyage',
        18: 'Position Report B', 19: 'Extended Position B',
        21: 'Aid to Navigation', 24: 'Static Data B',
    };
    return names[type] || 'Other';
}

function updateMessageDetails() {
    const container = document.getElementById('message-details');
    if (!state.selectedMessage) {
        container.innerHTML = '';
        return;
    }

    const msg = state.selectedMessage;
    const fields = Object.entries(msg)
        .filter(([k]) => !['raw_nmea'].includes(k))
        .map(([k, v]) => {
            const config = MESSAGE_FIELD_CONFIG[k];
            const label = config?.label || k;
            const formatted = config?.format ? config.format(v) : formatValue(v);
            return `<div class="message-field"><span class="message-field-key">${label}</span><span class="message-field-value">${formatted}</span></div>`;
        })
        .join('');

    container.innerHTML = `<div class="message-fields">${fields}</div>`;
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
    const msg = state.messages.find(m => {
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
        state.highlightPoint = null;

        // If there's a clicked point, show its info; otherwise hide info
        if (state.clickedPoint) {
            updateLayers();  // Will show clickedPoint layer
            showHighlightInfo(state.clickedPoint);
        } else {
            updateLayers();
            showHighlightInfo(null);
        }
        return;
    }

    state.highlightPoint = point;
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

    state.clickedPoint = point;
    state.highlightPoint = point;
    updateLayers();
    showHighlightInfo(point);
    syncChartsToPoint(point);
    selectTrackPointMessage(point);
}

// Legacy function for compatibility
function setHighlightPoint(point) {
    onPointClick(point);
}

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

    if (!state.selectedMmsi || !state.tracks.has(state.selectedMmsi)) {
        chartsPanel.classList.add('hidden');
        return;
    }

    // Use viewport-filtered track for charts (forCharts=true)
    const track = getFilteredTrack(state.selectedMmsi, true);
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
    if (idx == null || !state.selectedMmsi) return;

    const track = getFilteredTrack(state.selectedMmsi, true);
    if (idx >= 0 && idx < track.length) {
        onPointClick(track[idx]);
    }
}

function handleChartSelect(u) {
    const selection = u.select;

    // Detect click vs drag selection
    if (selection.width < 10) {
        // This is a click - select the point at cursor position
        const idx = u.cursor.idx;
        if (idx != null && state.selectedMmsi) {
            const track = getFilteredTrack(state.selectedMmsi, true);
            if (idx >= 0 && idx < track.length) {
                onPointClick(track[idx]);
            }
        }
        return;
    }

    const xMin = u.posToVal(selection.left, 'x');
    const xMax = u.posToVal(selection.left + selection.width, 'x');

    // Convert from seconds to milliseconds
    state.historyStart = xMin * 1000;
    state.historyEnd = xMax * 1000;

    // Update the dropdown to show "Custom"
    const historySelect = document.getElementById('history-range');
    if (!historySelect.querySelector('option[value="custom"]')) {
        const opt = document.createElement('option');
        opt.value = 'custom';
        opt.textContent = 'Custom range';
        historySelect.appendChild(opt);
    }
    historySelect.value = 'custom';

    // Clear the selection rectangle
    u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);

    // Refresh display
    updateLayers();
    updateHistoryInfo();
}

function syncCursor(u) {
    const idx = u.cursor.idx;
    if (idx == null || !state.selectedMmsi) {
        // Cursor left chart - use unified hover handler to clear
        onPointHover(null, 'chart');
        return;
    }

    // Use the same viewport-filtered track as the charts
    const track = getFilteredTrack(state.selectedMmsi, true);
    if (idx >= 0 && idx < track.length) {
        const point = track[idx];
        // Use unified hover handler
        onPointHover(point, 'chart');
    }
}

function syncChartsToPoint(point) {
    if (!speedChart || !courseChart || !state.selectedMmsi) {
        return;
    }

    // Use the same viewport-filtered track as the charts
    const track = getFilteredTrack(state.selectedMmsi, true);
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
// Global History Control
// ============================================================================

function initHistoryControl() {
    const select = document.getElementById('history-range');
    select.value = state.historyRange;

    select.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') return; // Don't do anything if custom is selected directly

        // Clear custom range when selecting a standard option
        state.historyStart = null;
        state.historyEnd = null;
        state.historyRange = parseInt(val);

        // Remove custom option if it exists
        const customOpt = select.querySelector('option[value="custom"]');
        if (customOpt) customOpt.remove();

        // User action - immediate update
        updateLayers();
        forceChartUpdate();
        updateHistoryInfo();
    });

    updateHistoryInfo();
}

function updateHistoryInfo() {
    const info = document.getElementById('history-info');
    if (!state.selectedMmsi) {
        info.textContent = '';
        return;
    }
    const track = state.tracks.get(state.selectedMmsi) || [];
    const filtered = getFilteredTrack(state.selectedMmsi);

    if (state.historyStart != null && state.historyEnd != null) {
        const start = new Date(state.historyStart).toLocaleTimeString();
        const end = new Date(state.historyEnd).toLocaleTimeString();
        info.textContent = `${start} - ${end} (${filtered.length} pts)`;
    } else {
        info.textContent = `${filtered.length}/${track.length} pts`;
    }
}

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

    sidebarResize.addEventListener('mousedown', () => {
        isResizingSidebar = true;
        sidebarResize.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    // Sidebar vertical split resize
    const sidebarSplit = document.getElementById('sidebar-split');
    const sidebarTop = document.getElementById('sidebar-top');
    const sidebarBottom = document.getElementById('sidebar-bottom');
    let isResizingSplit = false;

    sidebarSplit.addEventListener('mousedown', () => {
        isResizingSplit = true;
        sidebarSplit.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    // Charts vertical resize
    const chartsResize = document.getElementById('charts-resize');
    const chartsPanel = document.getElementById('charts-panel');
    let isResizingCharts = false;

    chartsResize.addEventListener('mousedown', () => {
        isResizingCharts = true;
        chartsResize.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (isResizingSidebar) {
            const mainWidth = document.getElementById('main').offsetWidth;
            const newWidth = mainWidth - e.clientX;
            if (newWidth >= 280 && newWidth <= 500) {
                sidebar.style.width = newWidth + 'px';
            }
        }

        if (isResizingSplit) {
            const sidebarRect = sidebar.getBoundingClientRect();
            const newTopHeight = e.clientY - sidebarRect.top;
            const sidebarHeight = sidebarRect.height;
            if (newTopHeight >= 150 && newTopHeight <= sidebarHeight - 100) {
                sidebarTop.style.flex = 'none';
                sidebarTop.style.height = newTopHeight + 'px';
                sidebarBottom.style.height = (sidebarHeight - newTopHeight - 5) + 'px';
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
            sidebarResize.classList.remove('resizing');
        }
        if (isResizingSplit) {
            isResizingSplit = false;
            sidebarSplit.classList.remove('resizing');
        }
        if (isResizingCharts) {
            isResizingCharts = false;
            chartsResize.classList.remove('resizing');
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
// Close Details Button
// ============================================================================

function initCloseDetails() {
    document.getElementById('close-details').addEventListener('click', closeDetails);
}

// ============================================================================
// Search
// ============================================================================

function initSearch() {
    document.getElementById('search-input').addEventListener('input', applyFilters);
}

// ============================================================================
// List Tabs (Vessels / Messages)
// ============================================================================

function initListTabs() {
    document.querySelectorAll('.list-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.list-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.list}-list`).classList.add('active');
        });
    });
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
            state.selectedMmsi = msg.mmsi;
        }
    });
}

function updateMessageTable() {
    if (!messageTable) return;
    const displayData = state.messages.slice(0, 200).map(m => ({
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
    selector.value = state.mapStyle;
    selector.addEventListener('change', (e) => {
        state.mapStyle = e.target.value;
        map.setStyle(MAP_STYLES[state.mapStyle]);
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

    try {
        ws = new WebSocket(wsUrl);
    } catch (e) {
        console.error('WebSocket creation failed:', e);
        return;
    }

    ws.onopen = () => {
        console.log('WebSocket connected');
        state.connected = true;
        updateConnectionStatus();
    };

    ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        state.connected = false;
        updateConnectionStatus();
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.ping) return;

            // Handle batch history message
            if (msg.type === 'history_batch' && msg.messages) {
                console.log(`Processing ${msg.messages.length} historical messages`);
                for (const m of msg.messages) {
                    handleMessage(m, true); // true = batch mode, skip UI updates
                }
                // Single UI update after all messages processed
                document.getElementById('message-count').textContent = `${state.messageCount} messages`;
                updateVesselTable();
                updateMessageTable();
                updateLayers();

                // Zoom to fit all vessels after history load (unless URL has specific vessel)
                if (!state.mapInitialized && state.vessels.size > 0) {
                    state.mapInitialized = true;
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
    el.className = state.connected ? 'connected' : 'disconnected';
    el.querySelector('.status-text').textContent = state.connected ? 'Connected' : 'Disconnected';
}

// ============================================================================
// Message Handling
// ============================================================================

function handleMessage(msg, batchMode = false) {
    state.messageCount++;

    // Store message
    state.messages.unshift(msg);
    if (state.messages.length > MAX_MESSAGES) state.messages.pop();

    const mmsi = msg.mmsi;
    if (!mmsi) return;

    // Get or create vessel
    let vessel = state.vessels.get(mmsi);
    if (!vessel) {
        vessel = { mmsi };
        state.vessels.set(mmsi, vessel);
    }

    const msgType = msg.msg_type;

    // Always extract static vessel data if present (handles enriched messages from backend)
    if (msg.shipname) vessel.shipname = msg.shipname.trim();
    if (msg.callsign) vessel.callsign = msg.callsign.trim();
    if (msg.imo) vessel.imo = msg.imo;
    if (msg.ship_type != null) vessel.ship_type = msg.ship_type;
    if (msg.destination) vessel.destination = msg.destination.trim();
    if (msg.to_bow != null) vessel.to_bow = msg.to_bow;
    if (msg.to_stern != null) vessel.to_stern = msg.to_stern;
    if (msg.to_port != null) vessel.to_port = msg.to_port;
    if (msg.to_starboard != null) vessel.to_starboard = msg.to_starboard;
    // Backend sends nav_status, frontend uses status
    if (msg.nav_status != null) vessel.status = msg.nav_status;

    // Position reports (1, 2, 3)
    if ([1, 2, 3].includes(msgType)) {
        if (msg.lat != null && msg.lon != null && msg.lat !== 91 && msg.lon !== 181) {
            vessel.lat = msg.lat;
            vessel.lon = msg.lon;
            addTrackPoint(mmsi, msg.lat, msg.lon, msg.speed, msg.course, msg.timestamp, msgType);
        }
        if (msg.speed != null) vessel.speed = msg.speed;
        if (msg.course != null) vessel.course = msg.course;
        if (msg.heading != null) vessel.heading = msg.heading;
        if (msg.status != null) vessel.status = msg.status;
        vessel.lastUpdate = msg.timestamp || new Date().toISOString();
    }

    // Static data (5)
    if (msgType === 5) {
        if (msg.shipname) vessel.shipname = msg.shipname.trim();
        if (msg.callsign) vessel.callsign = msg.callsign.trim();
        if (msg.imo) vessel.imo = msg.imo;
        if (msg.ship_type != null) vessel.ship_type = msg.ship_type;
        if (msg.destination) vessel.destination = msg.destination.trim();
        if (msg.to_bow != null) vessel.to_bow = msg.to_bow;
        if (msg.to_stern != null) vessel.to_stern = msg.to_stern;
        if (msg.to_port != null) vessel.to_port = msg.to_port;
        if (msg.to_starboard != null) vessel.to_starboard = msg.to_starboard;
        if (msg.draught != null) vessel.draught = msg.draught;
        // ETA from AIS (month, day, hour, minute in UTC)
        if (msg.month != null && msg.day != null) {
            vessel.eta_month = msg.month;
            vessel.eta_day = msg.day;
            vessel.eta_hour = msg.hour || 0;
            vessel.eta_minute = msg.minute || 0;
        }
    }

    // Class B (18, 19)
    if ([18, 19].includes(msgType)) {
        if (msg.lat != null && msg.lon != null && msg.lat !== 91 && msg.lon !== 181) {
            vessel.lat = msg.lat;
            vessel.lon = msg.lon;
            addTrackPoint(mmsi, msg.lat, msg.lon, msg.speed, msg.course, msg.timestamp, msgType);
        }
        if (msg.speed != null) vessel.speed = msg.speed;
        if (msg.course != null) vessel.course = msg.course;
        if (msg.heading != null) vessel.heading = msg.heading;
        vessel.lastUpdate = msg.timestamp || new Date().toISOString();
        if (msgType === 19 && msg.shipname) vessel.shipname = msg.shipname.trim();
    }

    // Class B static (24)
    if (msgType === 24) {
        if (msg.shipname) vessel.shipname = msg.shipname.trim();
        if (msg.callsign) vessel.callsign = msg.callsign.trim();
        if (msg.ship_type != null) vessel.ship_type = msg.ship_type;
    }

    // Aid-to-Navigation (21)
    if (msgType === 21) {
        vessel.isAtoN = true;
        if (msg.name) vessel.shipname = msg.name.trim();
        if (msg.name_ext) vessel.shipname = (vessel.shipname || '') + msg.name_ext.trim();
        if (msg.aid_type != null) vessel.aid_type = msg.aid_type;
        if (msg.lat != null && msg.lon != null && msg.lat !== 91 && msg.lon !== 181) {
            vessel.lat = msg.lat;
            vessel.lon = msg.lon;
        }
        if (msg.virtual_aid != null) vessel.virtual_aid = msg.virtual_aid;
        if (msg.off_position != null) vessel.off_position = msg.off_position;
        if (msg.to_bow != null) vessel.to_bow = msg.to_bow;
        if (msg.to_stern != null) vessel.to_stern = msg.to_stern;
        if (msg.to_port != null) vessel.to_port = msg.to_port;
        if (msg.to_starboard != null) vessel.to_starboard = msg.to_starboard;
        vessel.lastUpdate = msg.timestamp || new Date().toISOString();
    }

    // Skip UI updates in batch mode
    if (batchMode) return;

    // Update UI through unified system
    document.getElementById('message-count').textContent = `${state.messageCount} messages`;
    updateMessageTable();

    // Use unified update functions for consistent data flow
    onVesselDataChanged(mmsi);
    onTrackDataChanged(mmsi);

    // Zoom to fit all vessels on first data
    if (!state.mapInitialized && state.vessels.size > 0) {
        state.mapInitialized = true;
        setTimeout(zoomToFitAllVessels, 500);
    }
}

function addTrackPoint(mmsi, lat, lon, speed, course, timestamp, msgType) {
    if (!state.tracks.has(mmsi)) {
        state.tracks.set(mmsi, []);
    }
    const track = state.tracks.get(mmsi);

    // Use actual message timestamp, not current time
    const time = timestamp ? new Date(timestamp).getTime() : Date.now();

    // Get current draught from vessel data (Type 5 messages update this separately)
    const vessel = state.vessels.get(mmsi);
    const draught = vessel?.draught ?? null;

    track.push({
        lat, lon, time,
        timestamp: timestamp || new Date().toISOString(),
        speed, course, mmsi, msgType: msgType || 1,
        draught,
    });
    if (track.length > MAX_TRACK_POINTS) track.shift();
}

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
    if (mmsi && state.vessels.has(mmsi)) {
        console.log(`Selecting vessel from URL hash: ${mmsi}`);
        selectVessel(mmsi);
        zoomToVessel(mmsi);
    } else if (mmsi) {
        console.log(`Vessel ${mmsi} from URL hash not found yet, will retry...`);
        // Retry after a short delay (data might still be loading)
        setTimeout(() => {
            if (state.vessels.has(mmsi)) {
                console.log(`Selecting vessel from URL hash (retry): ${mmsi}`);
                selectVessel(mmsi);
                zoomToVessel(mmsi);
            }
        }, 1000);
    }
}

function zoomToVessel(mmsi) {
    const vessel = state.vessels.get(mmsi);
    if (vessel && vessel.lat != null && vessel.lon != null) {
        map.flyTo({ center: [vessel.lon, vessel.lat], zoom: 12 });
    }
}

// Listen for hash changes
window.addEventListener('hashchange', () => {
    const mmsi = parseUrlHash();
    if (mmsi && state.vessels.has(mmsi)) {
        selectVessel(mmsi);
    }
});

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Initializing AIS Tracker...');
        initMap();
        console.log('Map initialized');
        initVesselTable();
        console.log('Vessel table initialized');
        initMessageTable();
        console.log('Message table initialized');
        initListTabs();
        console.log('List tabs initialized');
        initTypeFilters();
        initSearch();
        initHistoryControl();
        initStyleSelector();
        initGeolocation();
        initResizeHandlers();
        initCloseDetails();
        console.log('All UI initialized, connecting WebSocket...');
        connectWebSocket();

        // Check for vessel selection in URL hash after a delay
        setTimeout(selectVesselFromHash, 500);
    } catch (e) {
        console.error('Initialization error:', e);
    }
});
