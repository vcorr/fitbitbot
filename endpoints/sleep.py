"""
Sleep data endpoint.
Fetches sleep stages, duration, and score.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

import requests

BASE_URL = "https://api.fitbit.com"
OUTPUT_DIR = Path(__file__).parent.parent / "output"


def fetch(access_token):
    """
    Fetch sleep data for the last 7 days.

    Args:
        access_token: Fitbit API access token

    Returns:
        dict with 'status', 'data', and 'fields' keys
    """
    # Get sleep list for last 7 days
    before_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    url = f"{BASE_URL}/1.2/user/-/sleep/list.json?beforeDate={before_date}&sort=desc&limit=7&offset=0"

    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            data = response.json()

            # Save to file
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            filename = OUTPUT_DIR / f"sleep_{datetime.now().strftime('%Y%m%d')}.json"
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
    """Extract available fields from sleep data."""
    fields = []

    if "sleep" in data and data["sleep"]:
        sleep_entry = data["sleep"][0]

        # Basic fields
        if "duration" in sleep_entry:
            fields.append("duration")
        if "efficiency" in sleep_entry:
            fields.append("efficiency")
        if "startTime" in sleep_entry:
            fields.append("startTime")
        if "endTime" in sleep_entry:
            fields.append("endTime")

        # Sleep stages
        if "levels" in sleep_entry:
            levels = sleep_entry["levels"]
            if "summary" in levels:
                summary = levels["summary"]
                for stage in ["deep", "light", "rem", "wake"]:
                    if stage in summary:
                        fields.append(f"stages.{stage}")

        # Sleep score (if available)
        if "score" in sleep_entry:
            fields.append("score")

        fields.append(f"entries: {len(data['sleep'])}")

    return fields
