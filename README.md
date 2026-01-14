# ais-princess

AIS (Automatic Identification System) receiver and real-time vessel tracking visualization.

Captures raw AIS radio signals from an RTL-SDR dongle, decodes all 27 AIS message types (including DAC/FID binary payloads), and displays vessel positions on an interactive web map.

## Features

- **100% message capture** - Raw NMEA stored in SQLite for reprocessing
- **Full AIS decoding** - All 27 message types including binary payloads (DAC 001, 200, 367)
- **Real-time web map** - MapLibre GL + deck.gl with vessel tracks and voyage visualization
- **Port resolution** - Resolves destination codes to coordinates (NGA WPI, UN/LOCODE, IATA)
- **No build step** - Pure HTML/JS frontend loaded via CDN

## Quick Start

```bash
# Install dependencies
uv sync

# Run database migrations
uv run db/migrate.py

# Sync port database (optional, for destination resolution)
uv run db/sync_ports.py

# Start all services in tmux
uv run ais-tmux

# Open http://localhost:8000
```

## Requirements

- Python 3.13+
- [uv](https://github.com/astral-sh/uv) package manager
- RTL-SDR dongle + [AIS-catcher](https://github.com/jvde-github/AIS-catcher)
- tmux (for service management)

## Architecture

```
RTL-SDR → AIS-catcher → UDP → capture script → raw_messages (SQLite)
                                                      ↓
                                               decoder.py
                                                      ↓
                                        positions/vessels/latest_positions
                                                      ↓
Browser ← WebSocket ← FastAPI (main.py) ←────────────┘
```

## Project Structure

```
capture/          AIS data capture (ais-catcher.py, rtl-ais.py)
db/               Database, migrations, decoder, port sync
dac-fid-decoder/  Binary payload decoder library
tools/            Service management (ais-tmux)
web/              FastAPI backend + static frontend
```

## Service Management

```bash
uv run ais-tmux              # Start all services
uv run ais-tmux --status     # Check status
uv run ais-tmux --restart-all # Restart after code changes
uv run ais-tmux --stop       # Stop all services
tmux attach -t ais-princess  # Attach to session
```
