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

**CRITICAL RULES:**
- **NEVER push to remote** - The user will push manually
- **NEVER run `git push`** - Local commits only
- You may run `git pull --rebase` to sync before committing
- You may run `bd sync` to sync issue tracking

---

# Project Rules

## Development Environment

### Python
- **Always use `uv`** to run Python scripts and manage dependencies
- Use inline script dependencies in the `# /// script` format
- Default database path: `ais-data.db`

### JavaScript / Frontend
- **No build step required** - use CDN dependencies only
- Libraries used:
  - MapLibre GL JS (maps)
  - deck.gl (WebGL layers)
  - Tabulator (data tables)
  - uPlot (time series charts)
- All dependencies loaded via unpkg CDN

## AIS Data Requirements

### Capture
- **Capture 100% of AIS messages** - never drop data
- Use UDP protocol with rtl_ais (not stdout parsing)
- Store raw NMEA sentences in SQLite for reprocessing
- Handle multi-part messages (e.g., Type 5 is 2-part)

### Decoding
- **Decode all fields from all 27 AIS message types**
- Use pyais library with AISTracker for vessel state aggregation
- Enrich position messages with static data (ship name, callsign, IMO, etc.)
- Log unknown fields for future handling

## Architecture

```
rtl-ais.py      - Raw NMEA collector (UDP from rtl_ais → SQLite)
main.py         - FastAPI backend (SQLite polling → WebSocket broadcast)
static/         - Frontend (no build step)
  index.html    - Main page with CDN dependencies
  app.js        - Application logic
  style.css     - Dark theme styling
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

```bash
# Start the data collector (requires RTL-SDR)
uv run rtl-ais.py --gain 496 --ppm 0

# Start the web server
uv run main.py --port 8000

# Open http://localhost:8000 in browser
```

