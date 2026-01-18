"""
Recovery endpoints (HRV, SpO2, Breathing Rate, Temperature).
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from ..fitbit_client import FitbitClient, FitbitAPIError, get_fitbit_client
from ..models import (
    BreathingRateData,
    CardioFitnessData,
    HRVData,
    Insight,
    RecoveryHistoryResponse,
    RecoveryTodayResponse,
    SpO2Data,
    TemperatureData,
)

router = APIRouter(prefix="/recovery", tags=["Recovery"])


def parse_hrv_data(data: dict, date_str: str) -> HRVData | None:
    """Parse HRV data from Fitbit response."""
    if "hrv" in data and data["hrv"]:
        hrv_entry = data["hrv"][0]
        value = hrv_entry.get("value", {})
        return HRVData(
            date=hrv_entry.get("dateTime", date_str),
            daily_rmssd=value.get("dailyRmssd"),
            deep_rmssd=value.get("deepRmssd"),
        )
    return None


def parse_spo2_data(data: dict, date_str: str) -> SpO2Data | None:
    """Parse SpO2 data from Fitbit response."""
    if "value" in data:
        value = data["value"]
        return SpO2Data(
            date=data.get("dateTime", date_str),
            avg=value.get("avg"),
            min=value.get("min"),
            max=value.get("max"),
        )
    return None


def parse_breathing_rate_data(data: dict, date_str: str) -> BreathingRateData | None:
    """Parse breathing rate data from Fitbit response."""
    if "br" in data and data["br"]:
        br_entry = data["br"][0]
        value = br_entry.get("value", {})
        return BreathingRateData(
            date=br_entry.get("dateTime", date_str),
            breathing_rate=value.get("breathingRate"),
        )
    return None


def parse_temperature_data(data: dict, date_str: str) -> TemperatureData | None:
    """Parse temperature data from Fitbit response."""
    if "tempSkin" in data and data["tempSkin"]:
        temp_entry = data["tempSkin"][0]
        value = temp_entry.get("value", {})
        return TemperatureData(
            date=temp_entry.get("dateTime", date_str),
            nightly_relative=value.get("nightlyRelative"),
        )
    return None


def parse_cardio_fitness_data(data: dict, date_str: str) -> CardioFitnessData | None:
    """Parse cardio fitness (VO2 Max) data from Fitbit response."""
    if "cardioScore" in data and data["cardioScore"]:
        entry = data["cardioScore"][0]
        value = entry.get("value", {})
        return CardioFitnessData(
            date=entry.get("dateTime", date_str),
            vo2_max=value.get("vo2Max"),
            vo2_max_range=f"{value.get('vo2MaxLower', '')}-{value.get('vo2MaxUpper', '')}" if value.get("vo2MaxLower") else None,
            fitness_level=value.get("fitnessLevel"),
        )
    return None


@router.get("/today", response_model=RecoveryTodayResponse)
async def get_today_recovery(
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get today's recovery metrics.
    Includes HRV, SpO2, breathing rate, and temperature.
    """
    today = datetime.now().strftime("%Y-%m-%d")

    raw_data = {}
    hrv = None
    spo2 = None
    breathing_rate = None
    temperature = None

    # Fetch each metric (some may not be available)
    try:
        hrv_raw = client.get_hrv_by_date(today)
        raw_data["hrv"] = hrv_raw
        hrv = parse_hrv_data(hrv_raw, today)
    except FitbitAPIError:
        pass

    try:
        spo2_raw = client.get_spo2_by_date(today)
        raw_data["spo2"] = spo2_raw
        spo2 = parse_spo2_data(spo2_raw, today)
    except FitbitAPIError:
        pass

    try:
        br_raw = client.get_breathing_rate_by_date(today)
        raw_data["breathing_rate"] = br_raw
        breathing_rate = parse_breathing_rate_data(br_raw, today)
    except FitbitAPIError:
        pass

    try:
        temp_raw = client.get_temperature_by_date(today)
        raw_data["temperature"] = temp_raw
        temperature = parse_temperature_data(temp_raw, today)
    except FitbitAPIError:
        pass

    cardio_fitness = None
    try:
        cardio_raw = client.get_cardio_fitness_by_date(today)
        raw_data["cardio_fitness"] = cardio_raw
        cardio_fitness = parse_cardio_fitness_data(cardio_raw, today)
    except FitbitAPIError:
        pass

    # Compute insights
    insights = []

    # HRV insight
    if hrv and hrv.daily_rmssd:
        try:
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
            hrv_history = client.get_hrv_range(start_date, end_date)

            rmssd_values = []
            for entry in hrv_history.get("hrv", []):
                if "value" in entry and "dailyRmssd" in entry["value"]:
                    rmssd_values.append(entry["value"]["dailyRmssd"])

            if rmssd_values:
                avg_rmssd = sum(rmssd_values) / len(rmssd_values)
                diff = hrv.daily_rmssd - avg_rmssd
                comparison = "above_average" if diff > 3 else "below_average" if diff < -3 else "at_average"

                note = None
                if diff < -5:
                    note = "Lower HRV may indicate stress, fatigue, or need for recovery."
                elif diff > 5:
                    note = "Higher HRV suggests good recovery and readiness."

                insights.append(Insight(
                    metric="hrv_rmssd",
                    current_value=hrv.daily_rmssd,
                    baseline_average=round(avg_rmssd, 1),
                    comparison=comparison,
                    percent_difference=round((diff / avg_rmssd) * 100, 1) if avg_rmssd else None,
                    note=note,
                ))
        except Exception:
            pass

    return RecoveryTodayResponse(
        date=today,
        hrv=hrv,
        spo2=spo2,
        breathing_rate=breathing_rate,
        temperature=temperature,
        cardio_fitness=cardio_fitness,
        raw_data=raw_data,
        insights=insights,
    )


@router.get("/history", response_model=RecoveryHistoryResponse)
async def get_recovery_history(
    days: int = Query(default=30, ge=1, le=90, description="Number of days of history"),
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get recovery metrics trend over a period.
    """
    today = datetime.now()
    start_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = today.strftime("%Y-%m-%d")

    raw_data = {}
    hrv_records = []
    spo2_records = []
    breathing_rate_records = []
    temperature_records = []

    # Fetch HRV history
    try:
        hrv_raw = client.get_hrv_range(start_date, end_date)
        raw_data["hrv"] = hrv_raw
        for entry in hrv_raw.get("hrv", []):
            value = entry.get("value", {})
            hrv_records.append(HRVData(
                date=entry.get("dateTime", ""),
                daily_rmssd=value.get("dailyRmssd"),
                deep_rmssd=value.get("deepRmssd"),
            ))
    except FitbitAPIError:
        pass

    # Fetch SpO2 history
    try:
        spo2_raw = client.get_spo2_range(start_date, end_date)
        raw_data["spo2"] = spo2_raw
        # SpO2 range response format may vary
        for entry in spo2_raw if isinstance(spo2_raw, list) else [spo2_raw]:
            if "value" in entry:
                value = entry["value"]
                spo2_records.append(SpO2Data(
                    date=entry.get("dateTime", ""),
                    avg=value.get("avg"),
                    min=value.get("min"),
                    max=value.get("max"),
                ))
    except FitbitAPIError:
        pass

    # Fetch breathing rate history
    try:
        br_raw = client.get_breathing_rate_range(start_date, end_date)
        raw_data["breathing_rate"] = br_raw
        for entry in br_raw.get("br", []):
            value = entry.get("value", {})
            breathing_rate_records.append(BreathingRateData(
                date=entry.get("dateTime", ""),
                breathing_rate=value.get("breathingRate"),
            ))
    except FitbitAPIError:
        pass

    # Fetch temperature history
    try:
        temp_raw = client.get_temperature_range(start_date, end_date)
        raw_data["temperature"] = temp_raw
        for entry in temp_raw.get("tempSkin", []):
            value = entry.get("value", {})
            temperature_records.append(TemperatureData(
                date=entry.get("dateTime", ""),
                nightly_relative=value.get("nightlyRelative"),
            ))
    except FitbitAPIError:
        pass

    # Sort all records by date descending
    hrv_records.sort(key=lambda r: r.date, reverse=True)
    spo2_records.sort(key=lambda r: r.date, reverse=True)
    breathing_rate_records.sort(key=lambda r: r.date, reverse=True)
    temperature_records.sort(key=lambda r: r.date, reverse=True)

    # Calculate averages
    hrv_values = [r.daily_rmssd for r in hrv_records if r.daily_rmssd]
    spo2_values = [r.avg for r in spo2_records if r.avg]
    br_values = [r.breathing_rate for r in breathing_rate_records if r.breathing_rate]

    averages = {
        "hrv_rmssd": round(sum(hrv_values) / len(hrv_values), 1) if hrv_values else None,
        "spo2_avg": round(sum(spo2_values) / len(spo2_values), 1) if spo2_values else None,
        "breathing_rate": round(sum(br_values) / len(br_values), 1) if br_values else None,
    }

    # Compute insights
    insights = []
    if len(hrv_values) >= 7:
        recent_week = hrv_values[:7]
        older = hrv_values[7:]
        if older:
            recent_avg = sum(recent_week) / len(recent_week)
            older_avg = sum(older) / len(older)
            diff = recent_avg - older_avg
            if abs(diff) > 3:
                trend = "improving" if diff > 0 else "declining"
                insights.append(Insight(
                    metric="hrv_trend",
                    current_value=round(recent_avg, 1),
                    baseline_average=round(older_avg, 1),
                    comparison="above_average" if diff > 0 else "below_average",
                    note=f"Your HRV trend is {trend} compared to earlier in the period.",
                ))

    return RecoveryHistoryResponse(
        days_requested=days,
        hrv_records=hrv_records,
        spo2_records=spo2_records,
        breathing_rate_records=breathing_rate_records,
        temperature_records=temperature_records,
        averages=averages,
        raw_data=raw_data,
        insights=insights,
    )
