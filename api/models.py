"""
Pydantic models for API responses.
AI-friendly structures with raw data, computed insights, and trend comparisons.
"""
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


# =============================================================================
# Common Models
# =============================================================================

class Insight(BaseModel):
    """A computed insight comparing current value to baseline."""
    metric: str
    current_value: float | int | None
    baseline_average: float | None = None
    comparison: str | None = None  # "above_average", "below_average", "at_average"
    percent_difference: float | None = None
    note: str | None = None


class DateValue(BaseModel):
    """A value with its associated date."""
    date: str
    value: float | int | None


# =============================================================================
# Sleep Models
# =============================================================================

class SleepStages(BaseModel):
    """Sleep stage breakdown in minutes."""
    deep: int | None = None
    light: int | None = None
    rem: int | None = None
    wake: int | None = None


class SleepRecord(BaseModel):
    """A single sleep record."""
    date: str
    start_time: str | None = None
    end_time: str | None = None
    duration_hours: float | None = None
    time_in_bed_minutes: int | None = None
    minutes_asleep: int | None = None
    minutes_awake: int | None = None
    minutes_to_fall_asleep: int | None = None
    minutes_after_wakeup: int | None = None
    efficiency: int | None = None
    stages: SleepStages | None = None
    is_main_sleep: bool = True


class SleepLastNightResponse(BaseModel):
    """Response for /sleep/last-night endpoint."""
    sleep: SleepRecord | None
    raw_data: dict[str, Any]
    insights: list[Insight] = []


class SleepHistoryResponse(BaseModel):
    """Response for /sleep/history endpoint."""
    days_requested: int
    records: list[SleepRecord]
    averages: dict[str, float | None] = {}
    raw_data: dict[str, Any]
    insights: list[Insight] = []


# =============================================================================
# Activity Models
# =============================================================================

class HeartRateZone(BaseModel):
    """Heart rate zone data."""
    name: str
    minutes: int
    calories_out: float | None = None
    min_hr: int | None = None
    max_hr: int | None = None


class ActivityGoals(BaseModel):
    """Daily activity goals."""
    steps: int | None = None
    calories_out: int | None = None
    distance_km: float | None = None
    floors: int | None = None
    active_minutes: int | None = None


class ActivitySummary(BaseModel):
    """Daily activity summary."""
    date: str
    steps: int | None = None
    calories_out: int | None = None
    calories_bmr: int | None = None
    active_calories: int | None = None
    floors: int | None = None
    elevation: float | None = None
    distance_km: float | None = None
    sedentary_minutes: int | None = None
    lightly_active_minutes: int | None = None
    fairly_active_minutes: int | None = None
    very_active_minutes: int | None = None
    heart_rate_zones: list[HeartRateZone] = []
    goals: ActivityGoals | None = None
    goals_met: dict[str, bool] | None = None  # Which goals were achieved


class ActivityTodayResponse(BaseModel):
    """Response for /activity/today endpoint."""
    summary: ActivitySummary
    raw_data: dict[str, Any]
    insights: list[Insight] = []


class ActivityHistoryResponse(BaseModel):
    """Response for /activity/history endpoint."""
    days_requested: int
    records: list[ActivitySummary]
    averages: dict[str, float | None] = {}
    raw_data: dict[str, Any]
    insights: list[Insight] = []


# =============================================================================
# Exercise Models
# =============================================================================

class ExerciseRecord(BaseModel):
    """A logged exercise/workout."""
    log_id: int
    activity_name: str
    date: str
    start_time: str | None = None
    duration_minutes: int | None = None
    calories: int | None = None
    average_heart_rate: int | None = None
    steps: int | None = None
    distance_km: float | None = None


class ExerciseRecentResponse(BaseModel):
    """Response for /exercises/recent endpoint."""
    days_requested: int
    exercises: list[ExerciseRecord]
    total_workouts: int
    total_calories: int
    total_duration_minutes: int
    raw_data: dict[str, Any]


# =============================================================================
# Heart Rate Models
# =============================================================================

class HeartRateIntraday(BaseModel):
    """Intraday heart rate point."""
    time: str
    value: int


class HeartRateTodayResponse(BaseModel):
    """Response for /heart-rate/today endpoint."""
    date: str
    resting_heart_rate: int | None = None
    zones: list[HeartRateZone] = []
    intraday: list[HeartRateIntraday] = []
    intraday_available: bool = False
    raw_data: dict[str, Any]
    insights: list[Insight] = []


class RestingHeartRateHistoryResponse(BaseModel):
    """Response for /heart-rate/resting/history endpoint."""
    days_requested: int
    records: list[DateValue]
    average: float | None = None
    min_value: int | None = None
    max_value: int | None = None
    raw_data: dict[str, Any]
    insights: list[Insight] = []


# =============================================================================
# Recovery Models (HRV, SpO2, Breathing, Temperature)
# =============================================================================

class HRVData(BaseModel):
    """HRV data for a day."""
    date: str
    daily_rmssd: float | None = None
    deep_rmssd: float | None = None


class SpO2Data(BaseModel):
    """SpO2 data for a day."""
    date: str
    avg: float | None = None
    min: float | None = None
    max: float | None = None


class BreathingRateData(BaseModel):
    """Breathing rate data for a day."""
    date: str
    breathing_rate: float | None = None


class TemperatureData(BaseModel):
    """Skin temperature data for a day."""
    date: str
    nightly_relative: float | None = None


class CardioFitnessData(BaseModel):
    """Cardio fitness (VO2 Max estimate) data."""
    date: str
    vo2_max: float | None = None  # mL/kg/min
    vo2_max_range: str | None = None  # e.g., "44-48"
    fitness_level: str | None = None  # e.g., "Good", "Excellent"


class RecoveryTodayResponse(BaseModel):
    """Response for /recovery/today endpoint."""
    date: str
    hrv: HRVData | None = None
    spo2: SpO2Data | None = None
    breathing_rate: BreathingRateData | None = None
    temperature: TemperatureData | None = None
    cardio_fitness: CardioFitnessData | None = None
    raw_data: dict[str, Any]
    insights: list[Insight] = []


class RecoveryHistoryResponse(BaseModel):
    """Response for /recovery/history endpoint."""
    days_requested: int
    hrv_records: list[HRVData] = []
    spo2_records: list[SpO2Data] = []
    breathing_rate_records: list[BreathingRateData] = []
    temperature_records: list[TemperatureData] = []
    averages: dict[str, float | None] = {}
    raw_data: dict[str, Any]
    insights: list[Insight] = []


# =============================================================================
# Summary Models
# =============================================================================

class TodaySummaryResponse(BaseModel):
    """Response for /summary/today - all data in one call."""
    date: str
    sleep: SleepRecord | None = None
    activity: ActivitySummary | None = None
    heart_rate: HeartRateTodayResponse | None = None
    recovery: RecoveryTodayResponse | None = None
    insights: list[Insight] = []


class WeekSummaryResponse(BaseModel):
    """Response for /summary/week - 7-day trends."""
    start_date: str
    end_date: str
    sleep: SleepHistoryResponse | None = None
    activity: ActivityHistoryResponse | None = None
    resting_heart_rate: RestingHeartRateHistoryResponse | None = None
    recovery: RecoveryHistoryResponse | None = None
    insights: list[Insight] = []


class RecentTrends(BaseModel):
    """Recent trends for context in morning report."""
    days_of_data: int
    sleep_avg_duration_hours: float | None = None
    sleep_avg_efficiency: float | None = None
    steps_daily_avg: int | None = None
    hrv_avg: float | None = None
    resting_hr_avg: float | None = None
    # Comparisons
    sleep_vs_avg: str | None = None  # "above", "below", "at"
    hrv_vs_avg: str | None = None
    activity_vs_avg: str | None = None


class ExerciseSummary(BaseModel):
    """Summary of recent exercises for morning report."""
    yesterday: list[dict[str, Any]] = []  # Workouts from yesterday
    past_week_count: int = 0
    past_week_total_minutes: int = 0
    past_week_total_calories: int = 0


class MorningReportResponse(BaseModel):
    """
    Response for /summary/morning-report - AI coaching context.

    Designed for generating morning coaching messages with:
    - Last night's sleep quality
    - Yesterday's activity (full day)
    - Current recovery state
    - Recent trends for context
    """
    report_generated_at: str

    # Last night's sleep
    last_night_sleep: SleepRecord | None = None
    sleep_comparison: dict[str, Any] | None = None  # vs 7-day average

    # Yesterday's full activity
    yesterday_activity: ActivitySummary | None = None
    yesterday_goals_summary: str | None = None  # e.g., "Met 2 of 3 goals"

    # Today's recovery (reflects last night's sleep)
    recovery: RecoveryTodayResponse | None = None

    # Recent exercise
    exercise_summary: ExerciseSummary | None = None

    # Trend context (7-day)
    trends: RecentTrends | None = None

    # AI-ready insights
    insights: list[Insight] = []
    data_summary: dict[str, Any] | None = None  # Factual classifications for AI context
