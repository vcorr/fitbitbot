"""
Heart rate data endpoint.
Fetches resting HR, zones, and intraday data.
"""
import json
from datetime import datetime
from pathlib import Path

import requests

BASE_URL = "https://api.fitbit.com"
OUTPUT_DIR = Path(__file__).parent.parent / "output"


def fetch(access_token):
    """
    Fetch heart rate data for today.

    Args:
        access_token: Fitbit API access token

    Returns:
        dict with 'status', 'data', and 'fields' keys
    """
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"{BASE_URL}/1/user/-/activities/heart/date/{today}/1d.json"

    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            data = response.json()

            # Save to file
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            filename = OUTPUT_DIR / f"heart_rate_{datetime.now().strftime('%Y%m%d')}.json"
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
    """Extract available fields from heart rate data."""
    fields = []

    if "activities-heart" in data and data["activities-heart"]:
        hr_data = data["activities-heart"][0]

        if "value" in hr_data:
            value = hr_data["value"]

            # Resting heart rate
            if "restingHeartRate" in value:
                fields.append(f"restingHeartRate: {value['restingHeartRate']}")

            # Heart rate zones
            if "heartRateZones" in value:
                zones = value["heartRateZones"]
                zone_names = [z.get("name", "Unknown") for z in zones]
                fields.append(f"zones: {', '.join(zone_names)}")

    # Intraday data (requires Personal app type)
    if "activities-heart-intraday" in data:
        intraday = data["activities-heart-intraday"]
        if "dataset" in intraday and intraday["dataset"]:
            fields.append(f"intraday: {len(intraday['dataset'])} data points")

    return fields
