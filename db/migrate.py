#!/usr/bin/env python3
"""
AIS Database Schema Migration

Creates tables, indexes, and triggers for decoded AIS data.
Safe to run multiple times (idempotent).

Usage:
    uv run db/migrate.py [--db path/to/ais-data.db]
"""

import argparse
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).parent / "ais-data.db"


def _needs_recreation(conn: sqlite3.Connection) -> bool:
    """Check if decoded tables need to be recreated due to schema mismatch."""
    # Check positions table for required columns
    cursor = conn.execute("PRAGMA table_info(positions)")
    pos_columns = {row[1] for row in cursor.fetchall()}
    if pos_columns and "accuracy" not in pos_columns:
        return True

    # Check vessels table for required columns
    cursor = conn.execute("PRAGMA table_info(vessels)")
    vessel_columns = {row[1] for row in cursor.fetchall()}
    if vessel_columns and "shipname" not in vessel_columns:
        return True

    # Check latest_positions for draught column
    cursor = conn.execute("PRAGMA table_info(latest_positions)")
    lp_columns = {row[1] for row in cursor.fetchall()}
    if lp_columns and "draught" not in lp_columns:
        return True

    return False


def _drop_decoded_tables(conn: sqlite3.Connection):
    """Drop and reset decoded data tables."""
    # Drop triggers first
    conn.execute("DROP TRIGGER IF EXISTS update_latest_position")
    conn.execute("DROP TRIGGER IF EXISTS update_latest_vessel_insert")
    conn.execute("DROP TRIGGER IF EXISTS update_latest_vessel_update")
    conn.execute("DROP TRIGGER IF EXISTS update_vessel_position_count")

    # Drop tables
    conn.execute("DROP TABLE IF EXISTS latest_positions")
    conn.execute("DROP TABLE IF EXISTS positions")
    conn.execute("DROP TABLE IF EXISTS vessels")
    conn.execute("DROP TABLE IF EXISTS base_stations")
    conn.execute("DROP TABLE IF EXISTS nav_aids")

    # Reset decoded status so messages get reprocessed
    conn.execute("UPDATE raw_messages SET decoded = 0, decode_error = NULL")
    conn.commit()


def migrate(db_path: Path, force_recreate: bool = False):
    """Run all migrations."""
    print(f"Migrating database: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    # Get existing columns in raw_messages
    cursor = conn.execute("PRAGMA table_info(raw_messages)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    # Add decoded column if missing
    if "decoded" not in existing_columns:
        print("  Adding 'decoded' column to raw_messages...")
        conn.execute("ALTER TABLE raw_messages ADD COLUMN decoded INTEGER DEFAULT 0")

    # Add decode_error column if missing
    if "decode_error" not in existing_columns:
        print("  Adding 'decode_error' column to raw_messages...")
        conn.execute("ALTER TABLE raw_messages ADD COLUMN decode_error TEXT")

    # Create index for pending messages
    print("  Creating indexes...")
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_raw_pending
        ON raw_messages(decoded, id)
    """)

    # Check if tables need recreation (schema mismatch)
    if force_recreate or _needs_recreation(conn):
        print("  Recreating decoded data tables (schema update)...")
        _drop_decoded_tables(conn)

    # Positions table - all position reports
    print("  Creating positions table...")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_message_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            mmsi INTEGER NOT NULL,
            msg_type INTEGER NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            speed REAL,
            course REAL,
            heading INTEGER,
            nav_status INTEGER,
            turn REAL,
            accuracy INTEGER,
            raim INTEGER,
            FOREIGN KEY (raw_message_id) REFERENCES raw_messages(id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_mmsi ON positions(mmsi)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_timestamp ON positions(timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_mmsi_ts ON positions(mmsi, timestamp DESC)")

    # Vessels table - static data from Type 5, 24
    print("  Creating vessels table...")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS vessels (
            mmsi INTEGER PRIMARY KEY,
            shipname TEXT,
            callsign TEXT,
            imo INTEGER,
            ship_type INTEGER,
            destination TEXT,
            eta_month INTEGER,
            eta_day INTEGER,
            eta_hour INTEGER,
            eta_minute INTEGER,
            draught REAL,
            to_bow INTEGER,
            to_stern INTEGER,
            to_port INTEGER,
            to_starboard INTEGER,
            ais_version INTEGER,
            epfd INTEGER,
            first_seen TEXT,
            last_seen TEXT,
            position_count INTEGER DEFAULT 0,
            static_count INTEGER DEFAULT 0
        )
    """)

    # Base stations table - Type 4, 11
    print("  Creating base_stations table...")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS base_stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_message_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            mmsi INTEGER NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            accuracy INTEGER,
            epfd INTEGER,
            FOREIGN KEY (raw_message_id) REFERENCES raw_messages(id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_base_mmsi ON base_stations(mmsi)")

    # Navigation aids table - Type 21
    print("  Creating nav_aids table...")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS nav_aids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_message_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            mmsi INTEGER NOT NULL,
            aid_type INTEGER,
            name TEXT,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            accuracy INTEGER,
            to_bow INTEGER,
            to_stern INTEGER,
            to_port INTEGER,
            to_starboard INTEGER,
            virtual_aid INTEGER,
            FOREIGN KEY (raw_message_id) REFERENCES raw_messages(id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nav_aids_mmsi ON nav_aids(mmsi)")

    # Latest positions table - trigger-maintained for fast UI loads
    print("  Creating latest_positions table...")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS latest_positions (
            mmsi INTEGER PRIMARY KEY,
            raw_message_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            msg_type INTEGER NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            speed REAL,
            course REAL,
            heading INTEGER,
            nav_status INTEGER,
            shipname TEXT,
            callsign TEXT,
            imo INTEGER,
            ship_type INTEGER,
            destination TEXT,
            draught REAL,
            eta_month INTEGER,
            eta_day INTEGER,
            eta_hour INTEGER,
            eta_minute INTEGER,
            to_bow INTEGER,
            to_stern INTEGER,
            to_port INTEGER,
            to_starboard INTEGER,
            FOREIGN KEY (raw_message_id) REFERENCES raw_messages(id)
        )
    """)

    # Create triggers
    print("  Creating triggers...")

    # Drop existing triggers first (to allow updates)
    conn.execute("DROP TRIGGER IF EXISTS update_latest_position")
    conn.execute("DROP TRIGGER IF EXISTS update_latest_vessel_insert")
    conn.execute("DROP TRIGGER IF EXISTS update_latest_vessel_update")
    conn.execute("DROP TRIGGER IF EXISTS update_vessel_position_count")

    # Trigger: Update latest_positions when new position inserted
    conn.execute("""
        CREATE TRIGGER update_latest_position
        AFTER INSERT ON positions
        BEGIN
            INSERT INTO latest_positions (
                mmsi, raw_message_id, timestamp, msg_type, lat, lon,
                speed, course, heading, nav_status,
                shipname, callsign, imo, ship_type, destination,
                draught, eta_month, eta_day, eta_hour, eta_minute,
                to_bow, to_stern, to_port, to_starboard
            )
            SELECT
                NEW.mmsi, NEW.raw_message_id, NEW.timestamp, NEW.msg_type,
                NEW.lat, NEW.lon, NEW.speed, NEW.course, NEW.heading, NEW.nav_status,
                v.shipname, v.callsign, v.imo, v.ship_type, v.destination,
                v.draught, v.eta_month, v.eta_day, v.eta_hour, v.eta_minute,
                v.to_bow, v.to_stern, v.to_port, v.to_starboard
            FROM (SELECT 1) AS dummy
            LEFT JOIN vessels v ON v.mmsi = NEW.mmsi
            ON CONFLICT(mmsi) DO UPDATE SET
                raw_message_id = excluded.raw_message_id,
                timestamp = excluded.timestamp,
                msg_type = excluded.msg_type,
                lat = excluded.lat,
                lon = excluded.lon,
                speed = excluded.speed,
                course = excluded.course,
                heading = excluded.heading,
                nav_status = excluded.nav_status,
                shipname = COALESCE(excluded.shipname, latest_positions.shipname),
                callsign = COALESCE(excluded.callsign, latest_positions.callsign),
                imo = COALESCE(excluded.imo, latest_positions.imo),
                ship_type = COALESCE(excluded.ship_type, latest_positions.ship_type),
                destination = COALESCE(excluded.destination, latest_positions.destination),
                draught = COALESCE(excluded.draught, latest_positions.draught),
                eta_month = COALESCE(excluded.eta_month, latest_positions.eta_month),
                eta_day = COALESCE(excluded.eta_day, latest_positions.eta_day),
                eta_hour = COALESCE(excluded.eta_hour, latest_positions.eta_hour),
                eta_minute = COALESCE(excluded.eta_minute, latest_positions.eta_minute),
                to_bow = COALESCE(excluded.to_bow, latest_positions.to_bow),
                to_stern = COALESCE(excluded.to_stern, latest_positions.to_stern),
                to_port = COALESCE(excluded.to_port, latest_positions.to_port),
                to_starboard = COALESCE(excluded.to_starboard, latest_positions.to_starboard);
        END
    """)

    # Trigger: Update latest_positions when vessel static data inserted
    conn.execute("""
        CREATE TRIGGER update_latest_vessel_insert
        AFTER INSERT ON vessels
        BEGIN
            UPDATE latest_positions SET
                shipname = COALESCE(NEW.shipname, shipname),
                callsign = COALESCE(NEW.callsign, callsign),
                imo = COALESCE(NEW.imo, imo),
                ship_type = COALESCE(NEW.ship_type, ship_type),
                destination = COALESCE(NEW.destination, destination),
                draught = COALESCE(NEW.draught, draught),
                eta_month = COALESCE(NEW.eta_month, eta_month),
                eta_day = COALESCE(NEW.eta_day, eta_day),
                eta_hour = COALESCE(NEW.eta_hour, eta_hour),
                eta_minute = COALESCE(NEW.eta_minute, eta_minute),
                to_bow = COALESCE(NEW.to_bow, to_bow),
                to_stern = COALESCE(NEW.to_stern, to_stern),
                to_port = COALESCE(NEW.to_port, to_port),
                to_starboard = COALESCE(NEW.to_starboard, to_starboard)
            WHERE mmsi = NEW.mmsi;
        END
    """)

    # Trigger: Update latest_positions when vessel static data updated
    conn.execute("""
        CREATE TRIGGER update_latest_vessel_update
        AFTER UPDATE ON vessels
        BEGIN
            UPDATE latest_positions SET
                shipname = COALESCE(NEW.shipname, shipname),
                callsign = COALESCE(NEW.callsign, callsign),
                imo = COALESCE(NEW.imo, imo),
                ship_type = COALESCE(NEW.ship_type, ship_type),
                destination = COALESCE(NEW.destination, destination),
                draught = COALESCE(NEW.draught, draught),
                eta_month = COALESCE(NEW.eta_month, eta_month),
                eta_day = COALESCE(NEW.eta_day, eta_day),
                eta_hour = COALESCE(NEW.eta_hour, eta_hour),
                eta_minute = COALESCE(NEW.eta_minute, eta_minute),
                to_bow = COALESCE(NEW.to_bow, to_bow),
                to_stern = COALESCE(NEW.to_stern, to_stern),
                to_port = COALESCE(NEW.to_port, to_port),
                to_starboard = COALESCE(NEW.to_starboard, to_starboard)
            WHERE mmsi = NEW.mmsi;
        END
    """)

    # Trigger: Update vessel position count
    conn.execute("""
        CREATE TRIGGER update_vessel_position_count
        AFTER INSERT ON positions
        BEGIN
            INSERT INTO vessels (mmsi, first_seen, last_seen, position_count)
            VALUES (NEW.mmsi, NEW.timestamp, NEW.timestamp, 1)
            ON CONFLICT(mmsi) DO UPDATE SET
                last_seen = NEW.timestamp,
                position_count = position_count + 1;
        END
    """)

    conn.commit()
    conn.close()

    print("Migration complete!")

    # Print summary
    conn = sqlite3.connect(str(db_path))
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    print(f"\nTables: {', '.join(t[0] for t in tables)}")

    triggers = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
    ).fetchall()
    print(f"Triggers: {', '.join(t[0] for t in triggers)}")

    raw_count = conn.execute("SELECT COUNT(*) FROM raw_messages").fetchone()[0]
    pending = conn.execute("SELECT COUNT(*) FROM raw_messages WHERE decoded = 0").fetchone()[0]
    print(f"\nraw_messages: {raw_count} total, {pending} pending decode")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description="AIS database migration")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Database path")
    parser.add_argument(
        "--force-recreate",
        action="store_true",
        help="Force recreation of decoded tables (resets decode status)",
    )
    args = parser.parse_args()

    if not args.db.exists():
        print(f"Error: Database not found: {args.db}")
        return 1

    migrate(args.db, args.force_recreate)
    return 0


if __name__ == "__main__":
    exit(main())
