"""
Fitbit API endpoint modules.
"""
from . import sleep, heart_rate, hrv, spo2, activity, breathing, temperature

ALL_ENDPOINTS = [
    ("Sleep", sleep),
    ("Heart Rate", heart_rate),
    ("HRV", hrv),
    ("SpO2", spo2),
    ("Activity", activity),
    ("Breathing Rate", breathing),
    ("Temperature", temperature),
]
