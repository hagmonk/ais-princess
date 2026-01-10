#!/usr/bin/env python3
"""
AIS Message Decoder Service

Reads raw NMEA messages from the queue (raw_messages table),
decodes them using pyais, and stores in appropriate tables.

Can run continuously or one-shot for backfill.

Usage:
    uv run db/decoder.py                    # Continuous mode
    uv run db/decoder.py --once             # Process pending and exit
    uv run db/decoder.py --batch-size 5000  # Larger batches for backfill
"""

import argparse
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pyais import decode
from pyais.exceptions import InvalidNMEAMessageException

DEFAULT_DB = Path(__file__).parent / "ais-data.db"
DEFAULT_BATCH_SIZE = 1000
DEFAULT_POLL_INTERVAL = 0.5  # seconds

# Message types that contain position data
POSITION_TYPES = {1, 2, 3, 9, 18, 19, 27}

# Message types that contain static vessel data
STATIC_TYPES = {5, 24}

# Base station types
BASE_STATION_TYPES = {4, 11}

# Navigation aid type
NAV_AID_TYPES = {21}


class MultiPartBuffer:
    """Buffer for assembling multi-part AIS messages."""

    def __init__(self, timeout_seconds: float = 60.0):
        self.buffer: dict = {}
        self.timestamps: dict = {}
        self.timeout = timeout_seconds

    def add(self, nmea: str, raw_id: int, timestamp: str) -> Optional[tuple]:
        """
        Add a sentence to the buffer.

        Returns (sentences, raw_ids, timestamp) if message is complete, None otherwise.
        """
        try:
            parts = nmea.split(",")
            if len(parts) < 7:
                return None

            total = int(parts[1])
            seq_num = int(parts[2])
            seq_id = parts[3]
            channel = parts[4]

            if total == 1:
                return ([nmea], [raw_id], timestamp)

            key = (seq_id, channel, total)
            now = time.time()

            # Clean up old incomplete messages
            self._cleanup(now)

            if key not in self.buffer:
                self.buffer[key] = {}
                self.timestamps[key] = now

            self.buffer[key][seq_num] = (nmea, raw_id, timestamp)

            if len(self.buffer[key]) == total:
                sentences = []
                raw_ids = []
                ts = timestamp
                for i in range(1, total + 1):
                    s, rid, t = self.buffer[key][i]
                    sentences.append(s)
                    raw_ids.append(rid)
                del self.buffer[key]
                del self.timestamps[key]
                return (sentences, raw_ids, ts)

            return None

        except (ValueError, IndexError):
            return None

    def _cleanup(self, now: float):
        """Remove incomplete messages older than timeout."""
        expired = [k for k, t in self.timestamps.items() if now - t > self.timeout]
        for k in expired:
            del self.buffer[k]
            del self.timestamps[k]

    def get_incomplete(self) -> list:
        """Get raw_ids of incomplete multi-part messages (for error marking)."""
        result = []
        for key, parts in self.buffer.items():
            for seq_num, (nmea, raw_id, ts) in parts.items():
                result.append(raw_id)
        return result


class AISDecoder:
    """Decodes AIS messages and stores in database."""

    def __init__(self, db_path: Path, batch_size: int = DEFAULT_BATCH_SIZE):
        self.db_path = db_path
        self.batch_size = batch_size
        self.buffer = MultiPartBuffer()
        self.stats = defaultdict(int)

    def process_batch(self) -> int:
        """
        Process a batch of pending messages.

        Returns number of messages processed.
        """
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row

        # Get pending messages
        cursor = conn.execute(
            """
            SELECT id, timestamp, nmea
            FROM raw_messages
            WHERE decoded = 0
            ORDER BY id
            LIMIT ?
            """,
            (self.batch_size,),
        )
        rows = cursor.fetchall()

        if not rows:
            conn.close()
            return 0

        processed = 0
        for row in rows:
            raw_id = row["id"]
            timestamp = row["timestamp"]
            nmea = row["nmea"]

            result = self.buffer.add(nmea, raw_id, timestamp)

            if result is None:
                # Part of multi-part message, not complete yet
                # Mark as processed so we don't re-fetch, will be handled when complete
                conn.execute(
                    "UPDATE raw_messages SET decoded = 2 WHERE id = ?",
                    (raw_id,),
                )
                continue

            sentences, raw_ids, ts = result
            success, error = self._decode_and_store(conn, sentences, raw_ids, ts)

            # Mark all parts as decoded
            for rid in raw_ids:
                if success:
                    conn.execute(
                        "UPDATE raw_messages SET decoded = 1 WHERE id = ?",
                        (rid,),
                    )
                else:
                    conn.execute(
                        "UPDATE raw_messages SET decoded = -1, decode_error = ? WHERE id = ?",
                        (error, rid),
                    )

            processed += len(raw_ids)

        # Handle incomplete multi-part messages that timed out
        incomplete = self.buffer.get_incomplete()
        for rid in incomplete:
            conn.execute(
                "UPDATE raw_messages SET decoded = -1, decode_error = ? WHERE id = ?",
                ("Incomplete multi-part message (timeout)", rid),
            )
            self.stats["incomplete"] += 1

        conn.commit()
        conn.close()

        return processed

    def _decode_and_store(
        self, conn: sqlite3.Connection, sentences: list, raw_ids: list, timestamp: str
    ) -> tuple[bool, Optional[str]]:
        """Decode sentences and store in appropriate table."""
        try:
            if len(sentences) == 1:
                msg = decode(sentences[0])
            else:
                msg = decode(*sentences)

            data = msg.asdict()
            msg_type = data.get("msg_type")
            mmsi = data.get("mmsi")

            if msg_type is None or mmsi is None:
                return False, "Missing msg_type or mmsi"

            self.stats[f"type_{msg_type}"] += 1

            # Route to appropriate table
            if msg_type in POSITION_TYPES:
                self._store_position(conn, raw_ids[0], timestamp, data)
            elif msg_type in STATIC_TYPES:
                self._store_vessel(conn, timestamp, data)
            elif msg_type in BASE_STATION_TYPES:
                self._store_base_station(conn, raw_ids[0], timestamp, data)
            elif msg_type in NAV_AID_TYPES:
                self._store_nav_aid(conn, raw_ids[0], timestamp, data)
            else:
                # Other message types - just mark as decoded, no storage
                self.stats["other"] += 1

            return True, None

        except InvalidNMEAMessageException as e:
            self.stats["invalid_nmea"] += 1
            return False, f"Invalid NMEA: {e}"
        except Exception as e:
            self.stats["decode_error"] += 1
            return False, f"Decode error: {e}"

    def _store_position(
        self, conn: sqlite3.Connection, raw_id: int, timestamp: str, data: dict
    ):
        """Store position report."""
        # Skip if no valid position
        lat = data.get("lat")
        lon = data.get("lon")
        if lat is None or lon is None:
            return
        if lat == 91.0 or lon == 181.0:  # AIS "not available" values
            return

        conn.execute(
            """
            INSERT INTO positions (
                raw_message_id, timestamp, mmsi, msg_type,
                lat, lon, speed, course, heading, nav_status, turn, accuracy, raim
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                raw_id,
                timestamp,
                data.get("mmsi"),
                data.get("msg_type"),
                lat,
                lon,
                data.get("speed"),
                data.get("course"),
                data.get("heading"),
                data.get("status"),
                data.get("turn"),
                data.get("accuracy"),
                data.get("raim"),
            ),
        )
        self.stats["positions"] += 1

    def _store_vessel(self, conn: sqlite3.Connection, timestamp: str, data: dict):
        """Store or update vessel static data."""
        mmsi = data.get("mmsi")

        # Type 24 has two parts (A and B)
        partno = data.get("partno")

        if partno == 0:  # Part A - ship name
            conn.execute(
                """
                INSERT INTO vessels (mmsi, shipname, first_seen, last_seen, static_count)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(mmsi) DO UPDATE SET
                    shipname = COALESCE(excluded.shipname, shipname),
                    last_seen = excluded.last_seen,
                    static_count = static_count + 1
                """,
                (mmsi, data.get("shipname"), timestamp, timestamp),
            )
        elif partno == 1:  # Part B - callsign, dimensions, ship type
            conn.execute(
                """
                INSERT INTO vessels (
                    mmsi, callsign, ship_type,
                    to_bow, to_stern, to_port, to_starboard,
                    first_seen, last_seen, static_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(mmsi) DO UPDATE SET
                    callsign = COALESCE(excluded.callsign, callsign),
                    ship_type = COALESCE(excluded.ship_type, ship_type),
                    to_bow = COALESCE(excluded.to_bow, to_bow),
                    to_stern = COALESCE(excluded.to_stern, to_stern),
                    to_port = COALESCE(excluded.to_port, to_port),
                    to_starboard = COALESCE(excluded.to_starboard, to_starboard),
                    last_seen = excluded.last_seen,
                    static_count = static_count + 1
                """,
                (
                    mmsi,
                    data.get("callsign"),
                    data.get("ship_type"),
                    data.get("to_bow"),
                    data.get("to_stern"),
                    data.get("to_port"),
                    data.get("to_starboard"),
                    timestamp,
                    timestamp,
                ),
            )
        else:  # Type 5 - full static data
            conn.execute(
                """
                INSERT INTO vessels (
                    mmsi, shipname, callsign, imo, ship_type, destination,
                    eta_month, eta_day, eta_hour, eta_minute, draught,
                    to_bow, to_stern, to_port, to_starboard,
                    ais_version, epfd, first_seen, last_seen, static_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(mmsi) DO UPDATE SET
                    shipname = COALESCE(excluded.shipname, shipname),
                    callsign = COALESCE(excluded.callsign, callsign),
                    imo = COALESCE(excluded.imo, imo),
                    ship_type = COALESCE(excluded.ship_type, ship_type),
                    destination = COALESCE(excluded.destination, destination),
                    eta_month = COALESCE(excluded.eta_month, eta_month),
                    eta_day = COALESCE(excluded.eta_day, eta_day),
                    eta_hour = COALESCE(excluded.eta_hour, eta_hour),
                    eta_minute = COALESCE(excluded.eta_minute, eta_minute),
                    draught = COALESCE(excluded.draught, draught),
                    to_bow = COALESCE(excluded.to_bow, to_bow),
                    to_stern = COALESCE(excluded.to_stern, to_stern),
                    to_port = COALESCE(excluded.to_port, to_port),
                    to_starboard = COALESCE(excluded.to_starboard, to_starboard),
                    ais_version = COALESCE(excluded.ais_version, ais_version),
                    epfd = COALESCE(excluded.epfd, epfd),
                    last_seen = excluded.last_seen,
                    static_count = static_count + 1
                """,
                (
                    mmsi,
                    data.get("shipname"),
                    data.get("callsign"),
                    data.get("imo"),
                    data.get("ship_type"),
                    data.get("destination"),
                    data.get("month"),
                    data.get("day"),
                    data.get("hour"),
                    data.get("minute"),
                    data.get("draught"),
                    data.get("to_bow"),
                    data.get("to_stern"),
                    data.get("to_port"),
                    data.get("to_starboard"),
                    data.get("ais_version"),
                    data.get("epfd"),
                    timestamp,
                    timestamp,
                ),
            )

        self.stats["vessels"] += 1

    def _store_base_station(
        self, conn: sqlite3.Connection, raw_id: int, timestamp: str, data: dict
    ):
        """Store base station report."""
        lat = data.get("lat")
        lon = data.get("lon")
        if lat is None or lon is None:
            return
        if lat == 91.0 or lon == 181.0:
            return

        conn.execute(
            """
            INSERT INTO base_stations (
                raw_message_id, timestamp, mmsi, lat, lon, accuracy, epfd
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                raw_id,
                timestamp,
                data.get("mmsi"),
                lat,
                lon,
                data.get("accuracy"),
                data.get("epfd"),
            ),
        )
        self.stats["base_stations"] += 1

    def _store_nav_aid(
        self, conn: sqlite3.Connection, raw_id: int, timestamp: str, data: dict
    ):
        """Store navigation aid report."""
        lat = data.get("lat")
        lon = data.get("lon")
        if lat is None or lon is None:
            return
        if lat == 91.0 or lon == 181.0:
            return

        conn.execute(
            """
            INSERT INTO nav_aids (
                raw_message_id, timestamp, mmsi, aid_type, name,
                lat, lon, accuracy,
                to_bow, to_stern, to_port, to_starboard, virtual_aid
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                raw_id,
                timestamp,
                data.get("mmsi"),
                data.get("aid_type"),
                data.get("name"),
                lat,
                lon,
                data.get("accuracy"),
                data.get("to_bow"),
                data.get("to_stern"),
                data.get("to_port"),
                data.get("to_starboard"),
                data.get("virtual_aid"),
            ),
        )
        self.stats["nav_aids"] += 1

    def print_stats(self):
        """Print decoding statistics."""
        print("\nDecoding statistics:")
        for key, value in sorted(self.stats.items()):
            print(f"  {key}: {value}")


def run_continuous(decoder: AISDecoder, poll_interval: float):
    """Run decoder continuously."""
    print(f"Starting continuous decoder (poll interval: {poll_interval}s)")
    print("Press Ctrl+C to stop\n")

    total = 0
    try:
        while True:
            processed = decoder.process_batch()
            if processed > 0:
                total += processed
                print(f"Processed {processed} messages (total: {total})")
            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\nStopping...")

    decoder.print_stats()
    print(f"\nTotal processed: {total}")


def run_once(decoder: AISDecoder):
    """Process all pending messages and exit."""
    print("Processing all pending messages...")

    total = 0
    start = time.time()

    while True:
        processed = decoder.process_batch()
        if processed == 0:
            break
        total += processed
        elapsed = time.time() - start
        rate = total / elapsed if elapsed > 0 else 0
        print(f"Processed {total} messages ({rate:.0f}/sec)")

    elapsed = time.time() - start
    decoder.print_stats()
    print(f"\nTotal: {total} messages in {elapsed:.1f}s ({total/elapsed:.0f}/sec)")

    # Print summary
    conn = sqlite3.connect(str(decoder.db_path))
    print("\nDatabase summary:")
    for table in ["positions", "vessels", "base_stations", "nav_aids", "latest_positions"]:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {count}")

    errors = conn.execute(
        "SELECT COUNT(*) FROM raw_messages WHERE decoded = -1"
    ).fetchone()[0]
    pending = conn.execute(
        "SELECT COUNT(*) FROM raw_messages WHERE decoded = 0"
    ).fetchone()[0]
    print(f"  decode errors: {errors}")
    print(f"  still pending: {pending}")
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="AIS message decoder service")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Database path")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Messages per batch",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=DEFAULT_POLL_INTERVAL,
        help="Poll interval in seconds (continuous mode)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process pending and exit (backfill mode)",
    )
    args = parser.parse_args()

    if not args.db.exists():
        print(f"Error: Database not found: {args.db}")
        return 1

    decoder = AISDecoder(args.db, args.batch_size)

    if args.once:
        run_once(decoder)
    else:
        run_continuous(decoder, args.poll_interval)

    return 0


if __name__ == "__main__":
    exit(main())
