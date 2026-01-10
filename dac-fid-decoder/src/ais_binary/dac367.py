"""
DAC 367 - US (NOAA/Coast Guard) binary message decoders.

Implements decoders for US-specific AIS messages, primarily used
for environmental monitoring and area notices.

References:
- USCG PAWSS (Ports and Waterways Safety System)
- https://gpsd.gitlab.io/gpsd/AIVDM.html
- libais ais8_367.cpp
"""

from __future__ import annotations
from typing import Dict, Any, List
from .bitreader import BitReader


# Environmental report types for FID 33
REPORT_TYPES = {
    0: "Location",
    1: "Wind",
    2: "Water Level",
    3: "Current 2D",
    4: "Current 3D",
    5: "Horizontal Current 2D",
    6: "Horizontal Current 3D",
    7: "Sea State",
    8: "Salinity",
    9: "Weather",
    10: "Air Gap",
    11: "Air Pressure",
    12: "Ice",
}


def decode_dac367(fid: int, data: bytes) -> Dict[str, Any]:
    """
    Dispatch to the appropriate DAC 367 FID decoder.
    """
    decoders = {
        22: decode_367_22,  # Area Notice (US version)
        33: decode_367_33,  # Environmental/weather sensor reports
    }
    
    decoder = decoders.get(fid)
    if decoder is None:
        return {"error": f"Unknown DAC 367 FID {fid}", "raw": data.hex()}
    
    try:
        return decoder(data)
    except Exception as e:
        return {"error": str(e), "fid": fid, "raw": data.hex()}


def decode_367_22(data: bytes) -> Dict[str, Any]:
    """
    FID 22: Area Notice (US Version).
    
    Similar to DAC 001 FID 22 but with US-specific notice types.
    Variable length: 88 + N*90 bits for sub-areas.
    """
    bits = BitReader(data)
    
    result = {
        "fid": 22,
        "description": "Area Notice (US)",
        "version": bits.get_uint(0, 6),
        "link_id": bits.get_uint(6, 10),
        "notice_type": bits.get_uint(16, 7),
        "month": bits.get_uint(23, 4),
        "day": bits.get_uint(27, 5),
        "hour": bits.get_uint(32, 5),
        "minute": bits.get_uint(37, 6),
        "duration_min": bits.get_uint(43, 18),
        "sub_areas": [],
    }
    
    # Parse sub-areas (each 90 bits)
    offset = 61  # After header
    num_bits = len(data) * 8
    
    while offset + 90 <= num_bits:
        area_shape = bits.get_uint(offset, 3)
        sub_area = {"shape": area_shape}
        
        if area_shape == 0:  # Circle/point
            sub_area["scale_factor"] = bits.get_uint(offset + 3, 2)
            lon = bits.get_int(offset + 5, 25) / 60000.0
            lat = bits.get_int(offset + 30, 24) / 60000.0
            sub_area["longitude"] = lon
            sub_area["latitude"] = lat
            sub_area["precision"] = bits.get_uint(offset + 54, 3)
            sub_area["radius_m"] = bits.get_uint(offset + 57, 12)
            
        elif area_shape == 1:  # Rectangle
            sub_area["scale_factor"] = bits.get_uint(offset + 3, 2)
            lon = bits.get_int(offset + 5, 25) / 60000.0
            lat = bits.get_int(offset + 30, 24) / 60000.0
            sub_area["longitude"] = lon
            sub_area["latitude"] = lat
            sub_area["precision"] = bits.get_uint(offset + 54, 3)
            sub_area["e_dim_m"] = bits.get_uint(offset + 57, 8)
            sub_area["n_dim_m"] = bits.get_uint(offset + 65, 8)
            sub_area["orientation"] = bits.get_uint(offset + 73, 9)
            
        elif area_shape == 2:  # Sector
            sub_area["scale_factor"] = bits.get_uint(offset + 3, 2)
            lon = bits.get_int(offset + 5, 25) / 60000.0
            lat = bits.get_int(offset + 30, 24) / 60000.0
            sub_area["longitude"] = lon
            sub_area["latitude"] = lat
            sub_area["precision"] = bits.get_uint(offset + 54, 3)
            sub_area["radius_m"] = bits.get_uint(offset + 57, 12)
            sub_area["left_bound"] = bits.get_uint(offset + 69, 9)
            sub_area["right_bound"] = bits.get_uint(offset + 78, 9)
            
        elif area_shape == 3:  # Polyline (waypoint)
            sub_area["scale_factor"] = bits.get_uint(offset + 3, 2)
            sub_area["angle_1"] = bits.get_uint(offset + 5, 10)
            sub_area["dist_1"] = bits.get_uint(offset + 15, 10)
            sub_area["angle_2"] = bits.get_uint(offset + 25, 10)
            sub_area["dist_2"] = bits.get_uint(offset + 35, 10)
            sub_area["angle_3"] = bits.get_uint(offset + 45, 10)
            sub_area["dist_3"] = bits.get_uint(offset + 55, 10)
            sub_area["angle_4"] = bits.get_uint(offset + 65, 10)
            sub_area["dist_4"] = bits.get_uint(offset + 75, 10)
            
        elif area_shape == 4:  # Polygon (waypoint)
            # Same as polyline but closed
            sub_area["scale_factor"] = bits.get_uint(offset + 3, 2)
            sub_area["angle_1"] = bits.get_uint(offset + 5, 10)
            sub_area["dist_1"] = bits.get_uint(offset + 15, 10)
            sub_area["angle_2"] = bits.get_uint(offset + 25, 10)
            sub_area["dist_2"] = bits.get_uint(offset + 35, 10)
            sub_area["angle_3"] = bits.get_uint(offset + 45, 10)
            sub_area["dist_3"] = bits.get_uint(offset + 55, 10)
            sub_area["angle_4"] = bits.get_uint(offset + 65, 10)
            sub_area["dist_4"] = bits.get_uint(offset + 75, 10)
            
        elif area_shape == 5:  # Text
            text_bits = 84  # 14 characters * 6 bits
            sub_area["text"] = bits.get_string(offset + 3, text_bits)
            
        else:
            sub_area["raw"] = hex(bits.get_uint(offset + 3, 87))
        
        result["sub_areas"].append(sub_area)
        offset += 90
    
    return result


def decode_367_33(data: bytes) -> Dict[str, Any]:
    """
    FID 33: Environmental/Weather Sensor Reports.
    
    Multi-sensor environmental data broadcast.
    Variable length: header + N report blocks.
    
    This is a complex message with multiple sensor report types.
    """
    bits = BitReader(data)
    
    result = {
        "fid": 33,
        "description": "Environmental Sensor Reports (US)",
        "reports": [],
    }
    
    # There's a location header for some versions
    num_bits = len(data) * 8
    offset = 0
    
    # Parse reports until we run out of bits
    while offset + 27 <= num_bits:  # Minimum report size
        report_type = bits.get_uint(offset, 4)
        report_type_name = REPORT_TYPES.get(report_type, f"Unknown ({report_type})")
        
        report = {
            "type": report_type,
            "type_name": report_type_name,
        }
        
        if report_type == 0:  # Location
            report["version"] = bits.get_uint(offset + 4, 6)
            lon = bits.get_int(offset + 10, 28) / 600000.0
            lat = bits.get_int(offset + 38, 27) / 600000.0
            report["longitude"] = lon
            report["latitude"] = lat
            report["precision"] = bits.get_uint(offset + 65, 4)
            report["altitude_m"] = bits.get_int(offset + 69, 12) / 10.0
            report["owner"] = bits.get_uint(offset + 81, 4)
            report["timeout"] = bits.get_uint(offset + 85, 3)
            offset += 88
            
        elif report_type == 1:  # Wind
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["wind_speed_kts"] = bits.get_uint(offset + 27, 7)
            report["wind_gust_kts"] = bits.get_uint(offset + 34, 7)
            report["wind_dir"] = bits.get_uint(offset + 41, 9)
            report["wind_gust_dir"] = bits.get_uint(offset + 50, 9)
            report["sensor_type"] = bits.get_uint(offset + 59, 3)
            report["forecast_wind_speed_kts"] = bits.get_uint(offset + 62, 7)
            report["forecast_wind_gust_kts"] = bits.get_uint(offset + 69, 7)
            report["forecast_wind_dir"] = bits.get_uint(offset + 76, 9)
            report["forecast_day"] = bits.get_uint(offset + 85, 5)
            report["forecast_hour"] = bits.get_uint(offset + 90, 5)
            report["forecast_minute"] = bits.get_uint(offset + 95, 6)
            report["duration_min"] = bits.get_uint(offset + 101, 8)
            offset += 109
            
        elif report_type == 2:  # Water Level
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["level_type"] = bits.get_uint(offset + 27, 3)
            report["level_m"] = bits.get_int(offset + 30, 16) / 100.0
            report["trend"] = bits.get_uint(offset + 46, 2)
            report["datum"] = bits.get_uint(offset + 48, 5)
            report["sensor_type"] = bits.get_uint(offset + 53, 3)
            report["forecast_type"] = bits.get_uint(offset + 56, 3)
            report["forecast_day"] = bits.get_uint(offset + 59, 5)
            report["forecast_hour"] = bits.get_uint(offset + 64, 5)
            report["forecast_minute"] = bits.get_uint(offset + 69, 6)
            report["duration_min"] = bits.get_uint(offset + 75, 8)
            offset += 83
            
        elif report_type == 3:  # Current 2D
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["cur_speed_kts"] = bits.get_uint(offset + 27, 8) / 10.0
            report["cur_dir"] = bits.get_uint(offset + 35, 9)
            report["cur_depth_m"] = bits.get_uint(offset + 44, 9)
            offset += 53
            
        elif report_type == 7:  # Sea State
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["swell_height_m"] = bits.get_uint(offset + 27, 8) / 10.0
            report["swell_period_s"] = bits.get_uint(offset + 35, 6)
            report["swell_dir"] = bits.get_uint(offset + 41, 9)
            report["sea_state_beaufort"] = bits.get_uint(offset + 50, 4)
            report["swell_sensor_type"] = bits.get_uint(offset + 54, 3)
            report["water_temp_c"] = bits.get_int(offset + 57, 10) / 10.0
            report["water_temp_depth_m"] = bits.get_uint(offset + 67, 7) / 10.0
            report["water_sensor_type"] = bits.get_uint(offset + 74, 3)
            report["wave_height_m"] = bits.get_uint(offset + 77, 8) / 10.0
            report["wave_period_s"] = bits.get_uint(offset + 85, 6)
            report["wave_dir"] = bits.get_uint(offset + 91, 9)
            report["wave_sensor_type"] = bits.get_uint(offset + 100, 3)
            report["salinity_ppt"] = bits.get_uint(offset + 103, 9) / 10.0
            offset += 112
            
        elif report_type == 8:  # Salinity
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["water_temp_c"] = bits.get_int(offset + 27, 10) / 10.0
            report["conductivity"] = bits.get_uint(offset + 37, 10) / 100.0
            report["pressure_dbar"] = bits.get_uint(offset + 47, 16) / 10.0
            report["salinity_ppt"] = bits.get_uint(offset + 63, 9) / 10.0
            report["salinity_type"] = bits.get_uint(offset + 72, 2)
            report["sensor_type"] = bits.get_uint(offset + 74, 3)
            offset += 77
            
        elif report_type == 9:  # Weather
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["air_temp_c"] = bits.get_int(offset + 27, 11) / 10.0
            report["air_temp_sensor"] = bits.get_uint(offset + 38, 3)
            report["precip_type"] = bits.get_uint(offset + 41, 3)
            report["visibility_nm"] = bits.get_uint(offset + 44, 8) / 10.0
            report["dew_point_c"] = bits.get_int(offset + 52, 10) / 10.0
            report["dew_sensor"] = bits.get_uint(offset + 62, 3)
            report["air_pressure_hpa"] = bits.get_uint(offset + 65, 9) + 800
            report["pressure_trend"] = bits.get_uint(offset + 74, 2)
            report["pressure_sensor"] = bits.get_uint(offset + 76, 3)
            report["salinity_ppt"] = bits.get_uint(offset + 79, 9) / 10.0
            offset += 88
            
        elif report_type == 10:  # Air Gap
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["air_draught_m"] = bits.get_uint(offset + 27, 13) / 10.0
            report["air_gap_m"] = bits.get_uint(offset + 40, 13) / 10.0
            report["air_gap_trend"] = bits.get_uint(offset + 53, 2)
            report["predicted_air_gap_m"] = bits.get_uint(offset + 55, 13) / 10.0
            report["forecast_day"] = bits.get_uint(offset + 68, 5)
            report["forecast_hour"] = bits.get_uint(offset + 73, 5)
            report["forecast_minute"] = bits.get_uint(offset + 78, 6)
            offset += 84
            
        elif report_type == 11:  # Air Pressure
            report["day"] = bits.get_uint(offset + 4, 5)
            report["hour"] = bits.get_uint(offset + 9, 5)
            report["minute"] = bits.get_uint(offset + 14, 6)
            report["site_id"] = bits.get_uint(offset + 20, 7)
            report["air_pressure_hpa"] = bits.get_uint(offset + 27, 9) + 800
            report["pressure_trend"] = bits.get_uint(offset + 36, 2)
            report["sensor_type"] = bits.get_uint(offset + 38, 3)
            report["forecast_pressure"] = bits.get_uint(offset + 41, 9) + 800
            report["forecast_day"] = bits.get_uint(offset + 50, 5)
            report["forecast_hour"] = bits.get_uint(offset + 55, 5)
            report["forecast_minute"] = bits.get_uint(offset + 60, 6)
            report["duration_min"] = bits.get_uint(offset + 66, 8)
            offset += 74
            
        else:
            # Unknown report type, skip remaining
            report["raw_remaining"] = data[offset // 8:].hex()
            result["reports"].append(report)
            break
        
        result["reports"].append(report)
    
    return result
