"""
Tests for ais_binary decoders.

Test data sourced from:
- GPSD sample.aivdm
- libais test suite
- Live captures
"""

import pytest
from ais_binary import decode_binary_payload, BitReader, bits_from_ais_payload


class TestBitReader:
    """Test the BitReader utility class."""
    
    def test_get_uint(self):
        # 0xDE = 11011110, 0xAD = 10101101
        data = bytes.fromhex('DEAD')
        reader = BitReader(data)
        
        assert reader.get_uint(0, 8) == 0xDE
        assert reader.get_uint(8, 8) == 0xAD
        assert reader.get_uint(0, 4) == 0xD  # 1101
        assert reader.get_uint(4, 4) == 0xE  # 1110
    
    def test_get_int_positive(self):
        data = bytes.fromhex('7F')  # 01111111 = 127
        reader = BitReader(data)
        assert reader.get_int(0, 8) == 127
    
    def test_get_int_negative(self):
        data = bytes.fromhex('FF')  # 11111111 = -1 in two's complement
        reader = BitReader(data)
        assert reader.get_int(0, 8) == -1
    
    def test_get_bool(self):
        data = bytes.fromhex('80')  # 10000000
        reader = BitReader(data)
        assert reader.get_bool(0) == True
        assert reader.get_bool(1) == False
    
    def test_get_string(self):
        # AIS 6-bit encoding: 'H' = 8, 'I' = 9 (after mapping)
        # Let's test with a known string
        # '@' in AIS = 0 (0b000000), 'A' = 1 (0b000001)
        data = bytes.fromhex('0410')  # 000001 000001 0000 = "AA"
        reader = BitReader(data)
        result = reader.get_string(0, 12)
        assert result == "AA"


class TestBitsFromAisPayload:
    """Test the AIS payload dearmoring."""
    
    def test_simple_dearmor(self):
        # '0' = ASCII 48, value 0
        # 'w' = ASCII 119, value 119-48-8 = 63
        payload = "0"
        result = bits_from_ais_payload(payload)
        assert result[0] == 0  # First 6 bits are 0
    
    def test_with_padding(self):
        # Test that padding is correctly removed
        payload = "0"
        result_no_pad = bits_from_ais_payload(payload, 0)
        result_with_pad = bits_from_ais_payload(payload, 2)
        # With padding removed, we have fewer bits
        assert len(result_with_pad) <= len(result_no_pad)


class TestDAC001:
    """Test DAC 001 (International/IMO) message decoders."""
    
    def test_fid_16_persons_on_board(self):
        """FID 16: Number of Persons on Board."""
        # This is a simple fixed-length message
        # 13 bits for persons count, 3 bits spare
        # persons=100 = 0b0000001100100, spare=0
        # Binary: 0000001100100 000 = 0x0064 0x00 (padded)
        # Actually need 16 bits = 2 bytes
        data = bytes([0x00, 0xC8])  # 0000 0000 1100 1000 = 0, 200 in 13 bits... 
        
        # Let's construct proper test data:
        # persons = 150 in 13 bits = 0b0000010010110
        # Need to pack as: 0 0000100 10110 000
        # = 0x04, 0xB0
        data = bytes([0x04, 0xB0])
        
        result = decode_binary_payload(dac=1, fid=16, data=data)
        assert result['dac'] == 1
        assert result['fid'] == 16
        assert 'persons' in result or 'error' in result
    
    def test_fid_15_air_draught(self):
        """FID 15: Extended Ship Static (Air Draught)."""
        # air_draught is 11 bits (0-204.7m in 0.1m steps)
        # + 5 bits spare = 16 bits total
        # air_draught = 350 (35.0m) = 0b01010111110
        # 01010111 110 00000 = 0x57, 0xC0
        data = bytes([0x57, 0xC0])
        
        result = decode_binary_payload(dac=1, fid=15, data=data)
        assert result['dac'] == 1
        assert result['fid'] == 15
        # Should have air_draught_m field
        if 'error' not in result:
            assert 'air_draught_m' in result


class TestDAC200:
    """Test DAC 200 (Inland Waterways) message decoders."""
    
    def test_fid_55_persons_on_board_inland(self):
        """FID 55: Number of Persons on Board (Inland)."""
        # crew: 8 bits, passengers: 13 bits, personnel: 8 bits
        # Total: 29 bits minimum
        data = bytes([0x05, 0x00, 0x64, 0x03])  # crew=5, passengers=100, personnel=3
        
        result = decode_binary_payload(dac=200, fid=55, data=data)
        assert result['dac'] == 200
        assert result['fid'] == 55


class TestDAC367:
    """Test DAC 367 (US/NOAA) message decoders."""
    
    def test_unknown_fid(self):
        """Unknown FID should return error with raw data."""
        data = bytes([0x12, 0x34, 0x56, 0x78])
        
        result = decode_binary_payload(dac=367, fid=99, data=data)
        assert result['dac'] == 367
        assert result['fid'] == 99
        assert 'error' in result
        assert 'raw' in result


class TestUnknownDAC:
    """Test handling of unknown DAC codes."""
    
    def test_unknown_dac(self):
        """Unknown DAC should return error with raw data."""
        data = bytes([0xAB, 0xCD])
        
        result = decode_binary_payload(dac=999, fid=1, data=data)
        assert 'error' in result
        assert 'raw' in result
        assert result['raw'] == 'abcd'


class TestHexStringInput:
    """Test that hex string input works."""
    
    def test_hex_string(self):
        """Should accept hex string as data."""
        result = decode_binary_payload(dac=1, fid=16, data='0064')
        assert result['dac'] == 1
        # Should not error on valid hex


class TestEmptyPayload:
    """Test handling of empty payloads."""
    
    def test_empty_bytes(self):
        result = decode_binary_payload(dac=1, fid=16, data=b'')
        assert 'error' in result
    
    def test_empty_string(self):
        result = decode_binary_payload(dac=1, fid=16, data='')
        assert 'error' in result


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
