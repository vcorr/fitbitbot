"""
Sleep endpoints.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from ..fitbit_client import FitbitClient, FitbitAPIError, FitbitRateLimitError, get_fitbit_client
from ..models import (
    Insight,
    SleepHistoryResponse,
    SleepLastNightResponse,
    SleepRecord,
    SleepStages,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sleep", tags=["Sleep"])


def parse_sleep_record(sleep_entry: dict) -> SleepRecord:
    """Parse a Fitbit sleep entry into a SleepRecord."""
    stages = None
    if "levels" in sleep_entry and "summary" in sleep_entry["levels"]:
        summary = sleep_entry["levels"]["summary"]
        stages = SleepStages(
            deep=summary.get("deep", {}).get("minutes"),
            light=summary.get("light", {}).get("minutes"),
            rem=summary.get("rem", {}).get("minutes"),
            wake=summary.get("wake", {}).get("minutes"),
        )

    duration_ms = sleep_entry.get("duration", 0)
    duration_hours = round(duration_ms / 3600000, 2) if duration_ms else None

    return SleepRecord(
        date=sleep_entry.get("dateOfSleep", ""),
        start_time=sleep_entry.get("startTime"),
        end_time=sleep_entry.get("endTime"),
        duration_hours=duration_hours,
        time_in_bed_minutes=sleep_entry.get("timeInBed"),
        minutes_asleep=sleep_entry.get("minutesAsleep"),
        minutes_awake=sleep_entry.get("minutesAwake"),
        minutes_to_fall_asleep=sleep_entry.get("minutesToFallAsleep"),
        minutes_after_wakeup=sleep_entry.get("minutesAfterWakeup"),
        efficiency=sleep_entry.get("efficiency"),
        stages=stages,
        is_main_sleep=sleep_entry.get("isMainSleep", True),
    )


def compute_sleep_insights(current: SleepRecord, history: list[SleepRecord]) -> list[Insight]:
    """Compute insights comparing current sleep to historical baseline."""
    insights = []

    if not history or current.duration_hours is None:
        return insights

    # Calculate averages from history
    durations = [r.duration_hours for r in history if r.duration_hours]
    efficiencies = [r.efficiency for r in history if r.efficiency]

    if durations:
        avg_duration = sum(durations) / len(durations)
        diff = current.duration_hours - avg_duration
        percent_diff = (diff / avg_duration) * 100 if avg_duration else 0

        comparison = "above_average" if diff > 0.25 else "below_average" if diff < -0.25 else "at_average"
        insights.append(Insight(
            metric="duration_hours",
            current_value=current.duration_hours,
            baseline_average=round(avg_duration, 2),
            comparison=comparison,
            percent_difference=round(percent_diff, 1),
            note=f"You slept {abs(diff):.1f} hours {'more' if diff > 0 else 'less'} than your {len(durations)}-day average"
        ))

    if efficiencies and current.efficiency:
        avg_efficiency = sum(efficiencies) / len(efficiencies)
        diff = current.efficiency - avg_efficiency
        comparison = "above_average" if diff > 2 else "below_average" if diff < -2 else "at_average"
        insights.append(Insight(
            metric="efficiency",
            current_value=current.efficiency,
            baseline_average=round(avg_efficiency, 1),
            comparison=comparison,
            percent_difference=round((diff / avg_efficiency) * 100, 1) if avg_efficiency else None,
        ))

    return insights


@router.get("/last-night", response_model=SleepLastNightResponse)
async def get_last_night_sleep(
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get the most recent sleep record with full stage data.
    Includes insights comparing to 30-day baseline.
    """
    # Get last night's sleep (actually query for yesterday since sleep is logged for the night before)
    today = datetime.now()
    yesterday = (today - timedelta(days=1)).strftime("%Y-%m-%d")

    raw_data = client.get_sleep_by_date(yesterday)

    sleep_record = None
    if "sleep" in raw_data and raw_data["sleep"]:
        # Get the main sleep record
        for entry in raw_data["sleep"]:
            if entry.get("isMainSleep", False):
                sleep_record = parse_sleep_record(entry)
                break
        # If no main sleep, take the first one
        if not sleep_record:
            sleep_record = parse_sleep_record(raw_data["sleep"][0])

    # Get historical data for insights
    insights = []
    if sleep_record:
        start_date = (today - timedelta(days=31)).strftime("%Y-%m-%d")
        end_date = (today - timedelta(days=2)).strftime("%Y-%m-%d")
        try:
            history_raw = client.get_sleep_range(start_date, end_date)
            history_records = [
                parse_sleep_record(s) for s in history_raw.get("sleep", [])
                if s.get("isMainSleep", False)
            ]
            insights = compute_sleep_insights(sleep_record, history_records)
        except FitbitRateLimitError:
            raise
        except FitbitAPIError as e:
            logger.debug("Fitbit API error fetching sleep history for insights: %s", e)

    return SleepLastNightResponse(
        sleep=sleep_record,
        raw_data=raw_data,
        insights=insights,
    )


@router.get("/history", response_model=SleepHistoryResponse)
async def get_sleep_history(
    days: int = Query(default=30, ge=1, le=90, description="Number of days of history"),
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get sleep trends over a period.
    Returns daily records with duration, efficiency, and stage breakdown.
    """
    today = datetime.now()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = (today - timedelta(days=1)).strftime("%Y-%m-%d")

    raw_data = client.get_sleep_range(start_date, end_date)

    records = []
    for entry in raw_data.get("sleep", []):
        if entry.get("isMainSleep", False):
            records.append(parse_sleep_record(entry))

    # Sort by date descending
    records.sort(key=lambda r: r.date, reverse=True)

    # Calculate averages
    durations = [r.duration_hours for r in records if r.duration_hours]
    efficiencies = [r.efficiency for r in records if r.efficiency]

    averages = {
        "duration_hours": round(sum(durations) / len(durations), 2) if durations else None,
        "efficiency": round(sum(efficiencies) / len(efficiencies), 1) if efficiencies else None,
    }

    # Compute insights
    insights = []
    if len(records) >= 7:
        recent_week = records[:7]
        older = records[7:]
        if older:
            recent_avg = sum(r.duration_hours for r in recent_week if r.duration_hours) / len(recent_week)
            older_avg = sum(r.duration_hours for r in older if r.duration_hours) / len(older)
            diff = recent_avg - older_avg
            if abs(diff) > 0.25:
                insights.append(Insight(
                    metric="duration_trend",
                    current_value=round(recent_avg, 2),
                    baseline_average=round(older_avg, 2),
                    comparison="above_average" if diff > 0 else "below_average",
                    note=f"Your sleep duration has {'increased' if diff > 0 else 'decreased'} by {abs(diff):.1f} hours compared to earlier in the period"
                ))

    return SleepHistoryResponse(
        days_requested=days,
        records=records,
        averages=averages,
        raw_data=raw_data,
        insights=insights,
    )
