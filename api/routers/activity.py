"""
Activity endpoints.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from ..fitbit_client import FitbitClient, FitbitAPIError, FitbitRateLimitError, get_fitbit_client
from ..models import (
    ActivityGoals,
    ActivityHistoryResponse,
    ActivitySummary,
    ActivityTodayResponse,
    HeartRateZone,
    Insight,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/activity", tags=["Activity"])


def parse_activity_summary(data: dict, date_str: str) -> ActivitySummary:
    """Parse Fitbit activity data into an ActivitySummary."""
    summary = data.get("summary", {})

    # Parse heart rate zones
    hr_zones = []
    for zone in summary.get("heartRateZones", []):
        hr_zones.append(HeartRateZone(
            name=zone.get("name", "Unknown"),
            minutes=zone.get("minutes", 0),
            calories_out=zone.get("caloriesOut"),
            min_hr=zone.get("min"),
            max_hr=zone.get("max"),
        ))

    # Convert distance to km (Fitbit returns in user's preferred unit)
    distances = summary.get("distances", [])
    total_distance = None
    for d in distances:
        if d.get("activity") == "total":
            total_distance = d.get("distance")
            break

    # Parse goals
    goals = None
    goals_data = data.get("goals", {})
    if goals_data:
        goals = ActivityGoals(
            steps=goals_data.get("steps"),
            calories_out=goals_data.get("caloriesOut"),
            distance_km=goals_data.get("distance"),
            floors=goals_data.get("floors"),
            active_minutes=goals_data.get("activeMinutes"),
        )

    # Compute which goals are met
    goals_met = None
    if goals:
        goals_met = {}
        if goals.steps and summary.get("steps"):
            goals_met["steps"] = summary["steps"] >= goals.steps
        if goals.floors and summary.get("floors"):
            goals_met["floors"] = summary["floors"] >= goals.floors
        if goals.active_minutes:
            active = (summary.get("fairlyActiveMinutes") or 0) + (summary.get("veryActiveMinutes") or 0)
            goals_met["active_minutes"] = active >= goals.active_minutes

    return ActivitySummary(
        date=date_str,
        steps=summary.get("steps"),
        calories_out=summary.get("caloriesOut"),
        calories_bmr=summary.get("caloriesBMR"),
        active_calories=summary.get("activityCalories"),
        floors=summary.get("floors"),
        elevation=summary.get("elevation"),
        distance_km=total_distance,
        sedentary_minutes=summary.get("sedentaryMinutes"),
        lightly_active_minutes=summary.get("lightlyActiveMinutes"),
        fairly_active_minutes=summary.get("fairlyActiveMinutes"),
        very_active_minutes=summary.get("veryActiveMinutes"),
        heart_rate_zones=hr_zones,
        goals=goals,
        goals_met=goals_met,
    )


def compute_activity_insights(current: ActivitySummary, history: list[ActivitySummary]) -> list[Insight]:
    """Compute insights comparing current activity to historical baseline."""
    insights = []

    if not history:
        return insights

    # Steps insight
    steps_history = [r.steps for r in history if r.steps is not None]
    if steps_history and current.steps is not None:
        avg_steps = sum(steps_history) / len(steps_history)
        diff = current.steps - avg_steps
        percent_diff = (diff / avg_steps) * 100 if avg_steps else 0
        comparison = "above_average" if diff > 500 else "below_average" if diff < -500 else "at_average"
        insights.append(Insight(
            metric="steps",
            current_value=current.steps,
            baseline_average=round(avg_steps, 0),
            comparison=comparison,
            percent_difference=round(percent_diff, 1),
        ))

    # Active minutes insight (fairly + very active)
    if current.fairly_active_minutes is not None and current.very_active_minutes is not None:
        current_active = current.fairly_active_minutes + current.very_active_minutes
        active_history = [
            (r.fairly_active_minutes or 0) + (r.very_active_minutes or 0)
            for r in history
            if r.fairly_active_minutes is not None or r.very_active_minutes is not None
        ]
        if active_history:
            avg_active = sum(active_history) / len(active_history)
            diff = current_active - avg_active
            comparison = "above_average" if diff > 5 else "below_average" if diff < -5 else "at_average"
            insights.append(Insight(
                metric="active_minutes",
                current_value=current_active,
                baseline_average=round(avg_active, 0),
                comparison=comparison,
                note=f"Combined fairly + very active minutes"
            ))

    return insights


@router.get("/today", response_model=ActivityTodayResponse)
async def get_today_activity(
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get today's activity summary.
    Includes steps, calories, active minutes, floors, and HR zones.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    raw_data = client.get_activity_by_date(today)

    summary = parse_activity_summary(raw_data, today)

    # Get historical data for insights
    insights = []
    try:
        history_summaries = []
        for i in range(1, 31):
            date_str = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            hist_data = client.get_activity_by_date(date_str)
            history_summaries.append(parse_activity_summary(hist_data, date_str))
        insights = compute_activity_insights(summary, history_summaries)
    except FitbitRateLimitError:
        raise
    except FitbitAPIError as e:
        logger.debug("Fitbit API error fetching activity history for insights: %s", e)

    return ActivityTodayResponse(
        summary=summary,
        raw_data=raw_data,
        insights=insights,
    )


@router.get("/history", response_model=ActivityHistoryResponse)
async def get_activity_history(
    days: int = Query(default=30, ge=1, le=90, description="Number of days of history"),
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get daily activity trends over a period.
    Returns steps, calories, and active minutes for each day.
    """
    today = datetime.now()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")

    # Fetch time series for steps (more efficient than daily calls)
    steps_raw = client.get_activity_time_series("steps", start_date, end_date)
    calories_raw = client.get_activity_time_series("calories", start_date, end_date)
    fairly_active_raw = client.get_activity_time_series("minutesFairlyActive", start_date, end_date)
    very_active_raw = client.get_activity_time_series("minutesVeryActive", start_date, end_date)

    # Build records from time series
    steps_by_date = {s["dateTime"]: int(s["value"]) for s in steps_raw.get("activities-steps", [])}
    calories_by_date = {c["dateTime"]: int(c["value"]) for c in calories_raw.get("activities-calories", [])}
    fairly_by_date = {f["dateTime"]: int(f["value"]) for f in fairly_active_raw.get("activities-minutesFairlyActive", [])}
    very_by_date = {v["dateTime"]: int(v["value"]) for v in very_active_raw.get("activities-minutesVeryActive", [])}

    records = []
    for date_str in steps_by_date.keys():
        records.append(ActivitySummary(
            date=date_str,
            steps=steps_by_date.get(date_str),
            calories_out=calories_by_date.get(date_str),
            fairly_active_minutes=fairly_by_date.get(date_str),
            very_active_minutes=very_by_date.get(date_str),
        ))

    # Sort by date descending
    records.sort(key=lambda r: r.date, reverse=True)

    # Calculate averages
    steps_vals = [r.steps for r in records if r.steps is not None]
    calories_vals = [r.calories_out for r in records if r.calories_out is not None]
    active_vals = [
        (r.fairly_active_minutes or 0) + (r.very_active_minutes or 0)
        for r in records
    ]

    averages = {
        "steps": round(sum(steps_vals) / len(steps_vals), 0) if steps_vals else None,
        "calories": round(sum(calories_vals) / len(calories_vals), 0) if calories_vals else None,
        "active_minutes": round(sum(active_vals) / len(active_vals), 0) if active_vals else None,
    }

    # Combine raw data
    raw_data = {
        "steps": steps_raw,
        "calories": calories_raw,
        "fairly_active": fairly_active_raw,
        "very_active": very_active_raw,
    }

    # Compute insights
    insights = []
    if len(records) >= 7:
        recent_week = records[:7]
        older = records[7:]
        if older:
            recent_avg_steps = sum(r.steps for r in recent_week if r.steps) / 7
            older_avg_steps = sum(r.steps for r in older if r.steps) / len(older)
            diff = recent_avg_steps - older_avg_steps
            if abs(diff) > 500:
                insights.append(Insight(
                    metric="steps_trend",
                    current_value=round(recent_avg_steps, 0),
                    baseline_average=round(older_avg_steps, 0),
                    comparison="above_average" if diff > 0 else "below_average",
                    note=f"Your average daily steps have {'increased' if diff > 0 else 'decreased'} by {abs(int(diff)):,} compared to earlier in the period"
                ))

    return ActivityHistoryResponse(
        days_requested=days,
        records=records,
        averages=averages,
        raw_data=raw_data,
        insights=insights,
    )
