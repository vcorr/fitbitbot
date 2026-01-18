#!/usr/bin/env python3
"""
Fitbit API Explorer project

Explores available data from the Fitbit API across multiple endpoints.
"""
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from auth import authenticate
from endpoints import ALL_ENDPOINTS


def print_header():
    """Print application header."""
    print("=" * 60)
    print("  Fitbit API Explorer")
    print("=" * 60)
    print()


def print_summary_table(results):
    """Print a summary table of endpoint results."""
    print("\n" + "=" * 60)
    print("  Summary")
    print("=" * 60)

    # Calculate column widths
    name_width = max(len(name) for name, _ in results) + 2
    status_width = 10

    # Header
    print(f"\n{'Endpoint':<{name_width}} {'Status':<{status_width}} Fields")
    print("-" * 60)

    # Results
    for name, result in results:
        status = result.get("status", "unknown")
        if status == "success":
            status_str = "OK"
            fields = result.get("fields", [])
            if fields:
                # Show first few fields, truncate if too many
                if len(fields) <= 3:
                    fields_str = ", ".join(fields)
                else:
                    fields_str = ", ".join(fields[:3]) + f" (+{len(fields)-3} more)"
            else:
                fields_str = "No fields"
        else:
            status_str = "ERROR"
            fields_str = result.get("message", "Unknown error")

        print(f"{name:<{name_width}} {status_str:<{status_width}} {fields_str}")

    print("-" * 60)

    # Count successes
    success_count = sum(1 for _, r in results if r.get("status") == "success")
    print(f"\n{success_count}/{len(results)} endpoints returned data successfully")
    print(f"JSON files saved to: {Path(__file__).parent / 'output'}")


def main():
    """Main entry point."""
    print_header()

    # Authenticate
    print("Step 1: Authentication")
    print("-" * 40)
    access_token = authenticate()

    if not access_token:
        print("\nAuthentication failed. Please check your credentials.")
        sys.exit(1)

    print()

    # Fetch from all endpoints
    print("Step 2: Fetching data from endpoints")
    print("-" * 40)

    results = []
    for name, module in ALL_ENDPOINTS:
        print(f"  Fetching {name}...", end=" ", flush=True)
        result = module.fetch(access_token)
        status = result.get("status", "unknown")

        if status == "success":
            print("OK")
        else:
            print(f"Error: {result.get('message', 'Unknown')}")

        results.append((name, result))

    # Print summary
    print_summary_table(results)


if __name__ == "__main__":
    main()
