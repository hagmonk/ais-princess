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
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Configuration (defaults, can be overridden via CLI)
DEFAULT_DB = Path(__file__).parent.parent / "db" / "ais-data.db"
DB_PATH = DEFAULT_DB  # Will be set by main()
STATIC_PATH = Path(__file__).parent / "static"
POLL_INTERVAL = 0.5  # 500ms - poll positions table


class ConnectionManager:
    """Manages WebSocket connections"""

    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"Client disconnected. Total: {len(self.active_connections)}")

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
    """Return vessel details including latest position"""
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

        return result


@app.get("/api/vessel/{mmsi}/track")
async def get_vessel_track(
    mmsi: int,
    limit: int = Query(default=None),
    hours: int = Query(default=None)
):
    """Return position history for a specific vessel (all positions by default)"""
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
    return {"mmsi": mmsi, "positions": positions, "count": len(positions)}


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


@app.websocket("/ws/ais")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time AIS data"""
    await manager.connect(websocket)

    # Send historical data to this client
    await send_history(websocket)

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
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    args = parser.parse_args()

    import sys
    sys.modules[__name__].DB_PATH = args.db
    print(f"Database: {args.db}")
    uvicorn.run(app, host=args.host, port=args.port)
