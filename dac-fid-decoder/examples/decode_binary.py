#!/usr/bin/env python3
"""
Example: Using ais_binary with pyais to decode binary messages.

Run with: python examples/decode_binary.py
"""

from pyais import decode
from ais_binary import decode_binary_payload


def main():
    # Example AIS sentences with binary payloads
    # These are Type 8 (Binary Broadcast) messages
    
    test_messages = [
        # Fake DAC 1 FID 16 - Number of persons on board
        # (In practice you'd get these from AIS-catcher or rtl_ais)
    ]
    
    # Direct decoder test with known data
    print("=== Testing Binary Decoders ===\n")
    
    # DAC 1 FID 16: Number of Persons on Board
    # 150 persons = 0b0000010010110 (13 bits) + 3 spare bits
    # = 0x04B0 when packed
    print("DAC 1 FID 16 (Number of Persons on Board):")
    result = decode_binary_payload(dac=1, fid=16, data=bytes([0x04, 0xB0]))
    for k, v in result.items():
        print(f"  {k}: {v}")
    
    print("\nDAC 1 FID 15 (Air Draught):")
    # 35.0m = 350 in 0.1m units = 0b01010111110 (11 bits) + 5 spare
    result = decode_binary_payload(dac=1, fid=15, data=bytes([0x57, 0xC0]))
    for k, v in result.items():
        print(f"  {k}: {v}")
    
    print("\n=== Integration with pyais ===\n")
    print("To use with live data from AIS-catcher:\n")
    print("""
from pyais import decode
from ais_binary import decode_binary_payload

# Process NMEA sentences from AIS-catcher
sentence = "!AIVDM,1,1,,B,85MsUdPOj8..."
msg = decode(sentence)
d = msg.asdict()

if d['msg_type'] in (6, 8):  # Binary messages
    decoded = decode_binary_payload(
        dac=d['dac'],
        fid=d['fid'],
        data=d['data']
    )
    print(decoded)
""")


if __name__ == '__main__':
    main()
