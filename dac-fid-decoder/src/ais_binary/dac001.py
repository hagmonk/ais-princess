"""
DAC 001 - International (IMO) binary message decoders.

Implements decoders for IMO Circular 236 and 289 application-specific messages.
Ported from libais (Apache-2.0) with reference to GPSD AIVDM documentation.

References:
- IMO SN.1/Circ.236 (deprecated, but still in use)
- IMO SN.1/Circ.289 (current)
- https://gpsd.gitlab.io/gpsd/AIVDM.html
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional
from .bitreader import BitReader


def decode_dac001(fid: int, data: bytes) -> Dict[str, Any]:
    """
    Dispatch to the appropriate DAC 001 FID decoder.
    
    Args:
        fid: Functional ID (message subtype)
        data: Binary payload bytes
        
    Returns:
        Decoded message fields as a dictionary
    """
    decoders = {
        11: decode_001_11,  # Met/Hydro (IMO 236) - deprecated
        13: decode_001_13,  # Fairway Closed
        15: decode_001_15,  # Extended Ship Static (Air Draught)
        16: decode_001_16,  # Number of Persons on Board
        17: decode_001_17,  # VTS Generated Targets
        19: decode_001_19,  # Marine Traffic Signal
        21: decode_001_21,  # Weather Observation Report
        22: decode_001_22,  # Area Notice
        24: decode_001_24,  # Extended Ship Static and Voyage
        27: decode_001_27,  # Route Information
        29: decode_001_29,  # Text Description
        31: decode_001_31,  # Met/Hydro (IMO 289)
    }
    
    decoder = decoders.get(fid)
    if decoder is None:
        return {"error": f"Unknown DAC 001 FID {fid}", "raw": data.hex()}
    
    try:
        return decoder(data)
    except Exception as e:
        return {"error": str(e), "fid": fid, "raw": data.hex()}


def decode_001_11(data: bytes) -> Dict[str, Any]:
    """
    FID 11: Meteorological and Hydrological Data (IMO 236).
    
    DEPRECATED - superseded by FID 31 (IMO 289), but still transmitted.
    Fixed length: 352 bits (from bit 56 of full message)
    
    Note: This message uses REVERSE lat/lon order (lat first, then lon).
    """
    bits = BitReader(data)
    
    # Position is in reverse order for this message type!
    lat = bits.get_int(0, 24) / 60000.0
    lon = bits.get_int(24, 25) / 60000.0
    
    return {
        "fid": 11,
        "description": "Met/Hydro (IMO 236, deprecated)",
        "latitude": lat,
        "longitude": lon,
        "day": bits.get_uint(49, 5),
        "hour": bits.get_uint(54, 5),
        "minute": bits.get_uint(59, 6),
        "wind_ave_kts": bits.get_uint(65, 7),
        "wind_gust_kts": bits.get_uint(72, 7),
        "wind_dir": bits.get_uint(79, 9),
        "wind_gust_dir": bits.get_uint(88, 9),
        "air_temp_c": bits.get_uint(97, 11) / 10.0 - 60,
        "rel_humidity_pct": bits.get_uint(108, 7),
        "dew_point_c": bits.get_uint(115, 10) / 10.0 - 20,
        "air_pressure_hpa": bits.get_uint(125, 9) + 800,
        "air_pressure_trend": bits.get_uint(134, 2),
        "horz_visibility_nm": bits.get_uint(136, 8) / 10.0,
        "water_level_m": bits.get_uint(144, 9) / 10.0 - 10,
        "water_level_trend": bits.get_uint(153, 2),
        "surf_cur_speed_kts": bits.get_uint(155, 8) / 10.0,
        "surf_cur_dir": bits.get_uint(163, 9),
        "cur_speed_2_kts": bits.get_uint(172, 8) / 10.0,
        "cur_dir_2": bits.get_uint(180, 9),
        "cur_depth_2_m": bits.get_uint(189, 5),
        "cur_speed_3_kts": bits.get_uint(194, 8) / 10.0,
        "cur_dir_3": bits.get_uint(202, 9),
        "cur_depth_3_m": bits.get_uint(211, 5),
        "wave_height_m": bits.get_uint(216, 8) / 10.0,
        "wave_period_s": bits.get_uint(224, 6),
        "wave_dir": bits.get_uint(230, 9),
        "swell_height_m": bits.get_uint(239, 8) / 10.0,
        "swell_period_s": bits.get_uint(247, 6),
        "swell_dir": bits.get_uint(253, 9),
        "sea_state_beaufort": bits.get_uint(262, 4),
        "water_temp_c": bits.get_uint(266, 10) / 10.0 - 10,
        "precip_type": bits.get_uint(276, 3),
        "salinity_ppt": bits.get_uint(279, 9) / 10.0,
        "ice": bits.get_uint(288, 2),
    }


def decode_001_13(data: bytes) -> Dict[str, Any]:
    """
    FID 13: Fairway Closed.
    
    IMO Circ 289 - Notification that a fairway is closed.
    Fixed length: 472 bits (from bit 56)
    """
    bits = BitReader(data)
    
    return {
        "fid": 13,
        "description": "Fairway Closed",
        "reason": bits.get_string(0, 120),
        "location_from": bits.get_string(120, 120),
        "location_to": bits.get_string(240, 120),
        "radius": bits.get_uint(360, 10),
        "units": bits.get_uint(370, 2),  # 0=km, 1=nm, 2=m
        "day_from": bits.get_uint(372, 5),
        "month_from": bits.get_uint(377, 4),
        "hour_from": bits.get_uint(381, 5),
        "minute_from": bits.get_uint(386, 6),
        "day_to": bits.get_uint(392, 5),
        "month_to": bits.get_uint(397, 4),
        "hour_to": bits.get_uint(401, 5),
        "minute_to": bits.get_uint(406, 6),
    }


def decode_001_15(data: bytes) -> Dict[str, Any]:
    """
    FID 15: Extended Ship Static - Air Draught.
    
    IMO Circ 289 - Reports the height of the highest point.
    Fixed length: 72 bits (from bit 56)
    """
    bits = BitReader(data)
    
    return {
        "fid": 15,
        "description": "Extended Ship Static (Air Draught)",
        "air_draught_m": bits.get_uint(0, 11) / 10.0,
    }


def decode_001_16(data: bytes) -> Dict[str, Any]:
    """
    FID 16: Number of Persons on Board.
    
    IMO Circ 289 - Reports the number of persons on board.
    Fixed length: 72 bits (from bit 56)
    """
    bits = BitReader(data)
    
    return {
        "fid": 16,
        "description": "Number of Persons on Board",
        "persons": bits.get_uint(0, 13),
    }


def decode_001_17(data: bytes) -> Dict[str, Any]:
    """
    FID 17: VTS Generated/Synthetic Targets.
    
    IMO Circ 289 - Targets detected by VTS radar but not transmitting AIS.
    Variable length: 56 + N*120 bits, where N is 1-4 targets.
    """
    bits = BitReader(data)
    num_bits = len(data) * 8
    num_targets = num_bits // 120
    
    targets = []
    for i in range(min(num_targets, 4)):
        start = i * 120
        # Note: lat/lon in reverse order
        lat = bits.get_int(start + 48, 24) / 60000.0
        lon = bits.get_int(start + 72, 25) / 60000.0
        
        targets.append({
            "type": bits.get_uint(start, 2),
            "id": bits.get_string(start + 2, 42),
            "latitude": lat,
            "longitude": lon,
            "cog": bits.get_uint(start + 97, 9),
            "timestamp": bits.get_uint(start + 106, 6),
            "sog_kts": bits.get_uint(start + 112, 8),
        })
    
    return {
        "fid": 17,
        "description": "VTS Generated Targets",
        "targets": targets,
    }


def decode_001_19(data: bytes) -> Dict[str, Any]:
    """
    FID 19: Marine Traffic Signal.
    
    IMO Circ 289 - Traffic signal status at a waterway.
    Fixed length: 258 or 360 bits (from bit 56)
    """
    bits = BitReader(data)
    
    lon, lat = bits.get_position(130)
    
    return {
        "fid": 19,
        "description": "Marine Traffic Signal",
        "link_id": bits.get_uint(0, 10),
        "name": bits.get_string(10, 120),
        "longitude": lon,
        "latitude": lat,
        "status": bits.get_uint(179, 2),
        "signal": bits.get_uint(181, 5),
        "utc_hour_next": bits.get_uint(186, 5),
        "utc_min_next": bits.get_uint(191, 6),
        "next_signal": bits.get_uint(197, 5),
    }


def decode_001_21(data: bytes) -> Dict[str, Any]:
    """
    FID 21: Weather Observation Report from Ship.
    
    IMO Circ 289 - Two formats: type 0 (AIS) or type 1 (WMO).
    Fixed length: 360 bits (from bit 56)
    """
    bits = BitReader(data)
    type_wx = bits.get_bool(0)
    
    if not type_wx:
        # Type 0: AIS weather observation
        lon, lat = bits.get_position(121)
        return {
            "fid": 21,
            "description": "Weather Observation (AIS format)",
            "type": 0,
            "location": bits.get_string(1, 120),
            "longitude": lon,
            "latitude": lat,
            "day": bits.get_uint(170, 5),
            "hour": bits.get_uint(175, 5),
            "minute": bits.get_uint(180, 6),
            "wx_code": bits.get_uint(186, 4),
            "horz_visibility_nm": bits.get_uint(190, 8) / 10.0,
            "humidity_pct": bits.get_uint(198, 7),
            "wind_speed_kts": bits.get_uint(205, 7),
            "wind_dir": bits.get_uint(212, 9),
            "air_pressure_hpa": bits.get_uint(221, 9),
            "air_pressure_trend": bits.get_uint(230, 4),
            "air_temp_c": bits.get_int(234, 11) / 10.0,
            "water_temp_c": bits.get_uint(245, 10) / 10.0 - 10,
            "wave_period_s": bits.get_uint(255, 6),
            "wave_height_m": bits.get_uint(261, 8) / 10.0,
            "wave_dir": bits.get_uint(269, 9),
            "swell_height_m": bits.get_uint(278, 8) / 10.0,
            "swell_dir": bits.get_uint(286, 9),
            "swell_period_s": bits.get_uint(295, 6),
        }
    else:
        # Type 1: WMO weather observation
        lon = (bits.get_uint(1, 16) / 100.0) - 180
        lat = (bits.get_uint(17, 15) / 100.0) - 90
        return {
            "fid": 21,
            "description": "Weather Observation (WMO format)",
            "type": 1,
            "longitude": lon,
            "latitude": lat,
            "month": bits.get_uint(32, 4),
            "day": bits.get_uint(36, 6),
            "hour": bits.get_uint(42, 5),
            "minute": bits.get_uint(47, 3) * 10,
            "cog": bits.get_uint(50, 7) * 5,
            "sog_kts": bits.get_uint(57, 5) * 0.5,
            "heading": bits.get_uint(62, 7) * 5,
            "pressure_hpa": bits.get_uint(69, 11) / 10.0 + 900,
            "rel_pressure_hpa": bits.get_uint(80, 10) / 10.0 - 50,
            "pressure_trend": bits.get_uint(90, 4),
            "wind_dir": bits.get_uint(94, 7) * 5,
            "wind_speed_ms": bits.get_uint(101, 8) * 0.5,
            "wind_dir_rel": bits.get_uint(109, 7) * 5,
            "wind_speed_rel_ms": bits.get_uint(116, 8) * 0.5,
            "wind_gust_speed_ms": bits.get_uint(124, 8) * 0.5,
            "wind_gust_dir": bits.get_uint(132, 7) * 5,
            "air_temp_raw": bits.get_uint(139, 10),  # Kelvin offset
            "humidity_pct": bits.get_uint(149, 7),
            "water_temp_raw": bits.get_uint(156, 9),
            "wx_current": bits.get_uint(171, 9),
            "wx_past_1": bits.get_uint(180, 5),
            "wx_past_2": bits.get_uint(185, 5),
            "cloud_total_pct": bits.get_uint(190, 4) * 10,
            "cloud_low": bits.get_uint(194, 4),
            "cloud_low_type": bits.get_uint(198, 6),
            "cloud_middle_type": bits.get_uint(204, 6),
            "cloud_high_type": bits.get_uint(210, 6),
            "wave_period_s": bits.get_uint(223, 5),
            "wave_height_m": bits.get_uint(228, 6) * 0.5,
            "swell_dir": bits.get_uint(234, 6) * 10,
            "swell_period_s": bits.get_uint(240, 5),
            "swell_height_m": bits.get_uint(245, 6) * 0.5,
            "ice_thickness_m": bits.get_uint(268, 7) / 100.0,
            "ice_accretion": bits.get_uint(275, 3),
            "ice_accretion_cause": bits.get_uint(278, 3),
        }


def decode_001_22(data: bytes) -> Dict[str, Any]:
    """
    FID 22: Area Notice.
    
    IMO Circ 289 - Broadcast area notice (danger, caution, routing).
    Variable length: 143 + N*87 bits header + sub-areas.
    
    This is a complex message type with many sub-area shapes.
    For full implementation, see ais8_1_22.cpp in libais.
    """
    bits = BitReader(data)
    
    # Parse header
    result = {
        "fid": 22,
        "description": "Area Notice",
        "link_id": bits.get_uint(0, 10),
        "notice_type": bits.get_uint(10, 7),
        "month": bits.get_uint(17, 4),
        "day": bits.get_uint(21, 5),
        "hour": bits.get_uint(26, 5),
        "minute": bits.get_uint(31, 6),
        "duration_min": bits.get_uint(37, 18),
        "sub_areas": [],
    }
    
    # Sub-areas start at bit 87 (from the payload start)
    # Each sub-area is identified by a shape type
    # This is simplified - full implementation would decode each shape
    num_bits = len(data) * 8
    if num_bits > 87:
        sub_area_bits = num_bits - 87
        num_sub_areas = sub_area_bits // 87
        result["num_sub_areas"] = num_sub_areas
        result["sub_area_data_hex"] = data[11:].hex()  # Raw sub-area data
    
    return result


def decode_001_24(data: bytes) -> Dict[str, Any]:
    """
    FID 24: Extended Ship Static and Voyage Related Data.
    
    IMO Circ 289 - Additional static data about the vessel.
    Fixed length: 360 bits (from bit 56)
    """
    bits = BitReader(data)
    
    # SOLAS equipment status (26 items, 2 bits each)
    solas_status = []
    for i in range(26):
        solas_status.append(bits.get_uint(113 + i * 2, 2))
    
    return {
        "fid": 24,
        "description": "Extended Ship Static and Voyage",
        "link_id": bits.get_uint(0, 10),
        "air_draught_m": bits.get_uint(10, 13) / 10.0,
        "last_port": bits.get_string(23, 30),
        "next_port_1": bits.get_string(53, 30),
        "next_port_2": bits.get_string(83, 30),
        "solas_status": solas_status,
        "ice_class": bits.get_uint(165, 4),
        "shaft_power_hp": bits.get_uint(169, 18),
        "vhf_channel": bits.get_uint(187, 12),
        "lloyds_ship_type": bits.get_string(199, 42),
        "gross_tonnage": bits.get_uint(241, 18),
        "laden_ballast": bits.get_uint(259, 2),
        "heavy_oil": bits.get_uint(261, 2),
        "light_oil": bits.get_uint(263, 2),
        "diesel": bits.get_uint(265, 2),
        "bunker_oil_tonnes": bits.get_uint(267, 14),
        "persons": bits.get_uint(281, 13),
    }


def decode_001_27(data: bytes) -> Dict[str, Any]:
    """
    FID 27: Route Information (Recommended/Mandatory).
    
    IMO Circ 289 - Broadcast route with waypoints.
    Variable length: 117 + N*55 bits (N = 0-16 waypoints)
    """
    bits = BitReader(data)
    
    result = {
        "fid": 27,
        "description": "Route Information",
        "link_id": bits.get_uint(0, 10),
        "sender_type": bits.get_uint(10, 3),
        "route_type": bits.get_uint(13, 5),
        "month": bits.get_uint(18, 4),
        "day": bits.get_uint(22, 5),
        "hour": bits.get_uint(27, 5),
        "minute": bits.get_uint(32, 6),
        "duration_min": bits.get_uint(38, 18),
        "waypoints": [],
    }
    
    # Waypoints start at bit 61 (from payload start)
    num_bits = len(data) * 8
    num_waypoints = (num_bits - 61) // 55
    
    for i in range(min(num_waypoints, 16)):
        start = 61 + i * 55
        lon = bits.get_int(start, 28) / 600000.0
        lat = bits.get_int(start + 28, 27) / 600000.0
        result["waypoints"].append({
            "longitude": lon,
            "latitude": lat,
        })
    
    return result


def decode_001_29(data: bytes) -> Dict[str, Any]:
    """
    FID 29: Text Description (Broadcast).
    
    IMO Circ 289 - Free-form text associated with a link ID.
    Variable length: 72-1032 bits
    """
    bits = BitReader(data)
    num_bits = len(data) * 8
    
    # Text is 6-bit ASCII, as many characters as fit
    text_bits = ((num_bits - 10) // 6) * 6
    
    return {
        "fid": 29,
        "description": "Text Description",
        "link_id": bits.get_uint(0, 10),
        "text": bits.get_string(10, text_bits),
    }


def decode_001_31(data: bytes) -> Dict[str, Any]:
    """
    FID 31: Meteorological and Hydrological Data (IMO 289).
    
    Current standard for Met/Hydro data, replaces FID 11.
    Fixed length: 360 bits (from bit 56)
    """
    bits = BitReader(data)
    
    lon, lat = bits.get_position(0)
    
    return {
        "fid": 31,
        "description": "Met/Hydro (IMO 289)",
        "longitude": lon,
        "latitude": lat,
        "position_accuracy": bits.get_bool(49),
        "day": bits.get_uint(50, 5),
        "hour": bits.get_uint(55, 5),
        "minute": bits.get_uint(60, 6),
        "wind_ave_kts": bits.get_uint(66, 7),
        "wind_gust_kts": bits.get_uint(73, 7),
        "wind_dir": bits.get_uint(80, 9),
        "wind_gust_dir": bits.get_uint(89, 9),
        "air_temp_c": bits.get_int(98, 11) / 10.0,
        "rel_humidity_pct": bits.get_uint(109, 7),
        "dew_point_c": bits.get_int(116, 10) / 10.0,
        "air_pressure_hpa": (bits.get_uint(126, 9) + 800) / 100.0,
        "air_pressure_trend": bits.get_uint(135, 2),
        "horz_visibility_nm": bits.get_uint(137, 8) / 10.0,
        "water_level_m": bits.get_uint(145, 12) / 100.0 - 10,
        "water_level_trend": bits.get_uint(157, 2),
        "surf_cur_speed_kts": bits.get_uint(159, 8) / 10.0,
        "surf_cur_dir": bits.get_uint(167, 9),
        "cur_speed_2_kts": bits.get_uint(176, 8) / 10.0,
        "cur_dir_2": bits.get_uint(184, 9),
        "cur_depth_2_m": bits.get_uint(193, 5),
        "cur_speed_3_kts": bits.get_uint(198, 8) / 10.0,
        "cur_dir_3": bits.get_uint(206, 9),
        "cur_depth_3_m": bits.get_uint(215, 5),
        "wave_height_m": bits.get_uint(220, 8) / 10.0,
        "wave_period_s": bits.get_uint(228, 6),
        "wave_dir": bits.get_uint(234, 9),
        "swell_height_m": bits.get_uint(243, 8) / 10.0,
        "swell_period_s": bits.get_uint(251, 6),
        "swell_dir": bits.get_uint(257, 9),
        "sea_state_beaufort": bits.get_uint(266, 4),
        "water_temp_c": bits.get_int(270, 10) / 10.0,
        "precip_type": bits.get_uint(280, 3),
        "salinity_ppt": bits.get_uint(283, 9) / 10.0,
        "ice": bits.get_uint(292, 2),
    }
