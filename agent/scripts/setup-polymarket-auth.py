#!/usr/bin/env python3
"""
Polymarket API Key Setup Script

This script derives API credentials from your wallet private key.
Run this locally and add the output to your .env file.

Usage:
    pip install py-clob-client
    python3 scripts/setup-polymarket-auth.py
"""

import getpass
import sys

try:
    from py_clob_client.client import ClobClient
except ImportError:
    print("Error: py-clob-client not installed")
    print("Run: pip install py-clob-client")
    sys.exit(1)

def main():
    print("=" * 50)
    print("Polymarket API Key Setup")
    print("=" * 50)
    print()
    print("This will derive API credentials from your wallet.")
    print("Your private key is NOT sent anywhere - it's only used locally.")
    print()

    # Get private key securely (hidden input)
    private_key = getpass.getpass("Enter your wallet private key: ")

    if not private_key:
        print("No private key provided. Exiting.")
        sys.exit(1)

    # Add 0x prefix if missing
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    print()
    print("Deriving API credentials...")

    try:
        client = ClobClient(
            host="https://clob.polymarket.com",
            key=private_key,
            chain_id=137  # Polygon mainnet
        )

        # Derive API credentials
        creds = client.derive_api_key()

        print()
        print("=" * 50)
        print("SUCCESS! Add these to your .env file:")
        print("=" * 50)
        print()
        print(f"POLYMARKET_API_KEY={creds.api_key}")
        print(f"POLYMARKET_API_SECRET={creds.api_secret}")
        print(f"POLYMARKET_PASSPHRASE={creds.api_passphrase}")
        print()
        print("# Also add your private key if you want auto-trading:")
        print(f"# POLYMARKET_PRIVATE_KEY={private_key}")
        print()
        print("=" * 50)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
