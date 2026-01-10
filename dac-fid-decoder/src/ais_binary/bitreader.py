"""
Bit-level extraction utilities for AIS binary message payloads.

AIS binary payloads are packed bit fields. This module provides utilities
to extract unsigned integers, signed integers, and strings from arbitrary
bit positions within a byte array.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Tuple


@dataclass
class BitReader:
    """
    Read bits from a bytes object at arbitrary bit offsets.
    
    AIS binary messages pack fields at arbitrary bit boundaries, not aligned
    to bytes. This class handles the bit extraction.
    
    Example:
        >>> data = bytes.fromhex('DEADBEEF')
        >>> reader = BitReader(data)
        >>> reader.get_uint(0, 8)   # First 8 bits
        222
        >>> reader.get_uint(4, 8)   # 8 bits starting at bit 4
        234
    """
    data: bytes
    
    def __post_init__(self):
        self.num_bits = len(self.data) * 8
    
    def get_uint(self, offset: int, width: int) -> int:
        """
        Extract an unsigned integer from the bit stream.
        
        Args:
            offset: Starting bit position (0-indexed)
            width: Number of bits to extract (1-32)
            
        Returns:
            Unsigned integer value
        """
        if width == 0:
            return 0
        if offset + width > self.num_bits:
            raise ValueError(f"Bit range [{offset}:{offset+width}] exceeds data length ({self.num_bits} bits)")
        
        result = 0
        for i in range(width):
            bit_pos = offset + i
            byte_idx = bit_pos // 8
            bit_idx = 7 - (bit_pos % 8)  # MSB first
            if self.data[byte_idx] & (1 << bit_idx):
                result |= (1 << (width - 1 - i))
        return result
    
    def get_int(self, offset: int, width: int) -> int:
        """
        Extract a signed integer (two's complement) from the bit stream.
        
        Args:
            offset: Starting bit position (0-indexed)
            width: Number of bits to extract
            
        Returns:
            Signed integer value
        """
        val = self.get_uint(offset, width)
        # Check sign bit
        if val & (1 << (width - 1)):
            # Negative: convert from two's complement
            val -= (1 << width)
        return val
    
    def get_bool(self, offset: int) -> bool:
        """Extract a single bit as a boolean."""
        return self.get_uint(offset, 1) == 1
    
    def get_string(self, offset: int, width: int) -> str:
        """
        Extract an AIS 6-bit ASCII string from the bit stream.
        
        AIS uses a 6-bit character encoding where:
        - 0-31 map to '@' through '_' (ASCII 64-95)
        - 32-63 map to ' ' through '?' (ASCII 32-63)
        
        Args:
            offset: Starting bit position
            width: Number of bits (must be multiple of 6)
            
        Returns:
            Decoded string with trailing '@' and spaces stripped
        """
        if width % 6 != 0:
            raise ValueError(f"String width must be multiple of 6, got {width}")
        
        chars = []
        for i in range(width // 6):
            val = self.get_uint(offset + i * 6, 6)
            if val < 32:
                chars.append(chr(val + 64))  # '@' through '_'
            else:
                chars.append(chr(val))       # ' ' through '?'
        
        # Strip trailing '@' (null) and spaces
        return ''.join(chars).rstrip('@ ')
    
    def get_position(self, offset: int) -> Tuple[float, float]:
        """
        Extract a standard AIS position (lon/lat) from the bit stream.
        
        Standard format: 25 bits longitude, 24 bits latitude
        Both in 1/10000 minute resolution.
        
        Args:
            offset: Starting bit position
            
        Returns:
            Tuple of (longitude, latitude) in decimal degrees
        """
        lon = self.get_int(offset, 25) / 60000.0      # 25 bits, signed
        lat = self.get_int(offset + 25, 24) / 60000.0  # 24 bits, signed
        return (lon, lat)
    
    def get_position_28(self, offset: int) -> Tuple[float, float]:
        """
        Extract a 28-bit position (used in some messages).
        
        Format: 28 bits longitude, 27 bits latitude
        In 1/10000 minute resolution.
        """
        lon = self.get_int(offset, 28) / 600000.0
        lat = self.get_int(offset + 28, 27) / 600000.0
        return (lon, lat)


def bits_from_ais_payload(payload: str, pad: int = 0) -> bytes:
    """
    Convert an AIS armored payload string to bytes.
    
    AIS payloads use a 6-bit ASCII armor where each character
    represents 6 bits of data.
    
    Args:
        payload: The armored payload string (e.g., "177KQJ5000G?tO`K")
        pad: Number of padding bits in the last character
        
    Returns:
        Bytes containing the dearmored binary data
    """
    bits = []
    for char in payload:
        val = ord(char) - 48
        if val > 40:
            val -= 8
        # Extract 6 bits MSB first
        for i in range(5, -1, -1):
            bits.append((val >> i) & 1)
    
    # Remove padding bits
    if pad:
        bits = bits[:-pad]
    
    # Convert to bytes
    result = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(min(8, len(bits) - i)):
            byte = (byte << 1) | bits[i + j]
        # Pad last byte if needed
        remaining = len(bits) - i
        if remaining < 8:
            byte <<= (8 - remaining)
        result.append(byte)
    
    return bytes(result)
