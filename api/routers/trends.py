"""
Trends and analysis endpoints.
Pre-computed insights for AI coaching with graceful handling of limited data.
"""
import logging
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query

from ..fitbit_client import FitbitClient, FitbitAPIError, FitbitRateLimitError, get_fitbit_client
from ..models import Insight

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trends", tags=["Trends"])


# Minimum data requirements for different analyses
MIN_DAYS_FOR_AVERAGE = 3
MIN_DAYS_FOR_TREND = 7
MIN_DAYS_FOR_WEEKDAY_WEEKEND = 14  # Need at least 2 weekends
MIN_DAYS_FOR_CORRELATION = 14


def compute_trend_direction(values: list[float], min_days: int = 7) -> str | None:
    """
    Compute trend direction from a list of values (oldest to newest).
    Returns: 'improving', 'declining', 'stable', or None if insufficient data.
    """
    if len(values) < min_days:
        return None

    # Compare first half average to second half average
    mid = len(values) // 2
    first_half = values[:mid]
    second_half = values[mid:]

    if not first_half or not second_half:
        return None

    first_avg = sum(first_half) / len(first_half)
    second_avg = sum(second_half) / len(second_half)

    if first_avg == 0:
        return "stable"

    percent_change = ((second_avg - first_avg) / first_avg) * 100

    if percent_change > 10:
        return "improving"
    elif percent_change < -10:
        return "declining"
    else:
        return "stable"


def compute_weekday_weekend_split(
    records: list[dict], value_key: str
) -> tuple[float | None, float | None, int, int]:
    """
    Split records into weekday/weekend averages.
    Returns: (weekday_avg, weekend_avg, weekday_count, weekend_count)
    """
    weekday_values = []
    weekend_values = []

    for record in records:
        date_str = record.get("date", "")
        value = record.get(value_key)

        if not date_str or value is None:
            continue

        try:
            date = datetime.strptime(date_str, "%Y-%m-%d")
            if date.weekday() >= 5:  # Saturday = 5, Sunday = 6
                weekend_values.append(value)
            else:
                weekday_values.append(value)
        except ValueError:
            continue

    weekday_avg = sum(weekday_values) / len(weekday_values) if weekday_values else None
    weekend_avg = sum(weekend_values) / len(weekend_values) if weekend_values else None

    return weekday_avg, weekend_avg, len(weekday_values), len(weekend_values)


@router.get("/analysis")
async def get_trends_analysis(
    days: int = Query(default=30, ge=7, le=90, description="Days of history to analyze"),
    client: FitbitClient = Depends(get_fitbit_client),
) -> dict[str, Any]:
    """
    Get pre-computed trend analysis for AI coaching.

    Gracefully handles limited data - reports what's available and only
    computes insights when there's sufficient data for meaningful analysis.
    """
    today = datetime.now()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")

    response = {
        "analysis_period": {
            "start_date": start_date,
            "end_date": end_date,
            "days_requested": days,
        },
        "data_availability": {},
        "hrv": {},
        "sleep": {},
        "activity": {},
        "resting_heart_rate": {},
        "correlations": [],
        "insights": [],
    }

    # =========================================================================
    # Fetch all data
    # =========================================================================

    hrv_data = []
    sleep_data = []
    activity_data = []
    rhr_data = []

    # HRV
    try:
        hrv_raw = client.get_hrv_range(start_date, end_date)
        for entry in hrv_raw.get("hrv", []):
            value = entry.get("value", {})
            if "dailyRmssd" in value:
                hrv_data.append({
                    "date": entry.get("dateTime", ""),
                    "value": value["dailyRmssd"],
                })
    except FitbitRateLimitError:
        raise
    except FitbitAPIError as e:
        logger.debug("Fitbit API error (non-critical): %s", e)

    # Sleep
    try:
        sleep_raw = client.get_sleep_range(start_date, end_date)
        for entry in sleep_raw.get("sleep", []):
            if entry.get("isMainSleep", False):
                duration_ms = entry.get("duration", 0)
                duration_hours = round(duration_ms / 3600000, 2) if duration_ms else None
                if duration_hours:
                    sleep_data.append({
                        "date": entry.get("dateOfSleep", ""),
                        "duration_hours": duration_hours,
                        "efficiency": entry.get("efficiency"),
                    })
    except FitbitRateLimitError:
        raise
    except FitbitAPIError as e:
        logger.debug("Fitbit API error (non-critical): %s", e)

    # Activity (steps)
    try:
        steps_raw = client.get_activity_time_series("steps", start_date, end_date)
        for entry in steps_raw.get("activities-steps", []):
            try:
                steps = int(entry.get("value", 0))
                activity_data.append({
                    "date": entry.get("dateTime", ""),
                    "steps": steps,
                })
            except (ValueError, TypeError):
                pass
    except FitbitRateLimitError:
        raise
    except FitbitAPIError as e:
        logger.debug("Fitbit API error (non-critical): %s", e)

    # Resting heart rate
    try:
        hr_raw = client.get_heart_rate_range(start_date, end_date)
        for entry in hr_raw.get("activities-heart", []):
            value = entry.get("value", {})
            if "restingHeartRate" in value:
                rhr_data.append({
                    "date": entry.get("dateTime", ""),
                    "value": value["restingHeartRate"],
                })
    except FitbitRateLimitError:
        raise
    except FitbitAPIError as e:
        logger.debug("Fitbit API error (non-critical): %s", e)

    # =========================================================================
    # Report data availability
    # =========================================================================

    response["data_availability"] = {
        "hrv": {
            "days_with_data": len(hrv_data),
            "sufficient_for_average": len(hrv_data) >= MIN_DAYS_FOR_AVERAGE,
            "sufficient_for_trend": len(hrv_data) >= MIN_DAYS_FOR_TREND,
            "sufficient_for_weekday_weekend": len(hrv_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND,
        },
        "sleep": {
            "days_with_data": len(sleep_data),
            "sufficient_for_average": len(sleep_data) >= MIN_DAYS_FOR_AVERAGE,
            "sufficient_for_trend": len(sleep_data) >= MIN_DAYS_FOR_TREND,
            "sufficient_for_weekday_weekend": len(sleep_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND,
        },
        "activity": {
            "days_with_data": len(activity_data),
            "sufficient_for_average": len(activity_data) >= MIN_DAYS_FOR_AVERAGE,
            "sufficient_for_trend": len(activity_data) >= MIN_DAYS_FOR_TREND,
            "sufficient_for_weekday_weekend": len(activity_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND,
        },
        "resting_heart_rate": {
            "days_with_data": len(rhr_data),
            "sufficient_for_average": len(rhr_data) >= MIN_DAYS_FOR_AVERAGE,
            "sufficient_for_trend": len(rhr_data) >= MIN_DAYS_FOR_TREND,
            "sufficient_for_weekday_weekend": len(rhr_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND,
        },
    }

    # =========================================================================
    # HRV Analysis
    # =========================================================================

    if hrv_data:
        # Sort by date descending (newest first)
        hrv_data.sort(key=lambda x: x["date"], reverse=True)
        hrv_values = [d["value"] for d in hrv_data]
        hrv_values_chronological = list(reversed(hrv_values))  # oldest first for trend

        response["hrv"]["average"] = round(sum(hrv_values) / len(hrv_values), 1)
        response["hrv"]["min"] = round(min(hrv_values), 1)
        response["hrv"]["max"] = round(max(hrv_values), 1)
        response["hrv"]["latest"] = round(hrv_values[0], 1) if hrv_values else None
        response["hrv"]["latest_date"] = hrv_data[0]["date"] if hrv_data else None
        response["hrv"]["days_of_data"] = len(hrv_data)

        # Trend (need 7+ days)
        if len(hrv_data) >= MIN_DAYS_FOR_TREND:
            response["hrv"]["trend"] = compute_trend_direction(hrv_values_chronological)

            # Week over week
            if len(hrv_values) >= 14:
                this_week = hrv_values[:7]
                last_week = hrv_values[7:14]
                this_avg = sum(this_week) / len(this_week)
                last_avg = sum(last_week) / len(last_week)
                change = ((this_avg - last_avg) / last_avg) * 100 if last_avg else 0
                response["hrv"]["week_over_week_change_percent"] = round(change, 1)

        # Weekday vs weekend (need 14+ days)
        if len(hrv_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND:
            wd_avg, we_avg, wd_count, we_count = compute_weekday_weekend_split(
                [{"date": d["date"], "value": d["value"]} for d in hrv_data],
                "value"
            )
            if wd_avg and we_avg and wd_count >= 5 and we_count >= 2:
                response["hrv"]["weekday_avg"] = round(wd_avg, 1)
                response["hrv"]["weekend_avg"] = round(we_avg, 1)
                response["hrv"]["weekday_count"] = wd_count
                response["hrv"]["weekend_count"] = we_count

                diff_percent = ((we_avg - wd_avg) / wd_avg) * 100
                response["hrv"]["weekend_vs_weekday_percent"] = round(diff_percent, 1)

                if diff_percent > 15:
                    response["insights"].append(Insight(
                        metric="hrv_weekday_weekend",
                        current_value=round(we_avg, 1),
                        baseline_average=round(wd_avg, 1),
                        comparison="above_average",
                        percent_difference=round(diff_percent, 1),
                        note=f"Your HRV is {round(diff_percent)}% higher on weekends than weekdays, suggesting work-week stress impact."
                    ))
    else:
        response["hrv"]["message"] = "No HRV data available for this period"

    # =========================================================================
    # Sleep Analysis
    # =========================================================================

    if sleep_data:
        # Sort by date descending (newest first)
        sleep_data.sort(key=lambda x: x["date"], reverse=True)
        durations = [d["duration_hours"] for d in sleep_data if d.get("duration_hours")]
        efficiencies = [d["efficiency"] for d in sleep_data if d.get("efficiency")]

        response["sleep"]["days_of_data"] = len(sleep_data)
        response["sleep"]["latest_date"] = sleep_data[0]["date"] if sleep_data else None

        if durations:
            response["sleep"]["average_duration_hours"] = round(sum(durations) / len(durations), 2)
            response["sleep"]["min_duration_hours"] = round(min(durations), 2)
            response["sleep"]["max_duration_hours"] = round(max(durations), 2)
            response["sleep"]["latest_duration_hours"] = round(durations[0], 2)

            if len(durations) >= MIN_DAYS_FOR_TREND:
                response["sleep"]["duration_trend"] = compute_trend_direction(list(reversed(durations)))

        if efficiencies:
            response["sleep"]["average_efficiency"] = round(sum(efficiencies) / len(efficiencies), 1)
            response["sleep"]["latest_efficiency"] = efficiencies[0]

            if len(efficiencies) >= MIN_DAYS_FOR_TREND:
                response["sleep"]["efficiency_trend"] = compute_trend_direction(list(reversed(efficiencies)))

        # Weekday vs weekend sleep
        if len(sleep_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND:
            wd_avg, we_avg, wd_count, we_count = compute_weekday_weekend_split(
                [{"date": d["date"], "duration_hours": d["duration_hours"]} for d in sleep_data],
                "duration_hours"
            )
            if wd_avg and we_avg and wd_count >= 5 and we_count >= 2:
                response["sleep"]["weekday_avg_hours"] = round(wd_avg, 2)
                response["sleep"]["weekend_avg_hours"] = round(we_avg, 2)

                diff_hours = we_avg - wd_avg
                if diff_hours > 0.5:
                    response["insights"].append(Insight(
                        metric="sleep_weekday_weekend",
                        current_value=round(we_avg, 2),
                        baseline_average=round(wd_avg, 2),
                        note=f"You sleep {round(diff_hours, 1)} hours more on weekends, possibly catching up on sleep debt."
                    ))
    else:
        response["sleep"]["message"] = "No sleep data available for this period"

    # =========================================================================
    # Activity Analysis
    # =========================================================================

    if activity_data:
        # Sort by date descending (newest first)
        activity_data.sort(key=lambda x: x["date"], reverse=True)
        steps = [d["steps"] for d in activity_data if d.get("steps") is not None]

        response["activity"]["days_of_data"] = len(activity_data)
        response["activity"]["latest_date"] = activity_data[0]["date"] if activity_data else None

        if steps:
            response["activity"]["average_steps"] = round(sum(steps) / len(steps))
            response["activity"]["min_steps"] = min(steps)
            response["activity"]["max_steps"] = max(steps)
            response["activity"]["latest_steps"] = steps[0]

            if len(steps) >= MIN_DAYS_FOR_TREND:
                response["activity"]["trend"] = compute_trend_direction(list(reversed(steps)))

            # Weekday vs weekend
            if len(activity_data) >= MIN_DAYS_FOR_WEEKDAY_WEEKEND:
                wd_avg, we_avg, wd_count, we_count = compute_weekday_weekend_split(
                    [{"date": d["date"], "steps": d["steps"]} for d in activity_data],
                    "steps"
                )
                if wd_avg and we_avg and wd_count >= 5 and we_count >= 2:
                    response["activity"]["weekday_avg_steps"] = round(wd_avg)
                    response["activity"]["weekend_avg_steps"] = round(we_avg)
    else:
        response["activity"]["message"] = "No activity data available for this period"

    # =========================================================================
    # Resting Heart Rate Analysis
    # =========================================================================

    if rhr_data:
        # Sort by date descending (newest first)
        rhr_data.sort(key=lambda x: x["date"], reverse=True)
        rhr_values = [d["value"] for d in rhr_data]

        response["resting_heart_rate"]["average"] = round(sum(rhr_values) / len(rhr_values), 1)
        response["resting_heart_rate"]["min"] = min(rhr_values)
        response["resting_heart_rate"]["max"] = max(rhr_values)
        response["resting_heart_rate"]["latest"] = rhr_values[0]
        response["resting_heart_rate"]["latest_date"] = rhr_data[0]["date"] if rhr_data else None
        response["resting_heart_rate"]["days_of_data"] = len(rhr_data)

        if len(rhr_values) >= MIN_DAYS_FOR_TREND:
            # For RHR, lower is generally better, so reverse the trend interpretation
            trend = compute_trend_direction(list(reversed(rhr_values)))
            if trend == "improving":
                response["resting_heart_rate"]["trend"] = "increasing"
            elif trend == "declining":
                response["resting_heart_rate"]["trend"] = "decreasing"  # decreasing RHR is good
            else:
                response["resting_heart_rate"]["trend"] = trend
    else:
        response["resting_heart_rate"]["message"] = "No resting heart rate data available for this period"

    # =========================================================================
    # Correlations (need 14+ days)
    # =========================================================================

    if (len(hrv_data) >= MIN_DAYS_FOR_CORRELATION and
        len(activity_data) >= MIN_DAYS_FOR_CORRELATION):

        # Build date-aligned data
        hrv_by_date = {d["date"]: d["value"] for d in hrv_data}
        steps_by_date = {d["date"]: d["steps"] for d in activity_data}

        # Check if high activity days correlate with next-day HRV
        high_activity_next_hrv = []
        low_activity_next_hrv = []

        steps_values = list(steps_by_date.values())
        median_steps = sorted(steps_values)[len(steps_values) // 2] if steps_values else 5000

        sorted_dates = sorted(steps_by_date.keys())
        for i, date in enumerate(sorted_dates[:-1]):
            next_date = sorted_dates[i + 1] if i + 1 < len(sorted_dates) else None
            if next_date and next_date in hrv_by_date:
                steps = steps_by_date[date]
                next_hrv = hrv_by_date[next_date]

                if steps > median_steps:
                    high_activity_next_hrv.append(next_hrv)
                else:
                    low_activity_next_hrv.append(next_hrv)

        if len(high_activity_next_hrv) >= 3 and len(low_activity_next_hrv) >= 3:
            high_avg = sum(high_activity_next_hrv) / len(high_activity_next_hrv)
            low_avg = sum(low_activity_next_hrv) / len(low_activity_next_hrv)

            if high_avg != low_avg:
                diff_percent = ((high_avg - low_avg) / low_avg) * 100
                if abs(diff_percent) > 10:
                    response["correlations"].append({
                        "finding": f"HRV is {abs(round(diff_percent))}% {'higher' if diff_percent > 0 else 'lower'} the day after high-activity days (>{median_steps:,} steps)",
                        "high_activity_next_day_hrv_avg": round(high_avg, 1),
                        "low_activity_next_day_hrv_avg": round(low_avg, 1),
                        "sample_size": len(high_activity_next_hrv) + len(low_activity_next_hrv),
                    })

    # =========================================================================
    # Summary insight based on data availability
    # =========================================================================

    total_days = max(
        len(hrv_data), len(sleep_data), len(activity_data), len(rhr_data)
    )

    if total_days < MIN_DAYS_FOR_AVERAGE:
        response["insights"].append(Insight(
            metric="data_availability",
            current_value=total_days,
            note=f"Limited data available ({total_days} days). Trends will become more accurate as more data is collected. Need at least {MIN_DAYS_FOR_TREND} days for trend analysis and {MIN_DAYS_FOR_WEEKDAY_WEEKEND} days for weekday/weekend patterns."
        ))
    elif total_days < MIN_DAYS_FOR_TREND:
        response["insights"].append(Insight(
            metric="data_availability",
            current_value=total_days,
            note=f"Basic averages available ({total_days} days of data). Trend analysis requires {MIN_DAYS_FOR_TREND}+ days."
        ))
    elif total_days < MIN_DAYS_FOR_WEEKDAY_WEEKEND:
        response["insights"].append(Insight(
            metric="data_availability",
            current_value=total_days,
            note=f"Trend analysis available ({total_days} days of data). Weekday/weekend patterns require {MIN_DAYS_FOR_WEEKDAY_WEEKEND}+ days."
        ))

    return response
