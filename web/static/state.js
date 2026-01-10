/**
 * AIS Vessel Tracker - Reactive State Management
 * Uses @preact/signals-core for reactive state with automatic dependency tracking.
 */

import { signal, computed, effect, batch } from '@preact/signals-core';

// ============================================================================
// Constants
// ============================================================================

export const SHIP_TYPES = {
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

export const NAV_STATUS = {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
    3: 'Restricted maneuverability', 4: 'Constrained by draught', 5: 'Moored',
    6: 'Aground', 7: 'Fishing', 8: 'Under way sailing', 11: 'Towing astern',
    12: 'Pushing ahead', 14: 'AIS-SART', 15: 'Undefined',
};

export const ATON_TYPES = {
    0: 'Unspecified', 1: 'Reference Point', 2: 'RACON', 3: 'Fixed Structure',
    4: 'Emergency Wreck Marking Buoy', 5: 'Light (no sectors)', 6: 'Light (with sectors)',
    7: 'Leading Light Front', 8: 'Leading Light Rear', 9: 'Beacon, Cardinal N',
    10: 'Beacon, Cardinal E', 11: 'Beacon, Cardinal S', 12: 'Beacon, Cardinal W',
    13: 'Beacon, Port Hand', 14: 'Beacon, Starboard Hand',
    15: 'Beacon, Preferred Channel Port', 16: 'Beacon, Preferred Channel Starboard',
    17: 'Beacon, Isolated Danger', 18: 'Beacon, Safe Water', 19: 'Beacon, Special Mark',
    20: 'Cardinal Mark N', 21: 'Cardinal Mark E', 22: 'Cardinal Mark S', 23: 'Cardinal Mark W',
    24: 'Port Hand Mark', 25: 'Starboard Hand Mark', 26: 'Preferred Channel Port',
    27: 'Preferred Channel Starboard', 28: 'Isolated Danger', 29: 'Safe Water',
    30: 'Special Mark', 31: 'Light Vessel / LANBY',
};

export const MAX_MESSAGES = 1000;

const DEFAULT_SETTINGS = {
    vesselAgeCutoff: 300,      // 5 minutes in seconds (-1 = all time)
    showVesselNames: false,
    charts: { speed: true, course: true, draught: true },
};

// ============================================================================
// Core Signals (Primary State)
// ============================================================================

// Vessel data: Map<mmsi, vessel>
export const vessels = signal(new Map());

// Track history: Map<mmsi, position[]>
export const tracks = signal(new Map());

// Message history for display
export const messages = signal([]);

// Selection state
export const selectedMmsi = signal(null);
export const selectedMessage = signal(null);

// Highlight state (for chart/track interaction)
export const highlightPoint = signal(null);
export const clickedPoint = signal(null);

// Timeline state
export const timelinePosition = signal(100);  // 0-100, 100 = now
export const timelineOldest = signal(null);   // oldest timestamp in DB (ms)
export const timelineNewest = signal(null);   // newest timestamp in DB (ms)

// UI state
export const mapStyle = signal('dark');
export const typeFilter = signal('all');
export const searchText = signal('');
export const connected = signal(false);
export const mapInitialized = signal(false);

// Settings (persisted to localStorage)
export const settings = signal(loadSettingsFromStorage());

function loadSettingsFromStorage() {
    try {
        const stored = localStorage.getItem('ais-tracker-settings');
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                ...DEFAULT_SETTINGS,
                ...parsed,
                charts: { ...DEFAULT_SETTINGS.charts, ...parsed.charts },
            };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
    }
    return { ...DEFAULT_SETTINGS, charts: { ...DEFAULT_SETTINGS.charts } };
}

// ============================================================================
// Computed Signals (Derived State)
// ============================================================================

// Timeline value in milliseconds (null = now)
export const timelineValue = computed(() => {
    const pos = timelinePosition.value;
    const oldest = timelineOldest.value;
    const newest = timelineNewest.value;

    if (pos >= 100 || !oldest || !newest) {
        return null;  // "now" mode
    }

    const range = newest - oldest;
    return oldest + (range * pos / 100);
});

// Cutoff timestamp for vessel filtering
export const timelineCutoff = computed(() => {
    const pos = timelinePosition.value;
    const value = timelineValue.value;
    const vesselAge = settings.value.vesselAgeCutoff;

    if (pos >= 100 || !value) {
        // "Now" mode - use vessel age setting
        if (vesselAge === -1) return 0;  // Show all
        return Date.now() - vesselAge * 1000;
    }

    // Timeline mode - show vessels active around selected time (+/- 5 min)
    return value - 5 * 60 * 1000;
});

// End timestamp for filtering (for timeline scrubbing)
export const timelineEnd = computed(() => {
    const pos = timelinePosition.value;
    const value = timelineValue.value;

    if (pos >= 100 || !value) return Date.now();
    return value + 5 * 60 * 1000;
});

// Get ship type category for filtering
function getShipCategory(shipType) {
    if (shipType >= 60 && shipType <= 69) return 'passenger';
    if (shipType >= 70 && shipType <= 79) return 'cargo';
    if (shipType >= 80 && shipType <= 89) return 'tanker';
    if (shipType === 30) return 'fishing';
    if (shipType === 52 || shipType === 31 || shipType === 32) return 'tug';
    return 'other';
}

// Filtered vessels based on timeline, age cutoff, type filter, and search
export const filteredVessels = computed(() => {
    const allVessels = Array.from(vessels.value.values());
    const cutoff = timelineCutoff.value;
    const filter = typeFilter.value;
    const search = searchText.value.toLowerCase();
    const selected = selectedMmsi.value;

    return allVessels.filter(v => {
        // Must have position
        if (v.lat == null || v.lon == null) return false;

        // Always show selected vessel
        if (v.mmsi === selected) return true;

        // Filter by last update time
        const lastUpdate = v.lastUpdate ? new Date(v.lastUpdate).getTime() : 0;
        if (lastUpdate < cutoff) return false;

        // Filter by type
        if (filter !== 'all') {
            if (filter === 'aton') {
                if (!v.isAtoN) return false;
            } else {
                const category = getShipCategory(v.ship_type);
                if (category !== filter) return false;
            }
        }

        // Filter by search text
        if (search) {
            const name = (v.shipname || '').toLowerCase();
            const mmsiStr = String(v.mmsi);
            const callsign = (v.callsign || '').toLowerCase();
            if (!name.includes(search) && !mmsiStr.includes(search) && !callsign.includes(search)) {
                return false;
            }
        }

        return true;
    });
});

// Count of visible vessels
export const visibleVesselCount = computed(() => filteredVessels.value.length);

// Total vessel count
export const totalVesselCount = computed(() => vessels.value.size);

// Message count
export const messageCount = computed(() => messages.value.length);

// Selected vessel object
export const selectedVessel = computed(() => {
    const mmsi = selectedMmsi.value;
    return mmsi ? vessels.value.get(mmsi) : null;
});

// Selected vessel's track
export const selectedTrack = computed(() => {
    const mmsi = selectedMmsi.value;
    return mmsi ? (tracks.value.get(mmsi) || []) : [];
});

// Filtered track for selected vessel (for charts - viewport filtered)
// This will be set by the map module when viewport changes
export const viewportBounds = signal(null);

export const viewportFilteredTrack = computed(() => {
    const track = selectedTrack.value;
    const bounds = viewportBounds.value;

    if (!bounds || track.length === 0) return track;

    const { sw, ne } = bounds;
    const latPad = (ne.lat - sw.lat) * 0.1;
    const lonPad = (ne.lng - sw.lng) * 0.1;

    return track.filter(p =>
        p.lat >= sw.lat - latPad && p.lat <= ne.lat + latPad &&
        p.lon >= sw.lng - lonPad && p.lon <= ne.lng + lonPad
    );
});

// ============================================================================
// Actions (State Mutations)
// ============================================================================

export function updateVessel(mmsi, data) {
    const newVessels = new Map(vessels.value);
    const existing = newVessels.get(mmsi) || { mmsi };
    newVessels.set(mmsi, { ...existing, ...data });
    vessels.value = newVessels;
}

export function addTrackPoint(mmsi, point) {
    const newTracks = new Map(tracks.value);
    const history = [...(newTracks.get(mmsi) || [])];
    history.push(point);
    newTracks.set(mmsi, history);
    tracks.value = newTracks;
}

export function setTrack(mmsi, trackData) {
    const newTracks = new Map(tracks.value);
    newTracks.set(mmsi, trackData);
    tracks.value = newTracks;
}

export function addMessage(msg) {
    const current = messages.value;
    const newMessages = [msg, ...current].slice(0, MAX_MESSAGES);
    messages.value = newMessages;
}

export function selectVessel(mmsi) {
    selectedMmsi.value = mmsi;
    selectedMessage.value = null;
    highlightPoint.value = null;
    clickedPoint.value = null;
}

export function deselectVessel() {
    selectedMmsi.value = null;
    selectedMessage.value = null;
    highlightPoint.value = null;
    clickedPoint.value = null;
    timelinePosition.value = 100;  // Reset to now
}

export function setHighlightPoint(point) {
    highlightPoint.value = point;
}

export function setClickedPoint(point) {
    clickedPoint.value = point;
}

export function setTimelinePosition(pos) {
    timelinePosition.value = pos;
}

export function setTimelineRange(oldest, newest) {
    timelineOldest.value = oldest;
    timelineNewest.value = newest;
}

export function setTypeFilter(filter) {
    typeFilter.value = filter;
}

export function setSearchText(text) {
    searchText.value = text;
}

export function setMapStyle(style) {
    mapStyle.value = style;
}

export function setConnected(isConnected) {
    connected.value = isConnected;
}

export function setMapInitialized(initialized) {
    mapInitialized.value = initialized;
}

export function setViewportBounds(bounds) {
    viewportBounds.value = bounds;
}

export function updateSettings(newSettings) {
    settings.value = { ...settings.value, ...newSettings };
    saveSettingsToStorage();
}

export function updateChartSettings(chartSettings) {
    settings.value = {
        ...settings.value,
        charts: { ...settings.value.charts, ...chartSettings }
    };
    saveSettingsToStorage();
}

function saveSettingsToStorage() {
    try {
        localStorage.setItem('ais-tracker-settings', JSON.stringify(settings.value));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}

export function resetSettings() {
    settings.value = { ...DEFAULT_SETTINGS, charts: { ...DEFAULT_SETTINGS.charts } };
    saveSettingsToStorage();
}

// Batch update for WebSocket messages
export function batchUpdate(fn) {
    batch(fn);
}

// ============================================================================
// Effect Registration (for side effects)
// ============================================================================

// Store cleanup functions for effects
const cleanupFns = [];

export function registerEffect(effectFn) {
    const cleanup = effect(effectFn);
    cleanupFns.push(cleanup);
    return cleanup;
}

export function cleanupEffects() {
    cleanupFns.forEach(fn => fn());
    cleanupFns.length = 0;
}
