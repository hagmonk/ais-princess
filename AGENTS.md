# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, complete ALL applicable steps below.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Commit changes locally**:
   ```bash
   bd sync
   git add <files>
   git commit -m "descriptive message"
   ```
5. **Verify** - All changes committed locally
6. **Hand off** - Provide context for next session

**GIT COMMIT IDENTITY:**
Agents MUST use `-c` flags when committing to avoid GPG signing issues:
```bash
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" -c commit.gpgsign=false commit -m "..."
```

**CRITICAL RULES:**
- **ALWAYS use `-c` flags** - User's default git uses GPG signing which fails
- The `commit.gpgsign=false` flag is required for commits to work
- You may push to remote after committing
- You may run `bd sync` to sync issue tracking

---

# Project Overview

**ais-princess** is an AIS (Automatic Identification System) receiver and visualization system. It captures raw AIS radio signals from an RTL-SDR dongle, stores them in SQLite, decodes the messages (including extended DAC/FID binary payloads), and displays vessel positions on a real-time web map.

## Project Structure

```
ais-princess/
├── capture/              # AIS data capture from RTL-SDR
│   ├── ais-catcher.py    # Main capture (runs AIS-catcher, UDP → SQLite)
│   └── rtl-ais.py        # Alternative capture (runs rtl_ais)
├── db/                   # Database and processing
│   ├── ais-data.db       # SQLite database (raw + decoded data)
│   ├── migrate.py        # Schema migration (tables, triggers, indexes)
│   ├── decoder.py        # Decoder service (raw NMEA → decoded tables)
│   └── sync_ports.py     # Port database sync (NGA WPI, UN/LOCODE, IATA)
├── dac-fid-decoder/      # Library for decoding binary AIS payloads
│   ├── src/ais_binary/   # Decoder modules (DAC 001, 200, 367)
│   ├── tests/            # Unit tests
│   └── examples/         # Usage examples
├── tools/                # Development utilities
│   └── tmux_runner.py    # ais-tmux service manager
└── web/                  # Web UI for real-time vessel display
    ├── main.py           # FastAPI backend (WebSocket, REST API)
    └── static/
        ├── index.html    # Main page with CDN dependencies
        ├── app.js        # Application logic
        ├── state.js      # Reactive state (@preact/signals-core)
        └── style.css     # Dark theme styling
```

---

# Project Rules

## Must Have

- **No build system**: Frontend uses plain HTML/JS loaded via CDN script tags. No webpack, vite, npm, or Node.js tooling.
- **uv for Python**: All Python package management and execution via uv.
- **Stateless backend**: Backend decodes and broadcasts. Frontend maintains all vessel state.

## Must Not

- **Do not commit as the user** - Always set agent git identity first (see above)
- **Do not run servers in background** - The user manages services via `uv run ais-tmux`. Running servers (especially on port 8000) in background mode conflicts with `--restart-all` and causes port binding issues. If you need to test the web server, run it briefly in the foreground then stop it.
- Do not use React, Vue, Svelte, or any frontend framework requiring a build step
- Do not use npm, yarn, or any JavaScript package manager
- Do not implement authentication or authorization
- Do not design for horizontal scaling, multiple workers, or remote access

## Development Environment

### Python
- **Always use `uv`** to run Python scripts and manage dependencies
- Use inline script dependencies in the `# /// script` format
- Default database path: `db/ais-data.db`

### JavaScript / Frontend
- **No build step required** - use CDN dependencies only
- Libraries used:
  - MapLibre GL JS (maps)
  - deck.gl (WebGL layers)
  - Tabulator (data tables)
  - uPlot (time series charts)
  - @preact/signals-core (reactive state management)
- All dependencies loaded via unpkg CDN

## AIS Data Requirements

### Capture
- **Capture 100% of AIS messages** - never drop data
- Use UDP protocol with AIS-catcher (not stdout parsing)
- Store raw NMEA sentences in SQLite for reprocessing
- Handle multi-part messages (e.g., Type 5 is 2-part)

### Decoding
- **Decode all fields from all 27 AIS message types**
- Use pyais library with AISTracker for vessel state aggregation
- Enrich position messages with static data (ship name, callsign, IMO, etc.)
- Log unknown fields for future handling

## Architecture

```
capture/
  ais-catcher.py     - Raw NMEA collector (runs AIS-catcher, UDP → SQLite)
  rtl-ais.py         - Alternative collector (runs rtl_ais, UDP → SQLite)
db/
  ais-data.db        - SQLite database (raw NMEA + decoded data)
  migrate.py         - Schema migration (tables, triggers, indexes)
  decoder.py         - Decoder service (raw → positions/vessels)
  sync_ports.py      - Port database sync (WPI, UN/LOCODE, IATA airports)
dac-fid-decoder/
  src/ais_binary/    - DAC/FID binary payload decoders
    dac001.py        - IMO international messages
    dac200.py        - Inland waterway messages
    dac367.py        - US/NOAA messages
    bitreader.py     - Bit-level parsing utilities
tools/
  tmux_runner.py     - ais-tmux service manager (entry point)
web/
  main.py            - FastAPI backend (WebSocket, REST API, port resolution)
  static/
    index.html       - Main page with CDN dependencies
    app.js           - Application logic
    state.js         - Reactive state management (@preact/signals-core)
    style.css        - Dark theme styling
```

### Data Flow

```
RTL-SDR → AIS-catcher → UDP → ais-catcher.py → raw_messages (queue)
                                                      ↓
                                               decoder.py
                                                      ↓
                                        positions/vessels/latest_positions
                                                      ↓
Browser ← WebSocket ← main.py (polling positions) ←──┘
```

## Message Types Handled

| Type | Description | Key Fields |
|------|-------------|------------|
| 1,2,3 | Class A Position | lat, lon, speed, course, heading, status |
| 4,11 | Base Station | lat, lon, timestamp |
| 5 | Static & Voyage | shipname, callsign, IMO, destination, dimensions |
| 9 | SAR Aircraft | lat, lon, altitude, speed |
| 18,19 | Class B Position | lat, lon, speed, course |
| 21 | Navigation Aid | name, type, position |
| 24 | Class B Static | shipname, callsign, dimensions |
| 27 | Long Range | lat, lon, speed, course |

## Running the Application

### Using ais-tmux (Recommended)

The `ais-tmux` tool manages all three services in tmux panes:

```
┌─────────────────┐
│    web (0)      │  <- Web server (main.py)
├─────────────────┤
│   decoder (1)   │  <- Message decoder (decoder.py) - continuous
├─────────────────┤
│   capture (2)   │  <- AIS capture (ais-catcher.py)
└─────────────────┘
```

```bash
# Start all services in tmux
uv run ais-tmux

# Force recreate session (if pane count is wrong)
uv run ais-tmux --force

# Check status
uv run ais-tmux --status

# Restart services (after code changes)
uv run ais-tmux --restart-all
uv run ais-tmux --restart-web
uv run ais-tmux --restart-decoder
uv run ais-tmux --restart-capture

# Stop all services
uv run ais-tmux --stop

# Attach to the tmux session
tmux attach -t ais-princess
```

### Manual Startup

```bash
# 1. Start the data collector (requires RTL-SDR and AIS-catcher installed)
uv run capture/ais-catcher.py --tuner 49.6

# 2. Start the decoder service (processes raw messages into decoded tables)
uv run db/decoder.py

# 3. Start the web server
uv run web/main.py --port 8000

# Open http://localhost:8000 in browser
```

### One-time Setup / Backfill

```bash
# Run database migration (creates tables, triggers, indexes)
uv run db/migrate.py

# Sync port database (downloads NGA WPI, UN/LOCODE, IATA airports)
uv run db/sync_ports.py

# Process existing raw messages (one-shot mode)
uv run db/decoder.py --once --batch-size 5000

# Run dac-fid-decoder tests
cd dac-fid-decoder && uv run pytest
```

## Database Architecture

The system uses a queue-based architecture where capture never fails:

```
ais-catcher.py → raw_messages (queue) → decoder.py → positions/vessels/etc
     |                                       |
     | NEVER fails                           | Can fail safely
     | NEVER loses data                      | Retryable
```

### Tables

| Table | Purpose |
|-------|---------|
| `raw_messages` | Queue + audit trail (raw NMEA) |
| `positions` | Decoded position reports |
| `vessels` | Static vessel data (name, callsign, etc.) |
| `latest_positions` | Trigger-maintained, one row per vessel |
| `base_stations` | Base station reports |
| `nav_aids` | Navigation aids |
| `ports` | Port/location database for destination resolution |

### Key Queries

```sql
-- Instant UI load (<10ms)
SELECT * FROM latest_positions;

-- Full track for a vessel
SELECT * FROM positions WHERE mmsi = ? ORDER BY timestamp DESC;
```

## dac-fid-decoder Library

The `dac-fid-decoder` module decodes binary payloads from AIS message types 6, 8, 25, and 26 that pyais extracts but doesn't interpret. These contain application-specific messages (meteorological data, navigation warnings, inland waterway info, etc.).

Supported DACs:
- **DAC 001** (IMO International): Met/Hydro, Area Notice, Route Info, etc.
- **DAC 200** (Inland Waterways): Ship static, ETA/RTA, water levels
- **DAC 367** (US/NOAA): Environmental/weather data

