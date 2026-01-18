"""
Exercise/logged activities endpoints.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from ..fitbit_client import FitbitClient, get_fitbit_client
from ..models import ExerciseRecord, ExerciseRecentResponse

router = APIRouter(prefix="/exercises", tags=["Exercises"])


def parse_exercise_record(activity: dict) -> ExerciseRecord:
    """Parse a Fitbit activity log into an ExerciseRecord."""
    # Duration is in milliseconds
    duration_ms = activity.get("duration", 0)
    duration_minutes = round(duration_ms / 60000) if duration_ms else None

    # Distance might be in different units, convert to km
    distance = activity.get("distance")
    distance_km = distance if distance else None

    return ExerciseRecord(
        log_id=activity.get("logId", 0),
        activity_name=activity.get("activityName", "Unknown"),
        date=activity.get("startDate", activity.get("originalStartTime", "")[:10]),
        start_time=activity.get("startTime", activity.get("originalStartTime", "")),
        duration_minutes=duration_minutes,
        calories=activity.get("calories"),
        average_heart_rate=activity.get("averageHeartRate"),
        steps=activity.get("steps"),
        distance_km=distance_km,
    )


@router.get("/recent", response_model=ExerciseRecentResponse)
async def get_recent_exercises(
    days: int = Query(default=7, ge=1, le=30, description="Number of days to look back"),
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get logged workouts/exercises from recent days.
    Includes duration, calories, heart rate, and other workout metrics.
    """
    today = datetime.now()
    before_date = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    cutoff_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")

    raw_data = client.get_activity_logs(before_date, limit=100)

    exercises = []
    total_calories = 0
    total_duration = 0

    for activity in raw_data.get("activities", []):
        # Only include activities that have a logged time and are within the date range
        activity_date = activity.get("startDate", activity.get("originalStartTime", "")[:10])
        if activity_date < cutoff_date:
            continue

        record = parse_exercise_record(activity)
        exercises.append(record)

        if record.calories:
            total_calories += record.calories
        if record.duration_minutes:
            total_duration += record.duration_minutes

    # Sort by date descending
    exercises.sort(key=lambda e: (e.date, e.start_time or ""), reverse=True)

    return ExerciseRecentResponse(
        days_requested=days,
        exercises=exercises,
        total_workouts=len(exercises),
        total_calories=total_calories,
        total_duration_minutes=total_duration,
        raw_data=raw_data,
    )
