# AIS Princess Go Rewrite Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Single Go Binary                                   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      Embedded NATS JetStream                            ││
│  │                                                                          ││
│  │   Streams:                         PubSub:                              ││
│  │   ┌──────────────┐                 ┌──────────────┐                     ││
│  │   │ ais.raw      │ ──────────────→ │ ais.positions│ (real-time)        ││
│  │   │ (persistent) │                 │ ais.vessels  │                     ││
│  │   └──────────────┘                 └──────────────┘                     ││
│  │          │                                ↑                              ││
│  │          │ Leaf Node (WSS to fly.io)      │                              ││
│  │          ↓                                │                              ││
│  │   ┌──────────────┐                        │                              ││
│  │   │ Remote NATS  │────────────────────────┘                              ││
│  │   └──────────────┘                                                       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  Components (enabled by mode):                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Capture   │  │  Decoder   │  │  HTTP API  │  │  Web UI    │            │
│  │            │  │            │  │  WebSocket │  │  (static)  │            │
│  │ receiver,  │  │ server,    │  │ server,    │  │ server,    │            │
│  │ standalone │  │ standalone │  │ standalone │  │ standalone │            │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘            │
│                                                                              │
│  Storage:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                          SQLite (ais-data.db)                           ││
│  │   raw_messages | positions | vessels | ports | latest_positions | ...   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## Modes of Operation

### 1. Receiver Mode (`--mode=receiver`)
- Runs AIS-catcher as subprocess (or links to libais)
- Receives UDP NMEA sentences
- Persists to SQLite `raw_messages` table (local durability)
- Publishes to NATS stream `ais.raw`
- Connects as leaf node to remote NATS (when online)
- Does NOT run decoder, API, or UI

### 2. Server Mode (`--mode=server`)
- Runs NATS server (accepts leaf node connections)
- Subscribes to `ais.raw` stream
- Runs decoder → writes to SQLite → publishes to `ais.positions`
- Serves HTTP API (REST endpoints)
- Serves WebSocket (subscribes to NATS for real-time push)
- Serves static web UI

### 3. Standalone Mode (`--mode=standalone`)
- Everything: receiver + server in one process
- For fully offline operation
- Same binary, all components enabled

## NATS Topic Design

```
Streams (persistent, durable):
  ais.raw.{receiver_id}     # Raw NMEA messages from each receiver
                            # Subject: ais.raw.receiver1, ais.raw.receiver2
                            # Mirrored to cloud via leaf node

PubSub (ephemeral, real-time):
  ais.positions             # Decoded position updates (for WebSocket)
  ais.vessels               # Vessel static data updates
  ais.events                # System events (receiver online/offline, etc.)
```

## Message Flow

### Capture → Cloud
```
1. AIS-catcher receives radio signal
2. UDP packet arrives at Go capture handler
3. Insert into SQLite: raw_messages (receiver_id, timestamp, mmsi, nmea)
4. Publish to NATS: ais.raw.{receiver_id}
5. Embedded NATS persists to JetStream
6. Leaf node syncs to cloud NATS (when online)
7. Cloud receives ack → edge marks message synced
```

### Cloud Processing
```
1. Decoder consumer subscribes to ais.raw.>
2. Receives message from any receiver
3. Decodes NMEA → structured data
4. Writes to SQLite: positions, vessels, etc.
5. Publishes to ais.positions (real-time)
6. WebSocket subscribers receive push
```

### Real-time to Browser
```
1. Browser connects WebSocket to /ws/ais
2. Server subscribes to NATS ais.positions on behalf of client
3. NATS message arrives → push to WebSocket
4. No polling required
```

## SQLite Schema Changes

```sql
-- Add receiver_id for multi-receiver support
ALTER TABLE raw_messages ADD COLUMN receiver_id TEXT NOT NULL DEFAULT 'default';

-- Change primary key to composite (for idempotent cloud inserts)
-- New table structure:
CREATE TABLE raw_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Local auto-increment
    receiver_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    mmsi INTEGER NOT NULL,
    nmea TEXT NOT NULL,
    channel TEXT,
    decoded INTEGER DEFAULT 0,
    decode_error TEXT,
    synced INTEGER DEFAULT 0,              -- 0=pending, 1=synced to cloud
    UNIQUE(receiver_id, timestamp, nmea)   -- Dedupe constraint
);

CREATE INDEX idx_raw_unsynced ON raw_messages(synced) WHERE synced = 0;
CREATE INDEX idx_raw_receiver ON raw_messages(receiver_id, timestamp);
```

## Go Project Structure

```
cmd/
  ais-princess/
    main.go                 # CLI entry point, mode selection

internal/
  capture/
    capture.go              # AIS-catcher subprocess management
    udp.go                  # UDP listener for NMEA

  decoder/
    decoder.go              # NMEA → structured data
    types.go                # AIS message types
    binary.go               # DAC/FID binary payload decoder

  nats/
    server.go               # Embedded NATS server setup
    streams.go              # JetStream stream configuration
    leafnode.go             # Leaf node connection to cloud

  storage/
    sqlite.go               # SQLite connection, migrations
    raw.go                  # raw_messages repository
    positions.go            # positions repository
    vessels.go              # vessels repository

  api/
    server.go               # HTTP server setup
    routes.go               # REST endpoint handlers
    websocket.go            # WebSocket handler (NATS bridge)

  ui/
    embed.go                # Embedded static files (go:embed)

web/
  static/                   # Existing frontend (embedded at build)
```

## Fly.io Infrastructure

### Required Resources

```bash
# 1. Create the app
fly launch --name ais-princess --no-deploy

# 2. Create volume for SQLite
fly volumes create ais_data --region sjc --size 1

# 3. Allocate dedicated IPv4 (for NATS TCP, optional if using WSS only)
fly ips allocate-v4

# 4. Set secrets
fly secrets set NATS_AUTH_TOKEN=$(openssl rand -hex 32)
```

### fly.toml

```toml
app = "ais-princess"
primary_region = "sjc"

[build]
  # Uses Dockerfile

[env]
  MODE = "server"
  DB_PATH = "/data/ais-data.db"
  NATS_PORT = "4222"
  NATS_WS_PORT = "8222"
  HTTP_PORT = "8000"

[mounts]
  source = "ais_data"
  destination = "/data"

# HTTP for web UI and API
[[services]]
  internal_port = 8000
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]

# NATS WebSocket for leaf node connections (WSS on 4443)
[[services]]
  internal_port = 8222
  protocol = "tcp"

  [[services.ports]]
    port = 4443
    handlers = ["tls"]

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

### Dockerfile

```dockerfile
FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 go build -o /ais-princess ./cmd/ais-princess

FROM alpine:latest
RUN apk add --no-cache sqlite

COPY --from=builder /ais-princess /usr/local/bin/
COPY web/static /app/web/static

WORKDIR /app
CMD ["ais-princess", "--mode=server", "--db=/data/ais-data.db"]
```

## Edge Configuration

### Receiver config (edge device)

```yaml
# /etc/ais-princess/config.yaml
mode: receiver
receiver_id: "home-sdr"

sqlite:
  path: /var/lib/ais-princess/ais-data.db

nats:
  jetstream_dir: /var/lib/ais-princess/jetstream
  leaf_node:
    url: wss://ais-princess.fly.dev:4443
    token: ${NATS_AUTH_TOKEN}
    reconnect_wait: 5s

capture:
  # Option A: Run AIS-catcher as subprocess
  ais_catcher:
    enabled: true
    device: 0
    ppm: 0

  # Option B: Listen for UDP from external AIS-catcher
  udp:
    enabled: false
    port: 10110
```

### Standalone config (full offline)

```yaml
mode: standalone
receiver_id: "portable"

sqlite:
  path: ./ais-data.db

nats:
  jetstream_dir: ./jetstream
  leaf_node:
    url: wss://ais-princess.fly.dev:4443
    token: ${NATS_AUTH_TOKEN}
    # Will connect when online, work offline when not

http:
  port: 8000

# Everything runs locally
```

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Go project setup with modules
- [ ] Embedded NATS server with JetStream
- [ ] SQLite integration with migrations
- [ ] Basic CLI with mode selection

### Phase 2: Capture Pipeline
- [ ] UDP listener for NMEA
- [ ] AIS-catcher subprocess management
- [ ] SQLite persistence (raw_messages)
- [ ] NATS publish to ais.raw stream

### Phase 3: Decoder
- [ ] Port Python decoder to Go (or use existing Go AIS lib)
- [ ] NATS consumer for ais.raw
- [ ] SQLite writes (positions, vessels, etc.)
- [ ] NATS publish to ais.positions

### Phase 4: API & WebSocket
- [ ] REST API endpoints (port from Python)
- [ ] WebSocket with NATS subscription
- [ ] Static file serving (embed web UI)

### Phase 5: Cloud Deployment
- [ ] Fly.io setup (app, volume, secrets)
- [ ] NATS WebSocket endpoint for leaf nodes
- [ ] Leaf node configuration and testing

### Phase 6: Edge Deployment
- [ ] Systemd service file
- [ ] Config file support
- [ ] Offline/online transition handling

## Key Libraries

```go
// go.mod
module github.com/hagmonk/ais-princess

go 1.23

require (
    github.com/nats-io/nats-server/v2 v2.10.x  // Embedded NATS
    github.com/nats-io/nats.go v1.x            // NATS client
    github.com/mattn/go-sqlite3 v1.14.x        // SQLite driver
    github.com/labstack/echo/v4 v4.x           // HTTP framework
    github.com/gorilla/websocket v1.5.x        // WebSocket
    github.com/BertoldVdb/go-ais v0.x          // AIS decoding
    github.com/spf13/cobra v1.8.x              // CLI
    github.com/spf13/viper v1.18.x             // Config
)
```

## Decisions

### 1. AIS Decoding: go-ais with Validation

**Decision**: Use [github.com/BertoldVdb/go-ais](https://github.com/BertoldVdb/go-ais) but validate 100% message coverage first.

**Requirement**: Strict policy of full decoding - all 27 AIS message types must be supported.

**Validation approach**:
- Run go-ais against existing captured data in `raw_messages`
- Compare decoded output to Python decoder output
- Document any gaps in message type or field coverage
- If gaps exist, either:
  - Contribute fixes upstream to go-ais
  - Port specific decoders from Python (DAC/FID binary payloads)

**Tracked in Phase 3** - decoder validation is a prerequisite before committing to go-ais.

### 2. Map Tiles: Cache-on-Demand with Free Providers

**Decision**: Use free tile providers (no API keys), cache tiles on demand for offline use.

**Tile providers** (all free, no API key required):

```javascript
// CARTO Basemaps (recommended for dark UI)
'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'  // Dark
'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'     // Light
'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'      // Terrain colors

// OpenFreeMap (community project)
'https://tiles.openfreemap.org/styles/liberty'
'https://tiles.openfreemap.org/styles/bright'

// Protomaps (free tier)
'https://api.protomaps.com/styles/v2/dark.json?key=free'

// ESRI Satellite (raster, for imagery layer)
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
```

**Caching strategy**:
- Edge/standalone: Cache tiles to local disk as they're fetched
- Assumes at least some internet connectivity at some point
- Cache location: `~/.cache/ais-princess/tiles/` or configurable
- No tile bundling in binary (too large)

**Implementation**:
- Service worker for browser-based caching, OR
- Go proxy endpoint that caches tiles server-side
- Second option better for standalone mode (works across browser sessions)

### 3. Multiple Receivers: Deferred

**Decision**: Punt for now. Single receiver only.

**Current state**: Only one receiver exists.

**Future design** (when needed):
- Each receiver has own stream: `ais.raw.{receiver_id}`
- Cloud subscribes to `ais.raw.>` (wildcard)
- Dedupe on cloud by `(timestamp, receiver_id, mmsi, nmea)` composite key
- Will address when second receiver comes online

### 4. Conflict Resolution: Cloud is Source of Truth

**Decision**: Cloud is authoritative for decoded data.

**Behavior**:
- Edge only syncs `raw_messages` upstream
- Cloud runs decoder, writes to `positions`, `vessels`, etc.
- Edge in standalone mode runs local decoder for offline viewing
- On reconnect, edge does NOT sync local decoded data
- Edge decoded data is ephemeral/local-only

## Open Questions

1. **go-ais DAC/FID support**: Does go-ais support binary payload decoding (DAC 001, 200, 367)?
   - If not, may need to port `dac-fid-decoder/` from Python
   - This is a hard requirement for 100% decode coverage

2. **Tile cache eviction**: How much disk space to allow for cached tiles?
   - LRU eviction when cache exceeds limit?
   - Default 500MB? 1GB?

3. **Offline style files**: Vector tile styles reference fonts/sprites via URL
   - Need to cache or embed these for true offline operation
   - Or use raster tiles which are self-contained
