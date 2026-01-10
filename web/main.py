#!/usr/bin/env python3
"""
AIS Vessel Tracker - FastAPI Backend

Polls SQLite for raw NMEA messages, decodes them, and broadcasts via WebSocket.
"""

# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "fastapi",
#     "uvicorn[standard]",
#     "aiosqlite",
#     "pyais",
# ]
# ///

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import aiosqlite
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pyais import decode
from pyais.messages import AISSentence
from pyais.tracker import AISTracker, AISTrackEvent

# Configuration (defaults, can be overridden via CLI)
DEFAULT_DB = Path(__file__).parent / "ais-data.db"
DB_PATH = DEFAULT_DB  # Will be set by main()
STATIC_PATH = Path(__file__).parent / "static"
POLL_INTERVAL = 0.1  # 100ms
HISTORY_LIMIT = 50000  # Max historical messages to send on connect


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
last_id = 0
tracker = AISTracker()  # Tracks vessel state, handles multi-part messages
message_buffer: dict = {}  # For multi-sentence message assembly (for broadcasting)


# Known fields by message type for validation
KNOWN_FIELDS = {
    # Position reports (1, 2, 3)
    1: {'msg_type', 'repeat', 'mmsi', 'status', 'turn', 'speed', 'accuracy', 'lon', 'lat',
        'course', 'heading', 'second', 'maneuver', 'spare_1', 'raim', 'radio'},
    2: {'msg_type', 'repeat', 'mmsi', 'status', 'turn', 'speed', 'accuracy', 'lon', 'lat',
        'course', 'heading', 'second', 'maneuver', 'spare_1', 'raim', 'radio'},
    3: {'msg_type', 'repeat', 'mmsi', 'status', 'turn', 'speed', 'accuracy', 'lon', 'lat',
        'course', 'heading', 'second', 'maneuver', 'spare_1', 'raim', 'radio'},
    # Base station (4, 11)
    4: {'msg_type', 'repeat', 'mmsi', 'year', 'month', 'day', 'hour', 'minute', 'second',
        'accuracy', 'lon', 'lat', 'epfd', 'spare_1', 'raim', 'radio'},
    11: {'msg_type', 'repeat', 'mmsi', 'year', 'month', 'day', 'hour', 'minute', 'second',
         'accuracy', 'lon', 'lat', 'epfd', 'spare_1', 'raim', 'radio'},
    # Static data (5)
    5: {'msg_type', 'repeat', 'mmsi', 'ais_version', 'imo', 'callsign', 'shipname',
        'ship_type', 'to_bow', 'to_stern', 'to_port', 'to_starboard', 'epfd',
        'month', 'day', 'hour', 'minute', 'draught', 'destination', 'dte', 'spare_1'},
    # Binary messages (6, 8)
    6: {'msg_type', 'repeat', 'mmsi', 'seqno', 'dest_mmsi', 'retransmit', 'spare_1', 'dac', 'fid', 'data'},
    8: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'dac', 'fid', 'data'},
    # Acknowledge (7, 13)
    7: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'mmsi1', 'mmsiseq1', 'mmsi2', 'mmsiseq2', 'mmsi3', 'mmsiseq3', 'mmsi4', 'mmsiseq4'},
    13: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'mmsi1', 'mmsiseq1', 'mmsi2', 'mmsiseq2', 'mmsi3', 'mmsiseq3', 'mmsi4', 'mmsiseq4'},
    # SAR aircraft (9)
    9: {'msg_type', 'repeat', 'mmsi', 'alt', 'speed', 'accuracy', 'lon', 'lat', 'course',
        'second', 'reserved_1', 'dte', 'spare_1', 'assigned', 'raim', 'radio'},
    # Interrogation (10, 15)
    10: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'dest_mmsi', 'spare_2'},
    15: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'mmsi1', 'type1_1', 'offset1_1', 'spare_2',
         'type1_2', 'offset1_2', 'spare_3', 'mmsi2', 'type2_1', 'offset2_1', 'spare_4'},
    # Safety messages (12, 14)
    12: {'msg_type', 'repeat', 'mmsi', 'seqno', 'dest_mmsi', 'retransmit', 'spare_1', 'text'},
    14: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'text'},
    # Assignment (16, 20)
    16: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'mmsi1', 'offset1', 'increment1', 'mmsi2', 'offset2', 'increment2'},
    20: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'offset1', 'number1', 'timeout1', 'increment1',
         'offset2', 'number2', 'timeout2', 'increment2', 'offset3', 'number3', 'timeout3', 'increment3',
         'offset4', 'number4', 'timeout4', 'increment4'},
    # DGNSS (17)
    17: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'lon', 'lat', 'spare_2', 'data'},
    # Class B (18, 19)
    18: {'msg_type', 'repeat', 'mmsi', 'reserved_1', 'speed', 'accuracy', 'lon', 'lat', 'course',
         'heading', 'second', 'reserved_2', 'cs', 'display', 'dsc', 'band', 'msg22', 'assigned', 'raim', 'radio'},
    19: {'msg_type', 'repeat', 'mmsi', 'reserved_1', 'speed', 'accuracy', 'lon', 'lat', 'course',
         'heading', 'second', 'reserved_2', 'shipname', 'ship_type', 'to_bow', 'to_stern',
         'to_port', 'to_starboard', 'epfd', 'raim', 'dte', 'assigned', 'spare_1'},
    # Navigation aid (21)
    21: {'msg_type', 'repeat', 'mmsi', 'aid_type', 'name', 'accuracy', 'lon', 'lat',
         'to_bow', 'to_stern', 'to_port', 'to_starboard', 'epfd', 'second', 'off_position',
         'reserved_1', 'raim', 'virtual_aid', 'assigned', 'spare_1', 'name_ext'},
    # Channel management (22)
    22: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'channel_a', 'channel_b', 'txrx', 'power',
         'ne_lon', 'ne_lat', 'sw_lon', 'sw_lat', 'addressed', 'band_a', 'band_b', 'zonesize', 'spare_2'},
    # Group assignment (23)
    23: {'msg_type', 'repeat', 'mmsi', 'spare_1', 'ne_lon', 'ne_lat', 'sw_lon', 'sw_lat',
         'station_type', 'ship_type', 'spare_2', 'txrx', 'interval', 'quiet', 'spare_3'},
    # Class B static (24)
    24: {'msg_type', 'repeat', 'mmsi', 'partno', 'shipname', 'ship_type', 'vendorid',
         'model', 'serial', 'callsign', 'to_bow', 'to_stern', 'to_port', 'to_starboard',
         'mothership_mmsi', 'spare_1'},
    # Binary (25, 26)
    25: {'msg_type', 'repeat', 'mmsi', 'addressed', 'structured', 'dest_mmsi', 'app_id', 'data', 'spare_1'},
    26: {'msg_type', 'repeat', 'mmsi', 'addressed', 'structured', 'dest_mmsi', 'app_id', 'data', 'radio', 'spare_1'},
    # Long range (27)
    27: {'msg_type', 'repeat', 'mmsi', 'accuracy', 'raim', 'status', 'lon', 'lat', 'speed', 'course', 'gnss', 'spare_1'},
}

# Track unknown fields we've seen
unknown_fields_seen = set()


def convert_bytes_to_hex(obj):
    """Recursively convert bytes to hex strings for JSON serialization."""
    if isinstance(obj, bytes):
        return obj.hex()
    elif isinstance(obj, dict):
        return {k: convert_bytes_to_hex(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_bytes_to_hex(item) for item in obj]
    return obj


def decode_nmea_sync(nmea: str, timestamp: str, msg_id: int) -> Optional[dict]:
    """Decode NMEA sentence using AISTracker for state aggregation.

    Uses manual buffering for multi-part message assembly (for broadcasting),
    while also feeding sentences to AISTracker for vessel state aggregation.
    """
    global message_buffer, tracker, unknown_fields_seen

    lines = nmea.strip().split('\n')

    for line in lines:
        line = line.strip()
        if not line.startswith('!AIVDM') and not line.startswith('!AIVDO'):
            continue

        try:
            parts = line.split(',')
            if len(parts) < 7:
                continue

            total_sentences = int(parts[1])
            sentence_num = int(parts[2])
            seq_id = parts[3]
            channel = parts[4]  # A or B channel

            # Buffer for our own decoding (to broadcast complete messages)
            decoded = None
            sentences_for_tracker = []

            if total_sentences == 1:
                # Single sentence - decode directly
                decoded = decode(line)
                sentences_for_tracker = [line]
            else:
                # Multi-sentence - buffer until complete
                # Include channel in key to avoid mixing messages from different channels
                key = (seq_id, channel, total_sentences)
                if key not in message_buffer:
                    message_buffer[key] = {}

                message_buffer[key][sentence_num] = line

                if len(message_buffer[key]) == total_sentences:
                    sentences_for_tracker = [message_buffer[key][i] for i in range(1, total_sentences + 1)]
                    try:
                        decoded = decode(*sentences_for_tracker)
                    except Exception as e:
                        print(f"[MULTIPART DECODE ERROR] {e} for sentences: {sentences_for_tracker}")
                        decoded = None
                    del message_buffer[key]

            # Only feed complete messages to tracker
            if decoded and sentences_for_tracker:
                for sent_line in sentences_for_tracker:
                    try:
                        sentence = AISSentence.from_string(sent_line)
                        tracker.update(sentence)
                    except Exception as e:
                        # Tracker might not support all message types - that's ok
                        pass

            if decoded:
                msg = decoded.asdict()
                # Convert any bytes fields to hex strings for JSON serialization
                msg = convert_bytes_to_hex(msg)
                msg['id'] = msg_id
                msg['timestamp'] = timestamp
                msg['raw_nmea'] = nmea.strip()

                msg_type = msg.get('msg_type')

                # Log multi-part message decoding
                if total_sentences > 1:
                    print(f"[MULTIPART] Decoded {total_sentences}-part message type {msg_type} (MMSI: {msg.get('mmsi')})")

                # Enrich message with tracker's aggregated state
                # This merges static data (Type 5) with position data (Type 1/2/3)
                mmsi = msg.get('mmsi')
                if mmsi:
                    track = tracker.get_track(mmsi)
                    if track:
                        if track.shipname and not msg.get('shipname'):
                            msg['shipname'] = track.shipname
                        if track.callsign and not msg.get('callsign'):
                            msg['callsign'] = track.callsign
                        if track.imo and not msg.get('imo'):
                            msg['imo'] = track.imo
                        if track.ship_type and not msg.get('ship_type'):
                            msg['ship_type'] = track.ship_type
                        if track.destination and not msg.get('destination'):
                            msg['destination'] = track.destination
                        if track.to_bow and not msg.get('to_bow'):
                            msg['to_bow'] = track.to_bow
                        if track.to_stern and not msg.get('to_stern'):
                            msg['to_stern'] = track.to_stern
                        if track.to_port and not msg.get('to_port'):
                            msg['to_port'] = track.to_port
                        if track.to_starboard and not msg.get('to_starboard'):
                            msg['to_starboard'] = track.to_starboard

                # Check for unknown fields
                if msg_type in KNOWN_FIELDS:
                    known = KNOWN_FIELDS[msg_type]
                    for field in msg.keys():
                        if field not in known and field not in ('id', 'timestamp', 'raw_nmea'):
                            field_key = f"type{msg_type}:{field}"
                            if field_key not in unknown_fields_seen:
                                unknown_fields_seen.add(field_key)
                                print(f"[UNKNOWN FIELD] Message type {msg_type} has unexpected field: {field}={msg[field]}")
                else:
                    print(f"[UNKNOWN MSG TYPE] Message type {msg_type} not in known types")

                return msg

        except Exception as e:
            print(f"[DECODE ERROR] {e} for NMEA: {line[:80]}...")

    return None


async def send_history(websocket: WebSocket):
    """Send historical data to newly connected client as a batch"""
    if not DB_PATH.exists():
        return

    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id, timestamp, nmea FROM raw_messages ORDER BY id DESC LIMIT ?",
                (HISTORY_LIMIT,)
            ) as cursor:
                rows = await cursor.fetchall()

        # Clear buffers before processing history to avoid stale state
        global message_buffer, tracker
        message_buffer = {}
        tracker = AISTracker()  # Fresh tracker for history processing

        # Decode all messages first
        decoded_messages = []
        type_counts = {}
        for row in reversed(rows):
            decoded = decode_nmea_sync(row['nmea'], row['timestamp'], row['id'])
            if decoded:
                msg_type = decoded.get('msg_type')
                type_counts[msg_type] = type_counts.get(msg_type, 0) + 1
                decoded_messages.append(decoded)

        # Send as single batch message
        if decoded_messages:
            await websocket.send_text(json.dumps({
                "type": "history_batch",
                "messages": decoded_messages
            }))

        print(f"Sent {len(decoded_messages)}/{len(rows)} historical messages as batch")
        print(f"Message types: {dict(sorted(type_counts.items()))}")

    except Exception as e:
        print(f"Error sending history: {e}")


async def poll_database():
    """Background task to poll database for new messages"""
    global last_id

    # Wait for database to exist
    while not DB_PATH.exists():
        await asyncio.sleep(1)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Get the latest ID to start from
        async with db.execute("SELECT MAX(id) FROM raw_messages") as cursor:
            row = await cursor.fetchone()
            if row and row[0]:
                last_id = row[0]

        print(f"Polling started from id={last_id}")

        while True:
            try:
                async with db.execute(
                    "SELECT id, timestamp, nmea FROM raw_messages WHERE id > ? ORDER BY id",
                    (last_id,)
                ) as cursor:
                    async for row in cursor:
                        msg_id = row['id']
                        timestamp = row['timestamp']
                        nmea = row['nmea']

                        decoded = decode_nmea_sync(nmea, timestamp, msg_id)
                        if decoded:
                            await manager.broadcast(decoded)
                            print(f"Broadcast msg {msg_id}: type={decoded.get('msg_type')} mmsi={decoded.get('mmsi')}")

                        last_id = msg_id

            except Exception as e:
                print(f"Poll error: {e}")

            await asyncio.sleep(POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Start polling task
    poll_task = asyncio.create_task(poll_database())
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


@app.get("/api/vessels")
async def get_vessels():
    """Return all tracked vessels with aggregated state from AISTracker"""
    vessels = []
    for track in tracker.tracks:
        vessel = {
            "mmsi": track.mmsi,
            "shipname": track.shipname,
            "callsign": track.callsign,
            "imo": track.imo,
            "ship_type": track.ship_type,
            "destination": track.destination,
            "lat": track.lat,
            "lon": track.lon,
            "speed": track.speed,
            "course": track.course,
            "heading": track.heading,
            "status": track.status,
            "turn": track.turn,
            "to_bow": track.to_bow,
            "to_stern": track.to_stern,
            "to_port": track.to_port,
            "to_starboard": track.to_starboard,
            "last_updated": track.last_updated,
        }
        # Filter out None values for cleaner response
        vessel = {k: v for k, v in vessel.items() if v is not None}
        vessels.append(vessel)
    return {"vessels": vessels, "count": len(vessels)}


@app.get("/api/vessel/{mmsi}")
async def get_vessel(mmsi: int):
    """Return aggregated state for a specific vessel"""
    track = tracker.get_track(mmsi)
    if not track:
        return {"error": "Vessel not found", "mmsi": mmsi}

    return {
        "mmsi": track.mmsi,
        "shipname": track.shipname,
        "callsign": track.callsign,
        "imo": track.imo,
        "ship_type": track.ship_type,
        "destination": track.destination,
        "lat": track.lat,
        "lon": track.lon,
        "speed": track.speed,
        "course": track.course,
        "heading": track.heading,
        "status": track.status,
        "turn": track.turn,
        "to_bow": track.to_bow,
        "to_stern": track.to_stern,
        "to_port": track.to_port,
        "to_starboard": track.to_starboard,
        "last_updated": track.last_updated,
    }


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
