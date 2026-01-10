"""
ais_binary - AIS binary message decoder for pyais.

This module decodes the DAC/FID-specific binary payloads that pyais
extracts from AIS message types 6, 8, 25, and 26.

Usage:
    from pyais import decode
    from ais_binary import decode_binary_payload
    
    msg = decode("!AIVDM,1,1,,B,8...").asdict()
    if msg['type'] in (6, 8, 25, 26):
        decoded = decode_binary_payload(
            dac=msg['dac'],
            fid=msg['fid'],
            data=msg['data']
        )
"""

from __future__ import annotations
from typing import Dict, Any, Union

from .bitreader import BitReader, bits_from_ais_payload
from .dac001 import decode_dac001
from .dac200 import decode_dac200
from .dac367 import decode_dac367


__version__ = "0.1.0"
__all__ = [
    "decode_binary_payload",
    "BitReader",
    "bits_from_ais_payload",
]


# DAC 366 uses the same decoders as 367 (US regional)
# DAC 316 (Canada) also uses similar formats for St. Lawrence Seaway


def decode_binary_payload(
    dac: int,
    fid: int,
    data: Union[bytes, str],
    *,
    pad: int = 0,
) -> Dict[str, Any]:
    """
    Decode an AIS binary message payload.
    
    Args:
        dac: Designated Area Code (regional authority)
        fid: Functional ID (message subtype within DAC)
        data: Binary payload as bytes or hex string
        pad: Number of padding bits (if data is armored string)
        
    Returns:
        Dictionary with decoded message fields.
        On error, returns {"error": "...", "raw": "..."}.
        
    Example:
        >>> from pyais import decode
        >>> msg = decode("!AIVDM,1,1,,B,85MsUdPOj8...").asdict()
        >>> decoded = decode_binary_payload(
        ...     dac=msg['dac'],
        ...     fid=msg['fid'],
        ...     data=msg['data']
        ... )
    """
    # Convert hex string to bytes if needed
    if isinstance(data, str):
        try:
            data = bytes.fromhex(data)
        except ValueError:
            # Might be armored payload, try to dearmor
            data = bits_from_ais_payload(data, pad)
    
    # Validate we have data
    if not data:
        return {"error": "Empty payload", "dac": dac, "fid": fid}
    
    # Add common metadata
    result = {"dac": dac, "fid": fid}
    
    # Dispatch to appropriate DAC decoder
    try:
        if dac == 1:
            decoded = decode_dac001(fid, data)
        elif dac == 200:
            decoded = decode_dac200(fid, data)
        elif dac in (366, 367):
            # US regional (USCG, NOAA)
            decoded = decode_dac367(fid, data)
        elif dac == 316:
            # Canada - often uses same formats as US
            decoded = decode_dac367(fid, data)
        elif dac in (235, 250):
            # UK (235) and Ireland (250) - some specific messages
            # Fall back to raw for now
            decoded = {
                "error": f"DAC {dac} not fully implemented",
                "raw": data.hex(),
            }
        else:
            decoded = {
                "error": f"Unknown DAC {dac}",
                "raw": data.hex(),
            }
    except Exception as e:
        decoded = {
            "error": f"Decode error: {e}",
            "raw": data.hex(),
        }
    
    result.update(decoded)
    return result


def decode_msg6(msg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to decode a Type 6 (Addressed Binary) message.
    
    Args:
        msg: Message dictionary from pyais with 'dac', 'fid', and 'data' keys
        
    Returns:
        Decoded message fields
    """
    return decode_binary_payload(
        dac=msg.get('dac', 0),
        fid=msg.get('fid', 0),
        data=msg.get('data', b''),
    )


def decode_msg8(msg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to decode a Type 8 (Broadcast Binary) message.
    
    Args:
        msg: Message dictionary from pyais with 'dac', 'fid', and 'data' keys
        
    Returns:
        Decoded message fields
    """
    return decode_binary_payload(
        dac=msg.get('dac', 0),
        fid=msg.get('fid', 0),
        data=msg.get('data', b''),
    )
