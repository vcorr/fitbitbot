"""
Heart Rate Variability (HRV) endpoint.
Fetches HRV data.
"""
import json
from datetime import datetime
from pathlib import Path

import requests

BASE_URL = "https://api.fitbit.com"
OUTPUT_DIR = Path(__file__).parent.parent / "output"


def fetch(access_token):
    """
    Fetch HRV data for today.

    Args:
        access_token: Fitbit API access token

    Returns:
        dict with 'status', 'data', and 'fields' keys
    """
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"{BASE_URL}/1/user/-/hrv/date/{today}.json"

    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            data = response.json()

            # Save to file
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            filename = OUTPUT_DIR / f"hrv_{datetime.now().strftime('%Y%m%d')}.json"
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
    """Extract available fields from HRV data."""
    fields = []

    if "hrv" in data and data["hrv"]:
        hrv_entry = data["hrv"][0]

        if "value" in hrv_entry:
            value = hrv_entry["value"]

            if "dailyRmssd" in value:
                fields.append(f"dailyRmssd: {value['dailyRmssd']:.2f}")
            if "deepRmssd" in value:
                fields.append(f"deepRmssd: {value['deepRmssd']:.2f}")

        if "dateTime" in hrv_entry:
            fields.append(f"date: {hrv_entry['dateTime']}")
    else:
        fields.append("No HRV data available")

    return fields
