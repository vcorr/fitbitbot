"""
SpO2 (Blood Oxygen Saturation) endpoint.
Fetches oxygen saturation data.
"""
import json
from datetime import datetime
from pathlib import Path

import requests

BASE_URL = "https://api.fitbit.com"
OUTPUT_DIR = Path(__file__).parent.parent / "output"


def fetch(access_token):
    """
    Fetch SpO2 data for today.

    Args:
        access_token: Fitbit API access token

    Returns:
        dict with 'status', 'data', and 'fields' keys
    """
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"{BASE_URL}/1/user/-/spo2/date/{today}.json"

    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            data = response.json()

            # Save to file
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            filename = OUTPUT_DIR / f"spo2_{datetime.now().strftime('%Y%m%d')}.json"
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
    """Extract available fields from SpO2 data."""
    fields = []

    # Check for daily average
    if "value" in data:
        value = data["value"]
        if "avg" in value:
            fields.append(f"avg: {value['avg']}%")
        if "min" in value:
            fields.append(f"min: {value['min']}%")
        if "max" in value:
            fields.append(f"max: {value['max']}%")

    if "dateTime" in data:
        fields.append(f"date: {data['dateTime']}")

    if not fields:
        fields.append("No SpO2 data available")

    return fields
