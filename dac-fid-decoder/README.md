# ais-princess 🚢👸

AIS binary message decoder for pyais. Decodes the DAC/FID-specific payloads that pyais returns as raw bytes.

## Installation

```bash
pip install -e .
```

## Usage

```python
from pyais import decode
from ais_binary import decode_binary_payload

# Decode an AIS message with pyais
msg = decode("!AIVDM,1,1,,B,85MsUdPOj8d<F<FEuhF=@@@@@@@@,0*3D").asdict()

if msg['type'] in (6, 8, 25, 26):
    # pyais gives us dac, fid, and raw data
    decoded = decode_binary_payload(
        dac=msg['dac'],
        fid=msg['fid'],
        data=msg['data']
    )
    print(decoded)
```

## Supported Message Types

### DAC 001 (International/IMO)

| FID | Name | IMO Circ | Status |
|-----|------|----------|--------|
| 11 | Met/Hydro | 236 | ✓ (deprecated) |
| 13 | Fairway Closed | 289 | ✓ |
| 15 | Extended Ship Static (Air Draught) | 289 | ✓ |
| 16 | Number of Persons on Board | 289 | ✓ |
| 17 | VTS Generated Targets | 289 | ✓ |
| 19 | Marine Traffic Signal | 289 | ✓ |
| 21 | Weather Observation Report | 289 | ✓ |
| 22 | Area Notice | 289 | ✓ |
| 24 | Extended Ship Static and Voyage | 289 | ✓ |
| 27 | Route Information | 289 | ✓ |
| 29 | Text Description | 289 | ✓ |
| 31 | Met/Hydro | 289 | ✓ |

### DAC 200 (Inland Waterways)

| FID | Name | Status |
|-----|------|--------|
| 10 | Inland Ship Static and Voyage | ✓ |
| 21 | ETA at Lock/Bridge/Terminal | ✓ |
| 22 | RTA at Lock/Bridge/Terminal | ✓ |
| 23 | EMMA Warning | ✓ |
| 24 | Water Levels | ✓ |
| 40 | Signal Status | ✓ |
| 55 | Number of Persons on Board | ✓ |

### DAC 367 (US/NOAA)

| FID | Name | Status |
|-----|------|--------|
| 22 | Area Notice (US) | ✓ |
| 33 | Environmental/Weather | ✓ |

## Architecture

This module complements pyais by decoding the binary payloads that pyais extracts but doesn't interpret:

```
NMEA sentence
     │
     ▼
   pyais.decode()
     │
     ├── type, mmsi, dac, fid
     └── data (raw bytes) ──► ais_binary.decode_binary_payload()
                                      │
                                      ▼
                              Structured dict with
                              decoded fields
```

## References

- [GPSD AIVDM](https://gpsd.gitlab.io/gpsd/AIVDM.html) - Definitive protocol reference
- [IMO SN.1/Circ.289](https://www.imo.org) - Application-specific messages
- [libais](https://github.com/schwehr/libais) - Reference C++ implementation (Apache-2.0)
- [pyais](https://github.com/M0r13n/pyais) - Python AIS decoder

## License

MIT - Decoder logic ported from libais (Apache-2.0) with attribution.
