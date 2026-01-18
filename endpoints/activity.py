"""
Activity data endpoint.
Fetches steps, calories, active minutes.
"""
import json
from datetime import datetime
from pathlib import Path

import requests

BASE_URL = "https://api.fitbit.com"
OUTPUT_DIR = Path(__file__).parent.parent / "output"


def fetch(access_token):
    """
    Fetch activity data for today.

    Args:
        access_token: Fitbit API access token

    Returns:
        dict with 'status', 'data', and 'fields' keys
    """
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"{BASE_URL}/1/user/-/activities/date/{today}.json"

    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            data = response.json()

            # Save to file
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            filename = OUTPUT_DIR / f"activity_{datetime.now().strftime('%Y%m%d')}.json"
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
    """Extract available fields from activity data."""
    fields = []

    if "summary" in data:
        summary = data["summary"]

        if "steps" in summary:
            fields.append(f"steps: {summary['steps']:,}")
        if "caloriesOut" in summary:
            fields.append(f"caloriesOut: {summary['caloriesOut']:,}")
        if "floors" in summary:
            fields.append(f"floors: {summary['floors']}")
        if "distance" in summary:
            # Distance is typically in miles or km
            fields.append(f"distance: {summary['distance']}")

        # Active minutes
        if "fairlyActiveMinutes" in summary:
            fields.append(f"fairlyActiveMinutes: {summary['fairlyActiveMinutes']}")
        if "veryActiveMinutes" in summary:
            fields.append(f"veryActiveMinutes: {summary['veryActiveMinutes']}")
        if "sedentaryMinutes" in summary:
            fields.append(f"sedentaryMinutes: {summary['sedentaryMinutes']}")

    # Activities logged
    if "activities" in data:
        fields.append(f"activities: {len(data['activities'])} logged")

    # Goals
    if "goals" in data:
        fields.append("goals: available")

    return fields
