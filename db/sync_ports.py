#!/usr/bin/env python3
"""
Port Database Sync Tool

Downloads and imports location data from:
1. NGA World Port Index (primary - 3,818 seaports)
2. UN/LOCODE (fallback - 82,000 trade locations)
3. IATA Airports (fallback - ~10,000 airports for codes like USLIH)

Idempotent - safe to run multiple times. Recreates tables on each run.

Usage:
    uv run db/sync_ports.py [--db path/to/ais-data.db]
"""

# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "httpx",
# ]
# ///

import argparse
import csv
import io
import re
import sqlite3
import zipfile
from pathlib import Path

import httpx

DEFAULT_DB = Path(__file__).parent / "ais-data.db"

# NGA World Port Index - authoritative maritime port data
NGA_WPI_URL = "https://msi.nga.mil/api/publications/download?type=view&key=16920959/SFH00000/UpdatedPub150.csv"

# UN/LOCODE - broader location coverage (ports, rail, airports, etc)
# Using the packaged CSV from datasets/un-locode on GitHub
UNLOCODE_URL = "https://github.com/datasets/un-locode/raw/main/data/code-list.csv"

# IATA Airport codes - covers destinations like "USLIH" (Lihue Airport)
# Using the datasets/airport-codes repo on GitHub
AIRPORTS_URL = "https://raw.githubusercontent.com/datasets/airport-codes/main/data/airport-codes.csv"


def create_ports_table(conn: sqlite3.Connection):
    """Create or recreate the ports table."""
    print("Creating ports table...")

    conn.execute("DROP TABLE IF EXISTS ports")
    conn.execute("""
        CREATE TABLE ports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            locode TEXT UNIQUE,          -- UN/LOCODE (e.g., "USLAX")
            name TEXT NOT NULL,          -- Port name
            name_ascii TEXT,             -- Name without diacritics
            country TEXT NOT NULL,       -- ISO 3166-1 alpha-2 country code
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            wpi_index TEXT,              -- NGA WPI index number (if from WPI)
            source TEXT NOT NULL,        -- 'wpi' or 'locode'
            function TEXT,               -- UN/LOCODE function codes
            region TEXT,                 -- State/province/region
            water_body TEXT,             -- Ocean/sea (WPI only)
            harbor_size TEXT,            -- Harbor size (WPI only)
            harbor_type TEXT             -- Harbor type (WPI only)
        )
    """)

    # Indexes for fast lookups
    conn.execute("CREATE INDEX idx_ports_locode ON ports(locode)")
    conn.execute("CREATE INDEX idx_ports_name ON ports(name)")
    conn.execute("CREATE INDEX idx_ports_name_ascii ON ports(name_ascii)")
    conn.execute("CREATE INDEX idx_ports_country ON ports(country)")
    conn.execute("CREATE INDEX idx_ports_coords ON ports(lat, lon)")

    conn.commit()


def download_file(url: str, description: str) -> bytes:
    """Download a file with progress indication."""
    print(f"Downloading {description}...")
    print(f"  URL: {url}")

    with httpx.Client(follow_redirects=True, timeout=60.0) as client:
        response = client.get(url)
        response.raise_for_status()

    size_mb = len(response.content) / 1024 / 1024
    print(f"  Downloaded {size_mb:.1f} MB")
    return response.content


def parse_wpi_coordinates(lat_str: str, lon_str: str) -> tuple[float | None, float | None]:
    """Parse WPI coordinate format (decimal degrees as string)."""
    try:
        lat = float(lat_str) if lat_str else None
        lon = float(lon_str) if lon_str else None
        return lat, lon
    except (ValueError, TypeError):
        return None, None


def import_wpi(conn: sqlite3.Connection, csv_data: bytes) -> int:
    """Import NGA World Port Index data."""
    print("\nImporting NGA World Port Index...")

    # Decode and parse CSV
    text = csv_data.decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text))

    # Normalize column names (WPI CSV has varying formats)
    imported = 0
    skipped = 0

    for row in reader:
        # Extract fields (handle varying column names)
        name = row.get('Main Port Name') or row.get('PORT_NAME') or row.get('port_name', '')
        country = row.get('Country Code') or row.get('COUNTRY_CODE') or row.get('country_code', '')
        lat_str = row.get('Latitude') or row.get('LATITUDE') or row.get('latitude', '')
        lon_str = row.get('Longitude') or row.get('LONGITUDE') or row.get('longitude', '')
        locode = row.get('UN/LOCODE') or row.get('LOCODE') or row.get('locode', '')
        wpi_index = row.get('World Port Index Number') or row.get('INDEX_NO') or row.get('index_no', '')
        region = row.get('Region Name') or row.get('REGION_NAME') or ''
        water_body = row.get('World Water Body') or row.get('WATER_BODY') or ''
        harbor_size = row.get('Harbor Size') or row.get('HARBOR_SIZE') or ''
        harbor_type = row.get('Harbor Type') or row.get('HARBOR_TYPE') or ''

        lat, lon = parse_wpi_coordinates(lat_str, lon_str)

        # Skip entries without valid coordinates
        if lat is None or lon is None:
            skipped += 1
            continue

        # Skip invalid coordinates
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped += 1
            continue

        # Clean up locode format (remove spaces, ensure uppercase)
        if locode:
            locode = locode.replace(' ', '').upper()

        # Create ASCII name for searching
        name_ascii = name.encode('ascii', 'ignore').decode('ascii')

        try:
            conn.execute("""
                INSERT INTO ports (locode, name, name_ascii, country, lat, lon,
                                   wpi_index, source, region, water_body,
                                   harbor_size, harbor_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'wpi', ?, ?, ?, ?)
                ON CONFLICT(locode) DO UPDATE SET
                    name = excluded.name,
                    name_ascii = excluded.name_ascii,
                    lat = excluded.lat,
                    lon = excluded.lon,
                    wpi_index = excluded.wpi_index,
                    source = 'wpi',
                    region = excluded.region,
                    water_body = excluded.water_body,
                    harbor_size = excluded.harbor_size,
                    harbor_type = excluded.harbor_type
            """, (
                locode or None, name, name_ascii, country, lat, lon,
                wpi_index or None, region or None, water_body or None,
                harbor_size or None, harbor_type or None
            ))
            imported += 1
        except sqlite3.IntegrityError as e:
            # Handle ports without locode (need to generate unique key)
            if not locode:
                # Generate pseudo-locode from country + first 3 chars of name
                pseudo = f"{country}{name[:3].upper()}".replace(' ', '')
                try:
                    conn.execute("""
                        INSERT INTO ports (locode, name, name_ascii, country, lat, lon,
                                           wpi_index, source, region, water_body,
                                           harbor_size, harbor_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'wpi', ?, ?, ?, ?)
                    """, (
                        pseudo, name, name_ascii, country, lat, lon,
                        wpi_index or None, region or None, water_body or None,
                        harbor_size or None, harbor_type or None
                    ))
                    imported += 1
                except sqlite3.IntegrityError:
                    skipped += 1
            else:
                skipped += 1

    conn.commit()
    print(f"  Imported {imported} ports from WPI ({skipped} skipped)")
    return imported


def parse_locode_coordinates(coord_str: str) -> tuple[float | None, float | None]:
    """Parse UN/LOCODE coordinate format (e.g., '5231N 01323E')."""
    if not coord_str:
        return None, None

    # Format: DDMMN/S DDDMME/W or similar
    # Can also be decimal degrees in some cases
    match = re.match(
        r'(\d{2,4})([NS])\s*(\d{2,5})([EW])',
        coord_str.strip()
    )

    if match:
        lat_deg = match.group(1)
        lat_dir = match.group(2)
        lon_deg = match.group(3)
        lon_dir = match.group(4)

        # Convert DDMM to decimal degrees
        if len(lat_deg) == 4:
            lat = int(lat_deg[:2]) + int(lat_deg[2:]) / 60
        elif len(lat_deg) == 2:
            lat = int(lat_deg)
        else:
            return None, None

        if len(lon_deg) == 5:
            lon = int(lon_deg[:3]) + int(lon_deg[3:]) / 60
        elif len(lon_deg) == 4:
            lon = int(lon_deg[:2]) + int(lon_deg[2:]) / 60
        elif len(lon_deg) == 3:
            lon = int(lon_deg)
        else:
            return None, None

        if lat_dir == 'S':
            lat = -lat
        if lon_dir == 'W':
            lon = -lon

        return lat, lon

    return None, None


def import_locode(conn: sqlite3.Connection, csv_data: bytes) -> int:
    """Import UN/LOCODE data (as fallback for ports not in WPI)."""
    print("\nImporting UN/LOCODE (seaports only)...")

    # Decode and parse CSV
    text = csv_data.decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text))

    imported = 0
    skipped = 0

    for row in reader:
        # Extract fields
        country = row.get('Country', '')
        location = row.get('Location', '')
        name = row.get('Name', '')
        name_ascii = row.get('NameWoDiacritics', '') or name
        subdivision = row.get('Subdivision', '')
        function = row.get('Function', '')
        coordinates = row.get('Coordinates', '')

        # Only import seaports (function code contains '1')
        # Function codes: 1=port, 2=rail, 3=road, 4=airport, 5=postal, 6=multimodal, 7=fixed transport, B=border crossing
        if '1' not in function:
            skipped += 1
            continue

        # Build locode
        locode = f"{country}{location}".upper()

        # Parse coordinates
        lat, lon = parse_locode_coordinates(coordinates)

        # Skip entries without valid coordinates
        if lat is None or lon is None:
            skipped += 1
            continue

        # Skip invalid coordinates
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped += 1
            continue

        # Only insert if not already in database (WPI takes priority)
        try:
            conn.execute("""
                INSERT INTO ports (locode, name, name_ascii, country, lat, lon,
                                   source, function, region)
                VALUES (?, ?, ?, ?, ?, ?, 'locode', ?, ?)
                ON CONFLICT(locode) DO NOTHING
            """, (
                locode, name, name_ascii, country, lat, lon,
                function, subdivision or None
            ))
            if conn.total_changes > 0:
                imported += 1
        except sqlite3.IntegrityError:
            skipped += 1

    conn.commit()
    print(f"  Imported {imported} additional ports from UN/LOCODE ({skipped} skipped/duplicates)")
    return imported


def import_airports(conn: sqlite3.Connection, csv_data: bytes) -> int:
    """Import IATA airports into ports table for unified destination resolution.

    Airports are inserted with locode = country + iata_code (e.g., "USLIH").
    ON CONFLICT DO NOTHING ensures ports take priority over airports.
    """
    print("\nImporting IATA airports (as fallback locations)...")

    text = csv_data.decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text))

    imported = 0
    skipped = 0

    for row in reader:
        iata = row.get('iata_code', '').strip().upper()
        name = row.get('name', '').strip()
        city = row.get('municipality', '').strip()
        country = row.get('iso_country', '').strip().upper()
        coordinates = row.get('coordinates', '')
        airport_type = row.get('type', '').strip()

        # Skip entries without IATA code
        if not iata or len(iata) != 3:
            skipped += 1
            continue

        # Skip closed airports and heliports
        if airport_type in ('closed', 'heliport'):
            skipped += 1
            continue

        # Parse coordinates (format: "lat, lon")
        try:
            if ',' in coordinates:
                lat_str, lon_str = coordinates.split(',')
                lat = float(lat_str.strip())
                lon = float(lon_str.strip())
            else:
                lat, lon = None, None
        except ValueError:
            lat, lon = None, None

        if lat is None or lon is None:
            skipped += 1
            continue

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped += 1
            continue

        # Generate locode as country + IATA (e.g., "USLIH")
        locode = f"{country}{iata}"

        # Use city name if available, otherwise airport name
        display_name = city if city else name.replace(' Airport', '').replace(' International', '')
        name_ascii = display_name.encode('ascii', 'ignore').decode('ascii')

        try:
            # Insert into ports table - ON CONFLICT DO NOTHING so ports take priority
            conn.execute("""
                INSERT INTO ports (locode, name, name_ascii, country, lat, lon, source)
                VALUES (?, ?, ?, ?, ?, ?, 'iata')
                ON CONFLICT(locode) DO NOTHING
            """, (locode, display_name, name_ascii, country, lat, lon))

            if conn.total_changes > 0:
                imported += 1
        except sqlite3.IntegrityError:
            skipped += 1

    conn.commit()
    print(f"  Imported {imported} airports into ports table ({skipped} skipped/duplicates)")
    return imported


def sync_ports(db_path: Path):
    """Main sync function."""
    print(f"Port database sync")
    print(f"Database: {db_path}")
    print("=" * 60)

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")

    # Create fresh ports table
    create_ports_table(conn)

    # Download and import WPI
    try:
        wpi_data = download_file(NGA_WPI_URL, "NGA World Port Index")
        wpi_count = import_wpi(conn, wpi_data)
    except Exception as e:
        print(f"  WARNING: Failed to download WPI: {e}")
        wpi_count = 0

    # Download and import UN/LOCODE
    try:
        locode_data = download_file(UNLOCODE_URL, "UN/LOCODE")
        locode_count = import_locode(conn, locode_data)
    except Exception as e:
        print(f"  WARNING: Failed to download UN/LOCODE: {e}")
        locode_count = 0

    # Download and import IATA airports (fallback for codes like USLIH)
    try:
        airports_data = download_file(AIRPORTS_URL, "IATA Airports")
        airports_count = import_airports(conn, airports_data)
    except Exception as e:
        print(f"  WARNING: Failed to download airports: {e}")
        airports_count = 0

    # Print summary
    total = conn.execute("SELECT COUNT(*) FROM ports").fetchone()[0]
    wpi_total = conn.execute("SELECT COUNT(*) FROM ports WHERE source = 'wpi'").fetchone()[0]
    locode_total = conn.execute("SELECT COUNT(*) FROM ports WHERE source = 'locode'").fetchone()[0]
    iata_total = conn.execute("SELECT COUNT(*) FROM ports WHERE source = 'iata'").fetchone()[0]

    print("\n" + "=" * 60)
    print(f"Sync complete!")
    print(f"  Total locations: {total}")
    print(f"  From WPI (seaports): {wpi_total}")
    print(f"  From UN/LOCODE (trade locations): {locode_total}")
    print(f"  From IATA (airports): {iata_total}")

    # Sample some locations including USLIH
    print("\nSample locations:")
    for row in conn.execute("""
        SELECT locode, name, country, lat, lon, source
        FROM ports
        WHERE locode IN ('USLAX', 'USHNL', 'USLIH', 'SGSIN', 'GBSOU', 'AUSYD')
        ORDER BY locode
    """):
        print(f"  {row[0]}: {row[1]} ({row[2]}) - {row[3]:.4f}, {row[4]:.4f} [{row[5]}]")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Sync port database from NGA WPI and UN/LOCODE")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Database path")
    args = parser.parse_args()

    if not args.db.exists():
        print(f"Error: Database not found: {args.db}")
        print("Run the main app first to create the database, then run this sync.")
        return 1

    sync_ports(args.db)
    return 0


if __name__ == "__main__":
    exit(main())
