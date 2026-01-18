"""
Breathing rate endpoint.
Fetches breathing rate data.
"""
import json
from datetime import datetime
from pathlib import Path

import requests

BASE_URL = "https://api.fitbit.com"
OUTPUT_DIR = Path(__file__).parent.parent / "output"


def fetch(access_token):
    """
    Fetch breathing rate data for today.

    Args:
        access_token: Fitbit API access token

    Returns:
        dict with 'status', 'data', and 'fields' keys
    """
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"{BASE_URL}/1/user/-/br/date/{today}.json"

    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            data = response.json()

            # Save to file
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            filename = OUTPUT_DIR / f"breathing_{datetime.now().strftime('%Y%m%d')}.json"
            with open(filename, "w") as f:
                json.dump(data, f, indent=2)

            # Extract available fields
            fields = extract_fields(data)

            return {
                "status": "success",
                "data": data,
                "fields": fields,
                "file": str(filename),
            }
        elif response.status_code == 401:
            return {"status": "error", "message": "Unauthorized - token may be expired"}
        elif response.status_code == 403:
            return {"status": "error", "message": "Forbidden - scope not authorized"}
        else:
            return {"status": "error", "message": f"HTTP {response.status_code}: {response.text}"}

    except requests.RequestException as e:
        return {"status": "error", "message": str(e)}


def extract_fields(data):
    """Extract available fields from breathing rate data."""
    fields = []

    if "br" in data and data["br"]:
        br_entry = data["br"][0]

        if "value" in br_entry:
            value = br_entry["value"]
            if "breathingRate" in value:
                fields.append(f"breathingRate: {value['breathingRate']:.1f} breaths/min")

        if "dateTime" in br_entry:
            fields.append(f"date: {br_entry['dateTime']}")
    else:
        fields.append("No breathing rate data available")

    return fields
