"""
DAC 200 - Inland Waterways binary message decoders.

Implements decoders for European inland waterway AIS messages.
Used on rivers like the Rhine, Danube, and other EU waterways.

References:
- CCNR Inland ECDIS Standard
- EU Directive 2005/44/EC
- https://gpsd.gitlab.io/gpsd/AIVDM.html
"""

from __future__ import annotations
from typing import Dict, Any
from .bitreader import BitReader


# Ship type codes for inland vessels
INLAND_SHIP_TYPES = {
    8000: "Vessel, type unknown",
    8010: "Motor freighter",
    8020: "Motor tanker",
    8021: "Motor tanker, liquid cargo, type N",
    8022: "Motor tanker, liquid cargo, type C",
    8023: "Motor tanker, dry cargo as if liquid",
    8030: "Container vessel",
    8040: "Gas tanker",
    8050: "Motor freighter, tug",
    8060: "Motor tanker, tug",
    8070: "Motor freighter with one or more ships alongside",
    8080: "Motor freighter with tanker",
    8090: "Motor freighter pushing one or more freighters",
    8100: "Motor freighter pushing at least one tank-Loss",
    8110: "Tug, freighter",
    8120: "Tug, tanker",
    8130: "Tug, freighter, coupled",
    8140: "Tug, freighter/tanker, coupled",
    8150: "Freightbarge",
    8160: "Tankbarge",
    8161: "Tankbarge, liquid cargo, type N",
    8162: "Tankbarge, liquid cargo, type C",
    8163: "Tankbarge, dry cargo as if liquid",
    8170: "Freightbarge with containers",
    8180: "Tankbarge, gas",
    8210: "Pushtow, one cargo barge",
    8220: "Pushtow, two cargo barges",
    8230: "Pushtow, three cargo barges",
    8240: "Pushtow, four cargo barges",
    8250: "Pushtow, five cargo barges",
    8260: "Pushtow, six cargo barges",
    8270: "Pushtow, seven cargo barges",
    8280: "Pushtow, eight cargo barges",
    8290: "Pushtow, nine or more cargo barges",
    8310: "Pushtow, one tank/gas barge",
    8320: "Pushtow, two barges at least one tanker or gas barge",
    8330: "Pushtow, three barges at least one tanker or gas barge",
    8340: "Pushtow, four barges at least one tanker or gas barge",
    8350: "Pushtow, five barges at least one tanker or gas barge",
    8360: "Pushtow, six barges at least one tanker or gas barge",
    8370: "Pushtow, seven barges at least one tanker or gas barge",
    8380: "Pushtow, eight barges at least one tanker or gas barge",
    8390: "Pushtow, nine or more barges at least one tanker or gas barge",
    8400: "Tug, single",
    8410: "Tug, one or more tows",
    8420: "Tug, assisting a vessel or convey",
    8430: "Pushboat, single",
    8440: "Passenger ship",
    8441: "Ferry",
    8442: "Red Cross ship",
    8443: "Cruise ship",
    8444: "Passenger ship without accommodation",
    8450: "Service vessel, police patrol",
    8460: "Service vessel",
    8470: "Object, towed, not otherwise specified",
    8480: "Fishing boat",
    8490: "Bunkership",
    8500: "Barge, tanker, chemical",
    8510: "Object, not otherwise specified",
}


def decode_dac200(fid: int, data: bytes) -> Dict[str, Any]:
    """
    Dispatch to the appropriate DAC 200 FID decoder.
    """
    decoders = {
        10: decode_200_10,  # Inland ship static and voyage
        21: decode_200_21,  # ETA at lock/bridge/terminal
        22: decode_200_22,  # RTA at lock/bridge/terminal
        23: decode_200_23,  # EMMA warning
        24: decode_200_24,  # Water levels
        40: decode_200_40,  # Signal status
        55: decode_200_55,  # Number of persons on board
    }
    
    decoder = decoders.get(fid)
    if decoder is None:
        return {"error": f"Unknown DAC 200 FID {fid}", "raw": data.hex()}
    
    try:
        return decoder(data)
    except Exception as e:
        return {"error": str(e), "fid": fid, "raw": data.hex()}


def decode_200_10(data: bytes) -> Dict[str, Any]:
    """
    FID 10: Inland Ship Static and Voyage Related Data.
    
    Extended vessel information for inland waterways.
    Fixed length: 168 bits
    """
    bits = BitReader(data)
    
    ship_type = bits.get_uint(48, 14)
    ship_type_text = INLAND_SHIP_TYPES.get(ship_type, f"Unknown ({ship_type})")
    
    return {
        "fid": 10,
        "description": "Inland Ship Static and Voyage",
        "eni": bits.get_string(0, 48),  # European Number of Identification
        "length_m": bits.get_uint(48, 13) / 10.0,
        "beam_m": bits.get_uint(61, 10) / 10.0,
        "ship_type": ship_type,
        "ship_type_text": ship_type_text,
        "hazard": bits.get_uint(88, 3),  # Blue cones/lights
        "draught_cm": bits.get_uint(91, 11),
        "loaded": bits.get_uint(102, 2),  # 0=N/A, 1=unloaded, 2=loaded
        "speed_quality": bits.get_bool(104),
        "course_quality": bits.get_bool(105),
        "heading_quality": bits.get_bool(106),
    }


def decode_200_21(data: bytes) -> Dict[str, Any]:
    """
    FID 21: ETA at Lock/Bridge/Terminal.
    
    Estimated Time of Arrival request from inland vessel.
    Fixed length: 248 bits
    """
    bits = BitReader(data)
    
    return {
        "fid": 21,
        "description": "ETA at Lock/Bridge/Terminal",
        "country": bits.get_string(0, 12),  # UN country code
        "location": bits.get_string(12, 18),  # UN location code
        "section": bits.get_string(30, 30),
        "terminal": bits.get_string(60, 30),
        "fairway_section": bits.get_string(90, 30),
        "fairway_hectometre": bits.get_string(120, 30),
        "eta_month": bits.get_uint(150, 4),
        "eta_day": bits.get_uint(154, 5),
        "eta_hour": bits.get_uint(159, 5),
        "eta_minute": bits.get_uint(164, 6),
        "convoy_count": bits.get_uint(170, 3),
        "convoy_length_m": bits.get_uint(173, 13) / 10.0,
        "convoy_beam_m": bits.get_uint(186, 10) / 10.0,
        "convoy_draught_cm": bits.get_uint(196, 11),
        "direction": bits.get_uint(207, 1),  # 0=downstream, 1=upstream
    }


def decode_200_22(data: bytes) -> Dict[str, Any]:
    """
    FID 22: RTA at Lock/Bridge/Terminal.
    
    Recommended Time of Arrival response from infrastructure.
    Fixed length: 232 bits
    """
    bits = BitReader(data)
    
    return {
        "fid": 22,
        "description": "RTA at Lock/Bridge/Terminal",
        "country": bits.get_string(0, 12),
        "location": bits.get_string(12, 18),
        "section": bits.get_string(30, 30),
        "terminal": bits.get_string(60, 30),
        "fairway_section": bits.get_string(90, 30),
        "fairway_hectometre": bits.get_string(120, 30),
        "rta_month": bits.get_uint(150, 4),
        "rta_day": bits.get_uint(154, 5),
        "rta_hour": bits.get_uint(159, 5),
        "rta_minute": bits.get_uint(164, 6),
        "rta_status": bits.get_uint(170, 2),  # 0=confirmed, 1=proposed, etc.
    }


def decode_200_23(data: bytes) -> Dict[str, Any]:
    """
    FID 23: EMMA Warning (European Multimodal Meteorological info for inland navigation).
    
    Weather warnings for inland waterways.
    Variable length depending on warning type.
    """
    bits = BitReader(data)
    
    return {
        "fid": 23,
        "description": "EMMA Warning",
        "start_year": bits.get_uint(0, 8) + 2000,
        "start_month": bits.get_uint(8, 4),
        "start_day": bits.get_uint(12, 5),
        "end_year": bits.get_uint(17, 8) + 2000,
        "end_month": bits.get_uint(25, 4),
        "end_day": bits.get_uint(29, 5),
        "start_hour": bits.get_uint(34, 5),
        "start_minute": bits.get_uint(39, 6),
        "end_hour": bits.get_uint(45, 5),
        "end_minute": bits.get_uint(50, 6),
        "fairway_section": bits.get_string(56, 30),
        "fairway_hectometre_from": bits.get_uint(86, 10),
        "fairway_hectometre_to": bits.get_uint(96, 10),
        "warning_type": bits.get_uint(106, 3),
        "warning_value": bits.get_int(109, 14),
    }


def decode_200_24(data: bytes) -> Dict[str, Any]:
    """
    FID 24: Water Levels.
    
    Current water level at a measurement station.
    Fixed length: 116 bits
    """
    bits = BitReader(data)
    
    return {
        "fid": 24,
        "description": "Water Levels",
        "country": bits.get_string(0, 12),
        "gauge_id": bits.get_uint(12, 11),
        "level_cm": bits.get_int(23, 14),  # Water level in cm
        "day": bits.get_uint(37, 5),
        "hour": bits.get_uint(42, 5),
        "minute": bits.get_uint(47, 6),
    }


def decode_200_40(data: bytes) -> Dict[str, Any]:
    """
    FID 40: Signal Status.
    
    Status of inland waterway signals (locks, bridges).
    Fixed length: ~200 bits (varies by implementation)
    """
    bits = BitReader(data)
    
    lon, lat = bits.get_position(0)
    
    return {
        "fid": 40,
        "description": "Signal Status",
        "longitude": lon,
        "latitude": lat,
        "form": bits.get_uint(49, 4),  # Signal form/shape
        "orientation": bits.get_uint(53, 9),  # Degrees
        "direction": bits.get_uint(62, 3),  # Impact direction
        "status": bits.get_uint(65, 30),  # Light status bitmask
    }


def decode_200_55(data: bytes) -> Dict[str, Any]:
    """
    FID 55: Number of Persons on Board.
    
    Inland vessel variant of persons on board message.
    Fixed length: 168 bits
    """
    bits = BitReader(data)
    
    return {
        "fid": 55,
        "description": "Number of Persons on Board (Inland)",
        "crew": bits.get_uint(0, 8),
        "passengers": bits.get_uint(8, 13),
        "personnel": bits.get_uint(21, 8),
        # Remaining bits are spare/reserved
    }
