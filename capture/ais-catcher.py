#!/usr/bin/env python3
"""
AIS-catcher Data Collector

Runs AIS-catcher and stores raw NMEA messages in a SQLite database.
Listens on UDP port for NMEA data from AIS-catcher.

Usage:
    uv run ais-catcher.py [options]
    uv run ais-catcher.py --tuner 49.6
    uv run ais-catcher.py --db /path/to/ais.db
"""

# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///

import argparse
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


DEFAULT_DB = Path(__file__).parent / "ais-data.db"
DEFAULT_PORT = 10110
DEFAULT_AIS_CATCHER = "/Users/lburton/src/github.com/jvde-github/AIS-catcher/build/AIS-catcher"


class AISDatabase:
    """SQLite database for raw AIS messages"""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.lock = threading.Lock()
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS raw_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                nmea TEXT NOT NULL
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON raw_messages(timestamp)")
        self.conn.commit()

    def store(self, nmea: str) -> int:
        with self.lock:
            cursor = self.conn.execute(
                "INSERT INTO raw_messages (timestamp, nmea) VALUES (?, ?)",
                (datetime.now(timezone.utc).isoformat(), nmea)
            )
            self.conn.commit()
            return cursor.lastrowid

    def count(self) -> int:
        with self.lock:
            return self.conn.execute("SELECT COUNT(*) FROM raw_messages").fetchone()[0]

    def close(self):
        self.conn.close()


class AISCatcherCollector:
    """Manages AIS-catcher process and UDP listener"""

    def __init__(self, db: AISDatabase, ais_catcher_path: str = DEFAULT_AIS_CATCHER,
                 tuner: float = 49.6, ppm: int = 0, port: int = DEFAULT_PORT,
                 rtlagc: bool = True, biastee: bool = False):
        self.db = db
        self.ais_catcher_path = ais_catcher_path
        self.tuner = tuner
        self.ppm = ppm
        self.port = port
        self.rtlagc = rtlagc
        self.biastee = biastee
        self.process: Optional[subprocess.Popen] = None
        self.socket: Optional[socket.socket] = None
        self.running = False
        self.count = 0
        self.start_time: Optional[datetime] = None

    def start(self):
        # Start UDP listener first
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(("127.0.0.1", self.port))
        self.socket.settimeout(1.0)

        # Build AIS-catcher command
        # -u sends UDP output, -n shows NMEA on screen, -v enables stats
        cmd = [
            self.ais_catcher_path,
            "-u", "127.0.0.1", str(self.port),  # UDP destination
            "-p", str(self.ppm),                 # PPM correction
            "-gr",                               # RTL-SDR settings
            "tuner", str(self.tuner),
            "rtlagc", "on" if self.rtlagc else "off",
            "biastee", "on" if self.biastee else "off",
            "-v",                                # Verbose mode for stats
            "-n",                                # Show NMEA on screen
        ]

        print(f"Starting: {' '.join(cmd)}")
        print(f"Listening on UDP port {self.port}")
        print(f"Database: {self.db.db_path}")
        print("-" * 50)

        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        self.running = True
        self.start_time = datetime.now()

        # Thread to print AIS-catcher output
        def print_output():
            for line in self.process.stdout:
                if not self.running:
                    break
                line = line.strip()
                if line and not line.startswith("!AIVD"):
                    print(line)

        output_thread = threading.Thread(target=print_output, daemon=True)
        output_thread.start()

        # Main loop: receive UDP packets
        try:
            while self.running:
                try:
                    data, addr = self.socket.recvfrom(4096)
                    nmea = data.decode("ascii", errors="ignore").strip()

                    for line in nmea.split("\n"):
                        line = line.strip()
                        if line.startswith("!AIVDM") or line.startswith("!AIVDO"):
                            self.db.store(line)
                            self.count += 1
                            if self.count % 10 == 0:
                                self._status()

                except socket.timeout:
                    continue
                except Exception as e:
                    if self.running:
                        print(f"UDP error: {e}")

        except KeyboardInterrupt:
            pass

        self.stop()

    def _status(self):
        elapsed = (datetime.now() - self.start_time).total_seconds()
        rate = self.count / elapsed * 60 if elapsed > 0 else 0
        print(f"\r[{datetime.now().strftime('%H:%M:%S')}] Messages: {self.count} ({rate:.1f}/min)", end="", flush=True)

    def stop(self):
        self.running = False
        if self.socket:
            self.socket.close()
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()

        elapsed = (datetime.now() - self.start_time).total_seconds() if self.start_time else 0
        print(f"\n\nStopped. {self.count} messages in {elapsed:.0f}s. Total in DB: {self.db.count()}")


def main():
    parser = argparse.ArgumentParser(description="AIS-catcher raw data collector")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Database path")
    parser.add_argument("--tuner", type=float, default=49.6, help="Tuner gain (0.0-50.0, default: 49.6)")
    parser.add_argument("--ppm", type=int, default=0, help="PPM correction")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="UDP port (default: 10110)")
    parser.add_argument("--ais-catcher", type=str, default=DEFAULT_AIS_CATCHER, help="AIS-catcher path")
    parser.add_argument("--rtlagc", action="store_true", default=True, help="Enable RTL AGC (default: on)")
    parser.add_argument("--no-rtlagc", action="store_false", dest="rtlagc", help="Disable RTL AGC")
    parser.add_argument("--biastee", action="store_true", default=False, help="Enable bias tee")

    args = parser.parse_args()
    db = AISDatabase(args.db)
    collector = AISCatcherCollector(
        db, args.ais_catcher, args.tuner, args.ppm, args.port,
        args.rtlagc, args.biastee
    )

    def shutdown(sig, frame):
        collector.stop()
        db.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        collector.start()
    finally:
        db.close()


if __name__ == "__main__":
    main()
