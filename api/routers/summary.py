"""
Summary endpoints - aggregated data for AI coach context.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from ..fitbit_client import FitbitClient, FitbitAPIError, FitbitRateLimitError, get_fitbit_client
from ..models import (
    ActivityGoals,
    ActivityHistoryResponse,
    ActivitySummary,
    BreathingRateData,
    CardioFitnessData,
    DateValue,
    ExerciseSummary,
    HeartRateIntraday,
    HeartRateZone,
    HeartRateTodayResponse,
    HRVData,
    Insight,
    MorningReportResponse,
    RecentTrends,
    RecoveryHistoryResponse,
    RecoveryTodayResponse,
    RestingHeartRateHistoryResponse,
    SleepHistoryResponse,
    SleepRecord,
    SleepStages,
    SpO2Data,
    TemperatureData,
    TodaySummaryResponse,
    WeekSummaryResponse,
)

router = APIRouter(prefix="/summary", tags=["Summary"])


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


def parse_activity_summary(data: dict, date_str: str) -> ActivitySummary:
    """Parse Fitbit activity data into an ActivitySummary."""
    summary = data.get("summary", {})

    hr_zones = []
    for zone in summary.get("heartRateZones", []):
        hr_zones.append(HeartRateZone(
            name=zone.get("name", "Unknown"),
            minutes=zone.get("minutes", 0),
            calories_out=zone.get("caloriesOut"),
            min_hr=zone.get("min"),
            max_hr=zone.get("max"),
        ))

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


@router.get("/today", response_model=TodaySummaryResponse)
async def get_today_summary(
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get all today's data in one call - ideal for AI context.
    Includes sleep (last night), activity, heart rate, and recovery.
    """
    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    yesterday = (today - timedelta(days=1)).strftime("%Y-%m-%d")

    insights = []

    # Sleep (last night)
    sleep_record = None
    try:
        sleep_raw = client.get_sleep_by_date(yesterday)
        if "sleep" in sleep_raw and sleep_raw["sleep"]:
            for entry in sleep_raw["sleep"]:
                if entry.get("isMainSleep", False):
                    sleep_record = parse_sleep_record(entry)
                    break
            if not sleep_record:
                sleep_record = parse_sleep_record(sleep_raw["sleep"][0])
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # Activity
    activity_summary = None
    try:
        activity_raw = client.get_activity_by_date(today_str)
        activity_summary = parse_activity_summary(activity_raw, today_str)
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # Heart Rate
    heart_rate_response = None
    try:
        hr_raw = client.get_heart_rate_by_date(today_str)
        resting_hr = None
        zones = []
        if "activities-heart" in hr_raw and hr_raw["activities-heart"]:
            hr_data = hr_raw["activities-heart"][0]
            if "value" in hr_data:
                resting_hr = hr_data["value"].get("restingHeartRate")
                for zone in hr_data["value"].get("heartRateZones", []):
                    zones.append(HeartRateZone(
                        name=zone.get("name", "Unknown"),
                        minutes=zone.get("minutes", 0),
                        calories_out=zone.get("caloriesOut"),
                        min_hr=zone.get("min"),
                        max_hr=zone.get("max"),
                    ))
        heart_rate_response = HeartRateTodayResponse(
            date=today_str,
            resting_heart_rate=resting_hr,
            zones=zones,
            intraday=[],
            intraday_available=False,
            raw_data=hr_raw,
            insights=[],
        )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # Recovery
    recovery_response = None
    recovery_raw = {}
    hrv = None
    spo2 = None
    breathing_rate = None
    temperature = None

    try:
        hrv_raw = client.get_hrv_by_date(today_str)
        recovery_raw["hrv"] = hrv_raw
        if "hrv" in hrv_raw and hrv_raw["hrv"]:
            hrv_entry = hrv_raw["hrv"][0]
            value = hrv_entry.get("value", {})
            hrv = HRVData(
                date=hrv_entry.get("dateTime", today_str),
                daily_rmssd=value.get("dailyRmssd"),
                deep_rmssd=value.get("deepRmssd"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        spo2_raw = client.get_spo2_by_date(today_str)
        recovery_raw["spo2"] = spo2_raw
        if "value" in spo2_raw:
            value = spo2_raw["value"]
            spo2 = SpO2Data(
                date=spo2_raw.get("dateTime", today_str),
                avg=value.get("avg"),
                min=value.get("min"),
                max=value.get("max"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        br_raw = client.get_breathing_rate_by_date(today_str)
        recovery_raw["breathing_rate"] = br_raw
        if "br" in br_raw and br_raw["br"]:
            br_entry = br_raw["br"][0]
            value = br_entry.get("value", {})
            breathing_rate = BreathingRateData(
                date=br_entry.get("dateTime", today_str),
                breathing_rate=value.get("breathingRate"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        temp_raw = client.get_temperature_by_date(today_str)
        recovery_raw["temperature"] = temp_raw
        if "tempSkin" in temp_raw and temp_raw["tempSkin"]:
            temp_entry = temp_raw["tempSkin"][0]
            value = temp_entry.get("value", {})
            temperature = TemperatureData(
                date=temp_entry.get("dateTime", today_str),
                nightly_relative=value.get("nightlyRelative"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    if hrv or spo2 or breathing_rate or temperature:
        recovery_response = RecoveryTodayResponse(
            date=today_str,
            hrv=hrv,
            spo2=spo2,
            breathing_rate=breathing_rate,
            temperature=temperature,
            raw_data=recovery_raw,
            insights=[],
        )

    # Generate high-level insights
    if sleep_record and sleep_record.duration_hours:
        if sleep_record.duration_hours < 6:
            insights.append(Insight(
                metric="sleep_duration",
                current_value=sleep_record.duration_hours,
                note="You got less than 6 hours of sleep. Consider prioritizing rest today.",
            ))
        elif sleep_record.duration_hours >= 7.5:
            insights.append(Insight(
                metric="sleep_duration",
                current_value=sleep_record.duration_hours,
                note="Good sleep duration last night.",
            ))

    if hrv and hrv.daily_rmssd:
        if hrv.daily_rmssd < 20:
            insights.append(Insight(
                metric="hrv",
                current_value=hrv.daily_rmssd,
                note="Lower HRV today. Consider lighter activity and stress management.",
            ))

    return TodaySummaryResponse(
        date=today_str,
        sleep=sleep_record,
        activity=activity_summary,
        heart_rate=heart_rate_response,
        recovery=recovery_response,
        insights=insights,
    )


@router.get("/week", response_model=WeekSummaryResponse)
async def get_week_summary(
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get 7-day summary with trends - ideal for weekly AI coaching check-in.
    """
    today = datetime.now()
    end_date = today.strftime("%Y-%m-%d")
    start_date = (today - timedelta(days=7)).strftime("%Y-%m-%d")

    insights = []

    # Sleep history
    sleep_response = None
    try:
        sleep_raw = client.get_sleep_range(start_date, end_date)
        records = []
        for entry in sleep_raw.get("sleep", []):
            if entry.get("isMainSleep", False):
                records.append(parse_sleep_record(entry))
        records.sort(key=lambda r: r.date, reverse=True)

        durations = [r.duration_hours for r in records if r.duration_hours]
        efficiencies = [r.efficiency for r in records if r.efficiency]

        averages = {
            "duration_hours": round(sum(durations) / len(durations), 2) if durations else None,
            "efficiency": round(sum(efficiencies) / len(efficiencies), 1) if efficiencies else None,
        }

        sleep_response = SleepHistoryResponse(
            days_requested=7,
            records=records,
            averages=averages,
            raw_data=sleep_raw,
            insights=[],
        )

        if averages["duration_hours"]:
            if averages["duration_hours"] < 7:
                insights.append(Insight(
                    metric="weekly_sleep_avg",
                    current_value=averages["duration_hours"],
                    note="Your average sleep this week is below 7 hours. Prioritize sleep for better recovery.",
                ))
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # Activity history
    activity_response = None
    try:
        steps_raw = client.get_activity_time_series("steps", start_date, end_date)
        calories_raw = client.get_activity_time_series("calories", start_date, end_date)
        fairly_raw = client.get_activity_time_series("minutesFairlyActive", start_date, end_date)
        very_raw = client.get_activity_time_series("minutesVeryActive", start_date, end_date)

        steps_by_date = {s["dateTime"]: int(s["value"]) for s in steps_raw.get("activities-steps", [])}
        calories_by_date = {c["dateTime"]: int(c["value"]) for c in calories_raw.get("activities-calories", [])}
        fairly_by_date = {f["dateTime"]: int(f["value"]) for f in fairly_raw.get("activities-minutesFairlyActive", [])}
        very_by_date = {v["dateTime"]: int(v["value"]) for v in very_raw.get("activities-minutesVeryActive", [])}

        records = []
        for date_str in steps_by_date.keys():
            records.append(ActivitySummary(
                date=date_str,
                steps=steps_by_date.get(date_str),
                calories_out=calories_by_date.get(date_str),
                fairly_active_minutes=fairly_by_date.get(date_str),
                very_active_minutes=very_by_date.get(date_str),
            ))
        records.sort(key=lambda r: r.date, reverse=True)

        steps_vals = [r.steps for r in records if r.steps is not None]
        active_vals = [(r.fairly_active_minutes or 0) + (r.very_active_minutes or 0) for r in records]

        averages = {
            "steps": round(sum(steps_vals) / len(steps_vals), 0) if steps_vals else None,
            "active_minutes": round(sum(active_vals) / len(active_vals), 0) if active_vals else None,
        }

        activity_response = ActivityHistoryResponse(
            days_requested=7,
            records=records,
            averages=averages,
            raw_data={"steps": steps_raw, "calories": calories_raw},
            insights=[],
        )

        if averages["steps"]:
            if averages["steps"] < 5000:
                insights.append(Insight(
                    metric="weekly_steps_avg",
                    current_value=averages["steps"],
                    note="Your average daily steps this week is below 5,000. Try to increase daily movement.",
                ))
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # Resting heart rate history
    resting_hr_response = None
    try:
        hr_raw = client.get_heart_rate_range(start_date, end_date)
        records = []
        values = []
        for day_data in hr_raw.get("activities-heart", []):
            date_str = day_data.get("dateTime", "")
            resting_hr = None
            if "value" in day_data and "restingHeartRate" in day_data["value"]:
                resting_hr = day_data["value"]["restingHeartRate"]
                values.append(resting_hr)
            records.append(DateValue(date=date_str, value=resting_hr))
        records.sort(key=lambda r: r.date, reverse=True)

        resting_hr_response = RestingHeartRateHistoryResponse(
            days_requested=7,
            records=records,
            average=round(sum(values) / len(values), 1) if values else None,
            min_value=min(values) if values else None,
            max_value=max(values) if values else None,
            raw_data=hr_raw,
            insights=[],
        )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # Recovery history
    recovery_response = None
    try:
        hrv_raw = client.get_hrv_range(start_date, end_date)
        hrv_records = []
        for entry in hrv_raw.get("hrv", []):
            value = entry.get("value", {})
            hrv_records.append(HRVData(
                date=entry.get("dateTime", ""),
                daily_rmssd=value.get("dailyRmssd"),
                deep_rmssd=value.get("deepRmssd"),
            ))
        hrv_records.sort(key=lambda r: r.date, reverse=True)

        hrv_values = [r.daily_rmssd for r in hrv_records if r.daily_rmssd]
        averages = {
            "hrv_rmssd": round(sum(hrv_values) / len(hrv_values), 1) if hrv_values else None,
        }

        recovery_response = RecoveryHistoryResponse(
            days_requested=7,
            hrv_records=hrv_records,
            spo2_records=[],
            breathing_rate_records=[],
            temperature_records=[],
            averages=averages,
            raw_data={"hrv": hrv_raw},
            insights=[],
        )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    return WeekSummaryResponse(
        start_date=start_date,
        end_date=end_date,
        sleep=sleep_response,
        activity=activity_response,
        resting_heart_rate=resting_hr_response,
        recovery=recovery_response,
        insights=insights,
    )


@router.get("/morning-report", response_model=MorningReportResponse)
async def get_morning_report(
    client: FitbitClient = Depends(get_fitbit_client),
):
    """
    Get morning coaching report - optimized for AI-generated daily coaching.

    Includes:
    - Last night's sleep with comparison to recent average
    - Yesterday's full activity (not today's partial data)
    - Today's recovery metrics (HRV, resting HR, etc.)
    - Recent exercise summary
    - 7-day trends for context
    - Pre-computed insights for AI coaching

    Returns HTTP 429 if Fitbit rate limit is hit.
    """
    try:
        return await _build_morning_report(client)
    except FitbitRateLimitError as e:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": str(e),
                "retry_after": "Wait until the top of the hour for quota reset (150 requests/hour limit)."
            }
        )


async def _build_morning_report(client: FitbitClient) -> MorningReportResponse:
    """Build the morning report, raising FitbitRateLimitError if rate limited."""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")

    insights = []

    # =========================================================================
    # Fetch shared data upfront (avoid duplicate API calls)
    # =========================================================================
    cached_sleep_history = None  # Used for sleep comparison AND trends
    cached_hrv_history = None    # Used for HRV insight AND trends

    try:
        cached_sleep_history = client.get_sleep_range(week_ago, yesterday)
    except FitbitRateLimitError:
        raise
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        cached_hrv_history = client.get_hrv_range(week_ago, yesterday)
    except FitbitRateLimitError:
        raise
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # =========================================================================
    # Last night's sleep
    # =========================================================================
    last_night_sleep = None
    sleep_comparison = None

    try:
        sleep_raw = client.get_sleep_by_date(yesterday)
        if "sleep" in sleep_raw and sleep_raw["sleep"]:
            for entry in sleep_raw["sleep"]:
                if entry.get("isMainSleep", False):
                    last_night_sleep = parse_sleep_record(entry)
                    break
            if not last_night_sleep:
                last_night_sleep = parse_sleep_record(sleep_raw["sleep"][0])

        # Use cached sleep history for comparison
        if last_night_sleep and cached_sleep_history:
            history_records = [
                parse_sleep_record(s) for s in cached_sleep_history.get("sleep", [])
                if s.get("isMainSleep", False) and s.get("dateOfSleep") != last_night_sleep.date
            ]

            if history_records:
                avg_duration = sum(r.duration_hours for r in history_records if r.duration_hours) / len(history_records)
                eff_records = [r for r in history_records if r.efficiency]
                avg_efficiency = sum(r.efficiency for r in eff_records) / len(eff_records) if eff_records else 0

                sleep_comparison = {
                    "vs_7day_avg_duration_hours": round(avg_duration, 2),
                    "vs_7day_avg_efficiency": round(avg_efficiency, 1) if avg_efficiency else None,
                    "duration_diff_hours": round(last_night_sleep.duration_hours - avg_duration, 2) if last_night_sleep.duration_hours else None,
                    "efficiency_diff": round(last_night_sleep.efficiency - avg_efficiency, 1) if last_night_sleep.efficiency and avg_efficiency else None,
                }

                # Sleep insight
                if last_night_sleep.duration_hours:
                    diff = last_night_sleep.duration_hours - avg_duration
                    if diff < -1:
                        insights.append(Insight(
                            metric="sleep_duration",
                            current_value=last_night_sleep.duration_hours,
                            baseline_average=round(avg_duration, 2),
                            comparison="below_average",
                            note=f"You slept {abs(diff):.1f} hours less than your 7-day average."
                        ))
                    elif diff > 1:
                        insights.append(Insight(
                            metric="sleep_duration",
                            current_value=last_night_sleep.duration_hours,
                            baseline_average=round(avg_duration, 2),
                            comparison="above_average",
                            note=f"Great recovery sleep! {diff:.1f} hours more than your average."
                        ))
    except FitbitRateLimitError:
        raise
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # =========================================================================
    # Yesterday's activity (full day)
    # =========================================================================
    yesterday_activity = None
    yesterday_goals_summary = None

    try:
        activity_raw = client.get_activity_by_date(yesterday)
        yesterday_activity = parse_activity_summary(activity_raw, yesterday)

        # Generate goals summary
        if yesterday_activity.goals_met:
            met_count = sum(1 for v in yesterday_activity.goals_met.values() if v)
            total_goals = len(yesterday_activity.goals_met)
            yesterday_goals_summary = f"Met {met_count} of {total_goals} goals"

            if met_count == total_goals:
                insights.append(Insight(
                    metric="goals",
                    current_value=met_count,
                    note="You hit all your activity goals yesterday!"
                ))
            elif met_count == 0:
                insights.append(Insight(
                    metric="goals",
                    current_value=met_count,
                    note="Yesterday was a rest day - no activity goals met."
                ))
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # =========================================================================
    # Today's recovery metrics
    # =========================================================================
    recovery = None
    recovery_raw = {}

    hrv = None
    spo2 = None
    breathing_rate = None
    temperature = None
    cardio_fitness = None

    try:
        hrv_raw = client.get_hrv_by_date(today)
        recovery_raw["hrv"] = hrv_raw
        if "hrv" in hrv_raw and hrv_raw["hrv"]:
            entry = hrv_raw["hrv"][0]
            value = entry.get("value", {})
            hrv = HRVData(
                date=entry.get("dateTime", today),
                daily_rmssd=value.get("dailyRmssd"),
                deep_rmssd=value.get("deepRmssd"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        spo2_raw = client.get_spo2_by_date(today)
        recovery_raw["spo2"] = spo2_raw
        if "value" in spo2_raw:
            value = spo2_raw["value"]
            spo2 = SpO2Data(
                date=spo2_raw.get("dateTime", today),
                avg=value.get("avg"),
                min=value.get("min"),
                max=value.get("max"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        br_raw = client.get_breathing_rate_by_date(today)
        recovery_raw["breathing_rate"] = br_raw
        if "br" in br_raw and br_raw["br"]:
            entry = br_raw["br"][0]
            value = entry.get("value", {})
            breathing_rate = BreathingRateData(
                date=entry.get("dateTime", today),
                breathing_rate=value.get("breathingRate"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        temp_raw = client.get_temperature_by_date(today)
        recovery_raw["temperature"] = temp_raw
        if "tempSkin" in temp_raw and temp_raw["tempSkin"]:
            entry = temp_raw["tempSkin"][0]
            value = entry.get("value", {})
            temperature = TemperatureData(
                date=entry.get("dateTime", today),
                nightly_relative=value.get("nightlyRelative"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    try:
        cardio_raw = client.get_cardio_fitness_by_date(today)
        recovery_raw["cardio_fitness"] = cardio_raw
        if "cardioScore" in cardio_raw and cardio_raw["cardioScore"]:
            entry = cardio_raw["cardioScore"][0]
            value = entry.get("value", {})
            cardio_fitness = CardioFitnessData(
                date=entry.get("dateTime", today),
                vo2_max=value.get("vo2Max"),
                vo2_max_range=f"{value.get('vo2MaxLower', '')}-{value.get('vo2MaxUpper', '')}" if value.get("vo2MaxLower") else None,
                fitness_level=value.get("fitnessLevel"),
            )
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    recovery = RecoveryTodayResponse(
        date=today,
        hrv=hrv,
        spo2=spo2,
        breathing_rate=breathing_rate,
        temperature=temperature,
        cardio_fitness=cardio_fitness,
        raw_data=recovery_raw,
        insights=[],
    )

    # HRV insight with trend (using cached data)
    if hrv and hrv.daily_rmssd and cached_hrv_history:
        hrv_values = [
            e["value"]["dailyRmssd"] for e in cached_hrv_history.get("hrv", [])
            if "value" in e and "dailyRmssd" in e["value"]
        ]
        if hrv_values:
            avg_hrv = sum(hrv_values) / len(hrv_values)
            diff = hrv.daily_rmssd - avg_hrv
            diff_pct = (diff / avg_hrv) * 100 if avg_hrv else 0

            if diff_pct > 15:
                insights.append(Insight(
                    metric="hrv",
                    current_value=round(hrv.daily_rmssd, 1),
                    baseline_average=round(avg_hrv, 1),
                    comparison="above_average",
                    percent_difference=round(diff_pct, 1),
                    note="Your HRV is elevated - good recovery."
                ))
            elif diff_pct < -15:
                insights.append(Insight(
                    metric="hrv",
                    current_value=round(hrv.daily_rmssd, 1),
                    baseline_average=round(avg_hrv, 1),
                    comparison="below_average",
                    percent_difference=round(diff_pct, 1),
                    note="Your HRV is lower than usual."
                ))

    # =========================================================================
    # Recent exercise summary
    # =========================================================================
    exercise_summary = None

    try:
        exercise_raw = client.get_activity_logs((now + timedelta(days=1)).strftime("%Y-%m-%d"), limit=50)
        activities = exercise_raw.get("activities", [])

        yesterday_exercises = []
        week_count = 0
        week_minutes = 0
        week_calories = 0

        for activity in activities:
            activity_date = activity.get("startDate", activity.get("originalStartTime", "")[:10])
            if activity_date < week_ago:
                continue

            duration_ms = activity.get("duration", 0)
            duration_min = round(duration_ms / 60000) if duration_ms else 0
            calories = activity.get("calories", 0)

            week_count += 1
            week_minutes += duration_min
            week_calories += calories

            if activity_date == yesterday:
                yesterday_exercises.append({
                    "name": activity.get("activityName", "Unknown"),
                    "duration_minutes": duration_min,
                    "calories": calories,
                    "average_heart_rate": activity.get("averageHeartRate"),
                })

        exercise_summary = ExerciseSummary(
            yesterday=yesterday_exercises,
            past_week_count=week_count,
            past_week_total_minutes=week_minutes,
            past_week_total_calories=week_calories,
        )

        if yesterday_exercises:
            total_exercise_min = sum(e["duration_minutes"] for e in yesterday_exercises)
            insights.append(Insight(
                metric="exercise",
                current_value=total_exercise_min,
                note=f"You logged {len(yesterday_exercises)} workout(s) yesterday totaling {total_exercise_min} minutes."
            ))
    except FitbitRateLimitError:
        raise
    except FitbitAPIError:
        pass

    # =========================================================================
    # 7-day trends (using cached data where possible)
    # =========================================================================
    trends = None

    try:
        # Collect trend data
        sleep_durations = []
        sleep_efficiencies = []
        steps_values = []
        hrv_values = []
        rhr_values = []

        # Sleep trends (use cached data)
        if cached_sleep_history:
            for entry in cached_sleep_history.get("sleep", []):
                if entry.get("isMainSleep", False):
                    duration_ms = entry.get("duration", 0)
                    if duration_ms:
                        sleep_durations.append(duration_ms / 3600000)
                    if entry.get("efficiency"):
                        sleep_efficiencies.append(entry["efficiency"])

        # Steps trends
        try:
            steps_raw = client.get_activity_time_series("steps", week_ago, yesterday)
            for entry in steps_raw.get("activities-steps", []):
                try:
                    steps_values.append(int(entry["value"]))
                except (ValueError, TypeError):
                    pass
        except FitbitAPIError:
            pass

        # HRV trends (use cached data)
        if cached_hrv_history:
            for entry in cached_hrv_history.get("hrv", []):
                if "value" in entry and "dailyRmssd" in entry["value"]:
                    hrv_values.append(entry["value"]["dailyRmssd"])

        # Resting HR trends
        try:
            hr_history = client.get_heart_rate_range(week_ago, yesterday)
            for entry in hr_history.get("activities-heart", []):
                if "value" in entry and "restingHeartRate" in entry["value"]:
                    rhr_values.append(entry["value"]["restingHeartRate"])
        except FitbitAPIError:
            pass

        # Build trends object
        days_of_data = max(len(sleep_durations), len(steps_values), len(hrv_values), 1)

        trends = RecentTrends(
            days_of_data=days_of_data,
            sleep_avg_duration_hours=round(sum(sleep_durations) / len(sleep_durations), 2) if sleep_durations else None,
            sleep_avg_efficiency=round(sum(sleep_efficiencies) / len(sleep_efficiencies), 1) if sleep_efficiencies else None,
            steps_daily_avg=round(sum(steps_values) / len(steps_values)) if steps_values else None,
            hrv_avg=round(sum(hrv_values) / len(hrv_values), 1) if hrv_values else None,
            resting_hr_avg=round(sum(rhr_values) / len(rhr_values), 1) if rhr_values else None,
        )

        # Add comparison indicators
        if last_night_sleep and last_night_sleep.duration_hours and trends.sleep_avg_duration_hours:
            diff = last_night_sleep.duration_hours - trends.sleep_avg_duration_hours
            trends.sleep_vs_avg = "above" if diff > 0.5 else "below" if diff < -0.5 else "at"

        if hrv and hrv.daily_rmssd and trends.hrv_avg:
            diff = hrv.daily_rmssd - trends.hrv_avg
            trends.hrv_vs_avg = "above" if diff > 3 else "below" if diff < -3 else "at"

        if yesterday_activity and yesterday_activity.steps and trends.steps_daily_avg:
            diff = yesterday_activity.steps - trends.steps_daily_avg
            trends.activity_vs_avg = "above" if diff > 1000 else "below" if diff < -1000 else "at"

    except Exception:
        pass

    # =========================================================================
    # Data summary (quick facts for AI to interpret)
    # =========================================================================
    data_summary = {
        "day_of_week": now.strftime("%A"),
        "is_weekend": now.weekday() >= 5,
    }

    # Sleep quality classification (factual, based on data)
    if last_night_sleep and last_night_sleep.efficiency:
        if last_night_sleep.efficiency >= 85 and (last_night_sleep.duration_hours or 0) >= 7:
            data_summary["sleep_quality"] = "good"
        elif last_night_sleep.efficiency < 75 or (last_night_sleep.duration_hours or 0) < 6:
            data_summary["sleep_quality"] = "poor"
        else:
            data_summary["sleep_quality"] = "moderate"

    # Recovery status classification (factual, based on HRV vs average)
    if hrv and hrv.daily_rmssd and trends and trends.hrv_avg:
        diff_pct = ((hrv.daily_rmssd - trends.hrv_avg) / trends.hrv_avg) * 100
        data_summary["hrv_vs_baseline_percent"] = round(diff_pct, 1)
        if diff_pct > 10:
            data_summary["recovery_status"] = "above_baseline"
        elif diff_pct < -10:
            data_summary["recovery_status"] = "below_baseline"
        else:
            data_summary["recovery_status"] = "at_baseline"

    # Yesterday's activity level classification (factual)
    if yesterday_activity and yesterday_activity.steps:
        data_summary["yesterday_steps"] = yesterday_activity.steps
        if yesterday_activity.steps >= 10000:
            data_summary["activity_level_yesterday"] = "high"
        elif yesterday_activity.steps >= 5000:
            data_summary["activity_level_yesterday"] = "moderate"
        else:
            data_summary["activity_level_yesterday"] = "low"

    return MorningReportResponse(
        report_generated_at=now.isoformat(),
        last_night_sleep=last_night_sleep,
        sleep_comparison=sleep_comparison,
        yesterday_activity=yesterday_activity,
        yesterday_goals_summary=yesterday_goals_summary,
        recovery=recovery,
        exercise_summary=exercise_summary,
        trends=trends,
        insights=insights,
        data_summary=data_summary,
    )
