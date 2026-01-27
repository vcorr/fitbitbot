"""
Heart rate endpoints.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from ..fitbit_client import FitbitAPIError, FitbitClient, get_fitbit_client

logger = logging.getLogger(__name__)
from ..models import (
    DateValue,
    HeartRateIntraday,
    HeartRateTodayResponse,
    HeartRateZone,
    Insight,
    RestingHeartRateHistoryResponse,
)

router = APIRouter(prefix="/heart-rate", tags=["Heart Rate"])


def parse_heart_rate_zones(hr_data: dict) -> list[HeartRateZone]:
    """Parse heart rate zones from Fitbit response."""
    zones = []
    if "value" in hr_data and "heartRateZones" in hr_data["value"]:
        for zone in hr_data["value"]["heartRateZones"]:
            zones.append(HeartRateZone(
                name=zone.get("name", "Unknown"),
                minutes=zone.get("minutes", 0),
                calories_out=zone.get("caloriesOut"),
                min_hr=zone.get("min"),
                max_hr=zone.get("max"),
            ))
    return zones


@router.get("/today", response_model=HeartRateTodayResponse)
async def get_today_heart_rate(
    include_intraday: bool = Query(default=False, description="Include intraday data (if available)"),
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get today's heart rate data.
    Includes resting HR, zones, and optionally intraday data.
    """
    today = datetime.now().strftime("%Y-%m-%d")

    # Always request 1min detail - include_intraday controls whether we return it
    raw_data = client.get_heart_rate_by_date(today, "1min")

    resting_hr = None
    zones = []

    if "activities-heart" in raw_data and raw_data["activities-heart"]:
        hr_data = raw_data["activities-heart"][0]
        if "value" in hr_data:
            resting_hr = hr_data["value"].get("restingHeartRate")
            zones = parse_heart_rate_zones(hr_data)

    # Parse intraday if available
    intraday = []
    intraday_available = False
    if include_intraday and "activities-heart-intraday" in raw_data:
        intraday_data = raw_data["activities-heart-intraday"]
        if "dataset" in intraday_data and intraday_data["dataset"]:
            intraday_available = True
            for point in intraday_data["dataset"]:
                intraday.append(HeartRateIntraday(
                    time=point.get("time", ""),
                    value=point.get("value", 0),
                ))

    # Get historical data for insights
    insights = []
    if resting_hr:
        try:
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
            history_raw = client.get_heart_rate_range(start_date, end_date)

            resting_values = []
            for day_data in history_raw.get("activities-heart", []):
                if "value" in day_data and "restingHeartRate" in day_data["value"]:
                    resting_values.append(day_data["value"]["restingHeartRate"])

            if resting_values:
                avg_resting = sum(resting_values) / len(resting_values)
                diff = resting_hr - avg_resting
                comparison = "above_average" if diff > 2 else "below_average" if diff < -2 else "at_average"
                insights.append(Insight(
                    metric="resting_heart_rate",
                    current_value=resting_hr,
                    baseline_average=round(avg_resting, 1),
                    comparison=comparison,
                    percent_difference=round((diff / avg_resting) * 100, 1) if avg_resting else None,
                ))
        except FitbitAPIError as e:
            logger.debug("Failed to fetch HR history for insights: %s", e)
        except (KeyError, TypeError, ZeroDivisionError) as e:
            logger.debug("Failed to compute HR insights: %s", e)

    return HeartRateTodayResponse(
        date=today,
        resting_heart_rate=resting_hr,
        zones=zones,
        intraday=intraday,
        intraday_available=intraday_available,
        raw_data=raw_data,
        insights=insights,
    )


@router.get("/resting/history", response_model=RestingHeartRateHistoryResponse)
async def get_resting_heart_rate_history(
    days: int = Query(default=30, ge=1, le=90, description="Number of days of history"),
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get resting heart rate trend over a period.
    """
    today = datetime.now()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")

    raw_data = client.get_heart_rate_range(start_date, end_date)

    records = []
    values = []

    for day_data in raw_data.get("activities-heart", []):
        date_str = day_data.get("dateTime", "")
        resting_hr = None
        if "value" in day_data and "restingHeartRate" in day_data["value"]:
            resting_hr = day_data["value"]["restingHeartRate"]
            values.append(resting_hr)

        records.append(DateValue(
            date=date_str,
            value=resting_hr,
        ))

    # Sort by date descending
    records.sort(key=lambda r: r.date, reverse=True)

    # Calculate statistics
    average = round(sum(values) / len(values), 1) if values else None
    min_value = min(values) if values else None
    max_value = max(values) if values else None

    # Compute insights
    insights = []
    if len(values) >= 7:
        recent_week = values[:7]
        older = values[7:]
        if older:
            recent_avg = sum(recent_week) / len(recent_week)
            older_avg = sum(older) / len(older)
            diff = recent_avg - older_avg
            if abs(diff) > 2:
                trend = "increasing" if diff > 0 else "decreasing"
                note = f"Your resting heart rate is {trend}. "
                if diff > 0:
                    note += "This could indicate fatigue, stress, or insufficient recovery."
                else:
                    note += "This may indicate improved cardiovascular fitness or better recovery."
                insights.append(Insight(
                    metric="resting_hr_trend",
                    current_value=round(recent_avg, 1),
                    baseline_average=round(older_avg, 1),
                    comparison="above_average" if diff > 0 else "below_average",
                    note=note,
                ))

    return RestingHeartRateHistoryResponse(
        days_requested=days,
        records=records,
        average=average,
        min_value=min_value,
        max_value=max_value,
        raw_data=raw_data,
        insights=insights,
    )
