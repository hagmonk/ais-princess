#!/usr/bin/env python3
"""
AIS Vessel Tracker - FastAPI Backend

Reads decoded AIS data from SQLite and broadcasts via WebSocket.
Decoded data is populated by db/decoder.py service.
"""

# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "fastapi",
#     "uvicorn[standard]",
#     "aiosqlite",
# ]
# ///

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Configuration (defaults, can be overridden via CLI)
DEFAULT_DB = Path(__file__).parent.parent / "db" / "ais-data.db"
DB_PATH = DEFAULT_DB  # Will be set by main()
STATIC_PATH = Path(__file__).parent / "static"
POLL_INTERVAL = 0.5  # 500ms - poll positions table


# ============================================================================
# Port Resolution
# ============================================================================

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great circle distance in nautical miles."""
    import math
    R = 3440.065  # Earth radius in nautical miles
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (math.sin(dLat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dLon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


async def find_nearest_seaport(db: aiosqlite.Connection, lat: float, lon: float, limit_km: float = 100) -> dict | None:
    """Find the nearest seaport (WPI or LOCODE) to given coordinates.

    Uses a bounding box for initial filtering, then calculates actual distances.
    Only considers ports with source='wpi' or source='locode' (not airports).
    """
    import math
    # Approximate degrees per km at this latitude
    km_per_deg_lat = 111.0
    km_per_deg_lon = 111.0 * abs(math.cos(lat * math.pi / 180))

    # Bounding box (generous to catch nearby ports)
    lat_delta = limit_km / km_per_deg_lat
    lon_delta = limit_km / km_per_deg_lon if km_per_deg_lon > 0 else limit_km / 111.0

    async with db.execute(
        """SELECT locode, name, country, lat, lon, source,
                  ((?1 - lat) * (?1 - lat) + (?2 - lon) * (?2 - lon)) as dist_sq
           FROM ports
           WHERE source IN ('wpi', 'locode')
             AND lat BETWEEN ?1 - ?3 AND ?1 + ?3
             AND lon BETWEEN ?2 - ?4 AND ?2 + ?4
           ORDER BY dist_sq ASC
           LIMIT 1""",
        (lat, lon, lat_delta, lon_delta)
    ) as cursor:
        row = await cursor.fetchone()
        if row:
            # Calculate actual distance
            port_lat, port_lon = row[3], row[4]
            distance_nm = calculate_distance(lat, lon, port_lat, port_lon)
            return {
                "locode": row[0],
                "name": row[1],
                "country": row[2],
                "lat": port_lat,
                "lon": port_lon,
                "source": row[5],
                "distance_from_reference_nm": round(distance_nm, 1),
            }
    return None


async def resolve_destination(db: aiosqlite.Connection, destination: str) -> dict | None:
    """
    Resolve an AIS destination field to port coordinates.

    Resolution priority:
    1. Exact UN/LOCODE match
    2. Fuzzy match on port name
    3. Partial match on port name

    If the match is an airport (source='iata'), snaps to the nearest seaport
    since ships can't dock at airports.
    """
    if not destination:
        return None

    # Clean destination string
    dest_clean = destination.strip().upper().replace(' ', '')
    dest_words = destination.strip().upper()

    result = None

    # 1. Exact locode match (e.g., "USLAX", "USHNL")
    async with db.execute(
        "SELECT locode, name, country, lat, lon, source FROM ports WHERE locode = ?",
        (dest_clean,)
    ) as cursor:
        row = await cursor.fetchone()
        if row:
            result = {
                "locode": row[0],
                "name": row[1],
                "country": row[2],
                "lat": row[3],
                "lon": row[4],
                "source": row[5],
                "match_type": "exact_locode",
            }

    # 2. Try first 5 chars as locode (common in AIS)
    if not result and len(dest_clean) >= 5:
        async with db.execute(
            "SELECT locode, name, country, lat, lon, source FROM ports WHERE locode = ?",
            (dest_clean[:5],)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                result = {
                    "locode": row[0],
                    "name": row[1],
                    "country": row[2],
                    "lat": row[3],
                    "lon": row[4],
                    "source": row[5],
                    "match_type": "prefix_locode",
                }

    # 3. Exact name match (case insensitive)
    if not result:
        async with db.execute(
            "SELECT locode, name, country, lat, lon, source FROM ports WHERE UPPER(name) = ? OR UPPER(name_ascii) = ?",
            (dest_words, dest_words)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                result = {
                    "locode": row[0],
                    "name": row[1],
                    "country": row[2],
                    "lat": row[3],
                    "lon": row[4],
                    "source": row[5],
                    "match_type": "exact_name",
                }

    # 4. Partial name match (starts with destination)
    if not result:
        async with db.execute(
            """SELECT locode, name, country, lat, lon, source FROM ports
               WHERE UPPER(name) LIKE ? OR UPPER(name_ascii) LIKE ?
               ORDER BY LENGTH(name) ASC LIMIT 1""",
            (f"{dest_words}%", f"{dest_words}%")
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                result = {
                    "locode": row[0],
                    "name": row[1],
                    "country": row[2],
                    "lat": row[3],
                    "lon": row[4],
                    "source": row[5],
                    "match_type": "prefix_name",
                }

    # 5. Contains match (destination contains port name or vice versa)
    if not result:
        async with db.execute(
            """SELECT locode, name, country, lat, lon, source FROM ports
               WHERE UPPER(name) LIKE ? OR ? LIKE '%' || UPPER(name) || '%'
               ORDER BY source ASC, LENGTH(name) DESC LIMIT 1""",
            (f"%{dest_words}%", dest_words)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                result = {
                    "locode": row[0],
                    "name": row[1],
                    "country": row[2],
                    "lat": row[3],
                    "lon": row[4],
                    "source": row[5],
                    "match_type": "contains",
                }

    # If we matched an airport, snap to nearest seaport (ships can't dock at airports)
    if result and result["source"] == "iata":
        airport_info = {
            "name": result["name"],
            "locode": result["locode"],
            "lat": result["lat"],
            "lon": result["lon"],
        }
        nearest = await find_nearest_seaport(db, result["lat"], result["lon"])
        if nearest:
            result = nearest
            result["match_type"] = "snapped_from_airport"
            result["airport_reference"] = airport_info
        # If no nearby seaport found, keep the airport as a rough location

    return result


# ============================================================================
# Port Visit Detection
# ============================================================================

# Detection parameters
MIN_STOP_HOURS = 1.0      # Minimum duration to count as port visit
MAX_SPEED_KNOTS = 0.5     # Speed threshold for "stationary"
GAP_HOURS = 1.0           # Time gap to start new stop cluster
MAX_PORT_DISTANCE_KM = 5  # Maximum distance to match to a port


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate approximate distance in km."""
    import math
    lat_diff = lat2 - lat1
    lon_diff = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    return 111.12 * math.sqrt(lat_diff * lat_diff + lon_diff * lon_diff)


async def detect_port_visits(db: aiosqlite.Connection, mmsi: int) -> list[dict]:
    """Detect port visits from track data by analyzing stationary periods."""

    gap_days = GAP_HOURS / 24.0

    # Query to find stops using window functions
    query = """
    WITH stationary_points AS (
        SELECT
            timestamp,
            lat, lon, speed,
            julianday(timestamp) - lag(julianday(timestamp)) OVER (ORDER BY timestamp) as gap_days
        FROM positions
        WHERE mmsi = ? AND speed < ?
    ),
    stop_starts AS (
        SELECT
            timestamp, lat, lon,
            CASE WHEN gap_days > ? OR gap_days IS NULL THEN 1 ELSE 0 END as new_stop
        FROM stationary_points
    ),
    stop_groups AS (
        SELECT
            timestamp, lat, lon,
            SUM(new_stop) OVER (ORDER BY timestamp) as stop_id
        FROM stop_starts
    )
    SELECT
        stop_id,
        COUNT(*) as points,
        AVG(lat) as lat,
        AVG(lon) as lon,
        MIN(timestamp) as arrival,
        MAX(timestamp) as departure,
        (julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24 as hours
    FROM stop_groups
    GROUP BY stop_id
    HAVING hours >= ?
    ORDER BY arrival DESC
    LIMIT 10
    """

    async with db.execute(query, (mmsi, MAX_SPEED_KNOTS, gap_days, MIN_STOP_HOURS)) as cursor:
        stops = await cursor.fetchall()

    visits = []
    for stop in stops:
        stop_lat, stop_lon = stop[2], stop[3]

        # Find nearest port
        port = await match_stop_to_port(db, stop_lat, stop_lon)

        if port:
            visits.append({
                "locode": port["locode"],
                "name": port["name"],
                "country": port.get("country"),
                "region": port.get("region"),
                "lat": port["lat"],
                "lon": port["lon"],
                "arrival": stop[4],
                "departure": stop[5],
                "duration_hours": round(stop[6], 1),
                "distance_km": port["distance_km"]
            })

    return visits


async def detect_voyage_segments(db: aiosqlite.Connection, mmsi: int) -> list[dict]:
    """Detect voyage segments by grouping track points with the same destination."""

    # Get all positions with destination info
    query = """
    SELECT
        p.timestamp, p.lat, p.lon, p.speed, p.course,
        v.destination
    FROM positions p
    LEFT JOIN vessels v ON p.mmsi = v.mmsi
    WHERE p.mmsi = ?
    ORDER BY p.timestamp
    """

    async with db.execute(query, (mmsi,)) as cursor:
        rows = await cursor.fetchall()

    if not rows:
        return []

    # Group consecutive positions by destination
    segments = []
    current_dest = None
    current_segment = []

    for row in rows:
        timestamp, lat, lon, speed, course, dest = row
        dest = dest.strip() if dest else None

        if dest != current_dest:
            # Save previous segment if it exists
            if current_segment and current_dest:
                segments.append({
                    "destination": current_dest,
                    "points": current_segment
                })
            # Start new segment
            current_dest = dest
            current_segment = []

        current_segment.append({
            "timestamp": timestamp,
            "lat": lat,
            "lon": lon,
            "speed": speed,
            "course": course
        })

    # Don't forget last segment
    if current_segment and current_dest:
        segments.append({
            "destination": current_dest,
            "points": current_segment
        })

    # Process segments to compute stats and resolve destinations
    result = []
    for seg in segments:
        if len(seg["points"]) < 2:
            continue

        points = seg["points"]
        start_time = points[0]["timestamp"]
        end_time = points[-1]["timestamp"]

        # Calculate duration
        from datetime import datetime
        try:
            start_dt = datetime.fromisoformat(start_time.replace("+00:00", ""))
            end_dt = datetime.fromisoformat(end_time.replace("+00:00", ""))
            duration_hours = (end_dt - start_dt).total_seconds() / 3600
        except:
            duration_hours = 0

        # Calculate average speed (exclude zeros)
        speeds = [p["speed"] for p in points if p["speed"] and p["speed"] > 0]
        avg_speed = sum(speeds) / len(speeds) if speeds else 0

        # Get midpoint for marker placement
        mid_idx = len(points) // 2
        mid_point = points[mid_idx]

        # Resolve destination port
        dest_port = await resolve_destination(db, seg["destination"])

        result.append({
            "destination_code": seg["destination"],
            "destination_port": dest_port,
            "start_time": start_time,
            "end_time": end_time,
            "duration_hours": round(duration_hours, 1),
            "avg_speed": round(avg_speed, 1),
            "point_count": len(points),
            "midpoint_lat": mid_point["lat"],
            "midpoint_lon": mid_point["lon"]
        })

    return result


async def match_stop_to_port(db: aiosqlite.Connection, lat: float, lon: float) -> dict | None:
    """Find nearest port to a stop location."""
    import math

    # Use bounding box for initial filter
    lat_range = MAX_PORT_DISTANCE_KM / 111.12
    lon_range = lat_range / math.cos(math.radians(lat))

    query = """
    SELECT locode, name, lat, lon, source, country, region
    FROM ports
    WHERE lat BETWEEN ? AND ?
      AND lon BETWEEN ? AND ?
      AND source IN ('wpi', 'locode')
    """

    async with db.execute(query, (
        lat - lat_range, lat + lat_range,
        lon - lon_range, lon + lon_range
    )) as cursor:
        rows = await cursor.fetchall()

    best_match = None
    best_distance = float('inf')

    for row in rows:
        port_lat, port_lon = row[2], row[3]
        distance = haversine_km(lat, lon, port_lat, port_lon)

        if distance < best_distance and distance <= MAX_PORT_DISTANCE_KM:
            best_distance = distance
            best_match = {
                "locode": row[0],
                "name": row[1],
                "lat": port_lat,
                "lon": port_lon,
                "source": row[4],
                "country": row[5],
                "region": row[6],
                "distance_km": round(distance, 2)
            }

    return best_match


class ConnectionManager:
    """Manages WebSocket connections"""

    def __init__(self):
        self.active_connections: set[WebSocket] = set()
        self._initializing: set[WebSocket] = set()  # Clients receiving history

    async def accept(self, websocket: WebSocket):
        """Accept connection but don't add to broadcast list yet"""
        await websocket.accept()
        self._initializing.add(websocket)
        print(f"Client accepted (initializing). Total active: {len(self.active_connections)}")

    def activate(self, websocket: WebSocket):
        """Move client from initializing to active (ready for broadcasts)"""
        self._initializing.discard(websocket)
        self.active_connections.add(websocket)
        print(f"Client activated. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self._initializing.discard(websocket)
        self.active_connections.discard(websocket)
        print(f"Client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        if not self.active_connections:
            return

        data = json.dumps(message)
        disconnected = []

        for connection in self.active_connections:
            try:
                await connection.send_text(data)
            except Exception:
                disconnected.append(connection)

        for conn in disconnected:
            self.disconnect(conn)

    async def send_to(self, websocket: WebSocket, message: dict):
        """Send message to specific client"""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception:
            self.disconnect(websocket)


manager = ConnectionManager()
last_position_id = 0


def row_to_dict(row: aiosqlite.Row) -> dict:
    """Convert a database row to a dictionary, filtering None values."""
    return {k: v for k, v in dict(row).items() if v is not None}


async def send_history(websocket: WebSocket):
    """Send latest positions to newly connected client"""
    if not DB_PATH.exists():
        return

    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row

            # Get all latest positions (one per vessel) - this is instant
            async with db.execute(
                """
                SELECT mmsi, timestamp, msg_type, lat, lon, speed, course, heading,
                       nav_status, shipname, callsign, imo, ship_type, destination,
                       draught, eta_month, eta_day, eta_hour, eta_minute,
                       to_bow, to_stern, to_port, to_starboard
                FROM latest_positions
                ORDER BY timestamp DESC
                """
            ) as cursor:
                rows = await cursor.fetchall()

            # Convert to message format expected by frontend
            messages = []
            for row in rows:
                msg = row_to_dict(row)
                msg["id"] = row["mmsi"]  # Use mmsi as id for latest positions
                messages.append(msg)

            if messages:
                payload = {
                    "type": "history_batch",
                    "messages": messages
                }
                await websocket.send_text(json.dumps(payload))
                # Log sample of what we're sending
                sample = messages[:3] if len(messages) >= 3 else messages
                print(f"Sent {len(messages)} vessel positions to client. Sample: {sample}")

    except Exception as e:
        print(f"Error sending history: {e}")


async def poll_positions():
    """Background task to poll positions table for new entries"""
    global last_position_id

    # Wait for database to exist
    while not DB_PATH.exists():
        await asyncio.sleep(1)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Get the latest position ID to start from
        async with db.execute("SELECT MAX(id) FROM positions") as cursor:
            row = await cursor.fetchone()
            if row and row[0]:
                last_position_id = row[0]

        print(f"Polling positions from id={last_position_id}")

        while True:
            try:
                # Get new positions
                async with db.execute(
                    """
                    SELECT p.id, p.timestamp, p.mmsi, p.msg_type, p.lat, p.lon,
                           p.speed, p.course, p.heading, p.nav_status,
                           v.shipname, v.callsign, v.imo, v.ship_type, v.destination,
                           v.to_bow, v.to_stern, v.to_port, v.to_starboard
                    FROM positions p
                    LEFT JOIN vessels v ON p.mmsi = v.mmsi
                    WHERE p.id > ?
                    ORDER BY p.id
                    """,
                    (last_position_id,)
                ) as cursor:
                    count = 0
                    async for row in cursor:
                        msg = row_to_dict(row)
                        await manager.broadcast(msg)
                        last_position_id = row["id"]
                        count += 1
                    if count > 0:
                        print(f"Broadcast {count} new positions (last_id={last_position_id})")

            except Exception as e:
                print(f"Poll error: {e}")

            await asyncio.sleep(POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Start polling task
    poll_task = asyncio.create_task(poll_positions())
    yield
    # Shutdown
    poll_task.cancel()
    try:
        await poll_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="AIS Vessel Tracker", lifespan=lifespan)

# Add GZip compression for large responses (e.g., track data)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Add CORS middleware (needed for WebSocket connections from different origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local network access
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_PATH), name="static")


@app.get("/")
async def index():
    """Serve the main page"""
    return FileResponse(STATIC_PATH / "index.html")


@app.get("/api/styles")
async def get_styles():
    """Return available map styles"""
    return {
        "styles": [
            {"id": "dark", "name": "Dark", "url": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"},
            {"id": "light", "name": "Light", "url": "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"},
            {"id": "voyager", "name": "Voyager", "url": "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"},
        ]
    }


@app.get("/api/latest")
async def get_latest_positions():
    """Return all latest positions (one per vessel) - instant query"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT mmsi, timestamp, msg_type, lat, lon, speed, course, heading,
                   nav_status, shipname, callsign, imo, ship_type, destination,
                   draught, eta_month, eta_day, eta_hour, eta_minute,
                   to_bow, to_stern, to_port, to_starboard
            FROM latest_positions
            ORDER BY timestamp DESC
            """
        ) as cursor:
            rows = await cursor.fetchall()

    vessels = [row_to_dict(row) for row in rows]
    return {"vessels": vessels, "count": len(vessels)}


@app.get("/api/vessels")
async def get_vessels():
    """Return all vessels with static data"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT mmsi, shipname, callsign, imo, ship_type, destination,
                   to_bow, to_stern, to_port, to_starboard,
                   first_seen, last_seen, position_count
            FROM vessels
            ORDER BY last_seen DESC
            """
        ) as cursor:
            rows = await cursor.fetchall()

    vessels = [row_to_dict(row) for row in rows]
    return {"vessels": vessels, "count": len(vessels)}


@app.get("/api/vessel/{mmsi}")
async def get_vessel(mmsi: int):
    """Return vessel details including latest position and resolved destination"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Get vessel static data
        async with db.execute(
            "SELECT * FROM vessels WHERE mmsi = ?", (mmsi,)
        ) as cursor:
            vessel_row = await cursor.fetchone()

        # Get latest position
        async with db.execute(
            "SELECT * FROM latest_positions WHERE mmsi = ?", (mmsi,)
        ) as cursor:
            position_row = await cursor.fetchone()

        if not vessel_row and not position_row:
            return {"error": "Vessel not found", "mmsi": mmsi}

        result = {}
        if vessel_row:
            result.update(row_to_dict(vessel_row))
        if position_row:
            result.update(row_to_dict(position_row))

        # Resolve destination if present
        destination = result.get("destination")
        if destination:
            resolved = await resolve_destination(db, destination)
            if resolved:
                result["destination_port"] = resolved
                # Calculate distance and ETA if we have vessel position and speed
                lat = result.get("lat")
                lon = result.get("lon")
                speed = result.get("speed")
                if lat is not None and lon is not None:
                    distance = calculate_distance(lat, lon, resolved["lat"], resolved["lon"])
                    result["destination_distance_nm"] = round(distance, 1)
                    if speed and speed > 0:
                        eta_hours = distance / speed
                        result["destination_eta_hours"] = round(eta_hours, 1)

        # Detect port visits dynamically from track data
        visits = await detect_port_visits(db, mmsi)
        if visits:
            result["port_visits"] = visits

        return result


@app.get("/api/vessel/{mmsi}/track")
async def get_vessel_track(
    mmsi: int,
    limit: int = Query(default=None, description="Max positions to return"),
    hours: int = Query(default=None, description="Hours of history"),
    include_analysis: bool = Query(default=False, description="Include port stops and voyage segments")
):
    """Return position history for a specific vessel.

    When include_analysis=true, also returns detected port stops and voyage segments.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Build query based on parameters
        query = """
            SELECT id, timestamp, msg_type, lat, lon, speed, course, heading, nav_status
            FROM positions
            WHERE mmsi = ?
        """
        params = [mmsi]

        if hours:
            query += " AND timestamp > datetime('now', ?)"
            params.append(f"-{hours} hours")

        query += " ORDER BY timestamp DESC"

        if limit:
            query += " LIMIT ?"
            params.append(limit)

        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        positions = [row_to_dict(row) for row in rows]

        result = {"mmsi": mmsi, "positions": positions, "count": len(positions)}

        # Include port stops and voyage segments if requested
        if include_analysis:
            port_stops = await detect_port_visits(db, mmsi)
            voyage_segments = await detect_voyage_segments(db, mmsi)
            result["port_stops"] = port_stops
            result["voyage_segments"] = voyage_segments

    return result


@app.get("/api/vessel/{mmsi}/port-visits")
async def get_vessel_port_visits(mmsi: int):
    """Return detected port visits for a vessel.

    Port visits are detected dynamically by analyzing track data for stationary
    periods (speed < 0.5 knots for > 1 hour) and matching to nearest known ports.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        visits = await detect_port_visits(db, mmsi)

    return {"mmsi": mmsi, "port_visits": visits, "count": len(visits)}


@app.get("/api/vessel/{mmsi}/messages")
async def get_vessel_messages(
    mmsi: int,
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    hours: int = Query(default=None, description="Filter to last N hours. Omit for all time."),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
):
    """Return all message types for a specific vessel with pagination and sorting"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Build time filter condition
        time_filter = ""
        time_param = None
        if hours is not None and hours > 0:
            time_filter = "AND timestamp > datetime('now', ?)"
            time_param = f"-{hours} hours"

        # Count total messages for pagination
        total = 0
        for table, extra_cols in [
            ("positions", ""),
            ("binary_messages", ""),
            ("safety_messages", ""),
        ]:
            count_query = f"SELECT COUNT(*) FROM {table} WHERE mmsi = ? {time_filter}"
            params = [mmsi] if not time_param else [mmsi, time_param]
            async with db.execute(count_query, params) as cursor:
                row = await cursor.fetchone()
                total += row[0] if row else 0

        messages = []

        # Determine order direction
        order_dir = "ASC" if sort_order == "asc" else "DESC"

        # Get position messages
        query = f"""
            SELECT id, raw_message_id, timestamp, msg_type, lat, lon, speed, course, heading, nav_status
            FROM positions
            WHERE mmsi = ? {time_filter}
            ORDER BY timestamp {order_dir}
        """
        params = [mmsi] if not time_param else [mmsi, time_param]
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            for row in rows:
                msg = row_to_dict(row)
                msg["message_type"] = "position"
                msg["mmsi"] = mmsi
                messages.append(msg)

        # Get binary messages
        query = f"""
            SELECT id, raw_message_id, timestamp, msg_type, dest_mmsi, dac, fid, decoded_json
            FROM binary_messages
            WHERE mmsi = ? {time_filter}
            ORDER BY timestamp {order_dir}
        """
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            for row in rows:
                msg = row_to_dict(row)
                msg["message_type"] = "binary"
                msg["mmsi"] = mmsi
                messages.append(msg)

        # Get safety messages
        query = f"""
            SELECT id, raw_message_id, timestamp, msg_type, dest_mmsi, text
            FROM safety_messages
            WHERE mmsi = ? {time_filter}
            ORDER BY timestamp {order_dir}
        """
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            for row in rows:
                msg = row_to_dict(row)
                msg["message_type"] = "safety"
                msg["mmsi"] = mmsi
                messages.append(msg)

        # Sort all messages by timestamp
        reverse = sort_order == "desc"
        messages.sort(key=lambda m: m.get("timestamp", ""), reverse=reverse)

        # Apply pagination
        paginated = messages[offset:offset + limit]

    return {
        "mmsi": mmsi,
        "messages": paginated,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + limit < total,
    }


@app.get("/api/stats")
async def get_stats():
    """Return database statistics"""
    async with aiosqlite.connect(DB_PATH) as db:
        stats = {}

        for table in ["raw_messages", "positions", "vessels", "latest_positions", "base_stations", "nav_aids"]:
            async with db.execute(f"SELECT COUNT(*) FROM {table}") as cursor:
                row = await cursor.fetchone()
                stats[table] = row[0] if row else 0

        # Decode status
        async with db.execute(
            "SELECT decoded, COUNT(*) FROM raw_messages GROUP BY decoded"
        ) as cursor:
            rows = await cursor.fetchall()
            stats["decode_status"] = {
                "pending": 0,
                "decoded": 0,
                "error": 0,
                "partial": 0,
            }
            for row in rows:
                status, count = row
                if status == 0:
                    stats["decode_status"]["pending"] = count
                elif status == 1:
                    stats["decode_status"]["decoded"] = count
                elif status == -1:
                    stats["decode_status"]["error"] = count
                elif status == 2:
                    stats["decode_status"]["partial"] = count

    return stats


@app.get("/api/timerange")
async def get_timerange():
    """Return the time range of all position data (oldest and newest timestamps)"""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT MIN(timestamp), MAX(timestamp) FROM positions"
        ) as cursor:
            row = await cursor.fetchone()

        if row and row[0] and row[1]:
            return {
                "oldest": row[0],
                "newest": row[1],
            }
        return {"oldest": None, "newest": None}


@app.get("/api/ports/resolve")
async def resolve_port(destination: str = Query(..., description="Destination string to resolve")):
    """Resolve an AIS destination string to port coordinates."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        result = await resolve_destination(db, destination)

        if result:
            return {
                "resolved": True,
                "destination": destination,
                "port": result,
            }
        return {
            "resolved": False,
            "destination": destination,
            "port": None,
        }


@app.get("/api/ports/search")
async def search_ports(
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(default=20, le=100),
):
    """Search ports by name or locode."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = q.strip().upper()

        async with db.execute(
            """SELECT locode, name, country, lat, lon, source
               FROM ports
               WHERE locode LIKE ? OR UPPER(name) LIKE ? OR UPPER(name_ascii) LIKE ?
               ORDER BY
                   CASE WHEN locode = ? THEN 0
                        WHEN locode LIKE ? THEN 1
                        WHEN UPPER(name) = ? THEN 2
                        ELSE 3
                   END,
                   source ASC,
                   name ASC
               LIMIT ?""",
            (f"{query}%", f"%{query}%", f"%{query}%", query, f"{query}%", query, limit)
        ) as cursor:
            rows = await cursor.fetchall()

        ports = [
            {
                "locode": row["locode"],
                "name": row["name"],
                "country": row["country"],
                "lat": row["lat"],
                "lon": row["lon"],
                "source": row["source"],
            }
            for row in rows
        ]

        return {"query": q, "ports": ports, "count": len(ports)}


@app.get("/api/ports/stats")
async def get_port_stats():
    """Return port database statistics."""
    async with aiosqlite.connect(DB_PATH) as db:
        # Check if ports table exists
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ports'"
        ) as cursor:
            if not await cursor.fetchone():
                return {"error": "Port database not initialized. Run: uv run db/sync_ports.py"}

        async with db.execute("SELECT COUNT(*) FROM ports") as cursor:
            total = (await cursor.fetchone())[0]

        async with db.execute("SELECT COUNT(*) FROM ports WHERE source = 'wpi'") as cursor:
            wpi_count = (await cursor.fetchone())[0]

        async with db.execute("SELECT COUNT(*) FROM ports WHERE source = 'locode'") as cursor:
            locode_count = (await cursor.fetchone())[0]

        return {
            "total": total,
            "wpi": wpi_count,
            "locode": locode_count,
            "initialized": total > 0,
        }


@app.websocket("/ws/ais")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time AIS data"""
    # Accept connection but don't add to broadcast list yet
    await manager.accept(websocket)

    # Send historical data to this client (broadcasts won't interfere)
    await send_history(websocket)

    # Now add to broadcast list - client is ready for real-time updates
    manager.activate(websocket)

    try:
        # Keep connection alive - just wait for disconnect
        while True:
            try:
                # Use receive with timeout to detect disconnects
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # Send ping to check connection
                try:
                    await websocket.send_text('{"ping": true}')
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="AIS Vessel Tracker")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Database path")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    args = parser.parse_args()

    import sys
    sys.modules[__name__].DB_PATH = args.db
    print(f"Database: {args.db}")
    uvicorn.run(app, host=args.host, port=args.port)
