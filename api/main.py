"""
Fitbit Personal AI Coach API

FastAPI backend serving Fitbit data for a personal AI coach.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .fitbit_client import FitbitAPIError, FitbitRateLimitError
from .routers import sleep, activity, exercise, heart_rate, recovery, summary, trends

app = FastAPI(
    title="Fitbit Personal AI Coach API",
    description="""
API for accessing Fitbit health and fitness data, optimized for AI coaching applications.

## Features

- **Sleep**: Sleep duration, efficiency, and stage analysis
- **Activity**: Steps, calories, active minutes, and heart rate zones
- **Exercise**: Logged workouts with duration, calories, and heart rate
- **Heart Rate**: Resting HR, zones, and intraday data
- **Recovery**: HRV, SpO2, breathing rate, and temperature
- **Summary**: Aggregated data endpoints for AI context

## Response Format

All responses include:
- Raw data from Fitbit API
- Computed insights comparing to historical baselines
- AI-friendly structured data
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(sleep.router)
app.include_router(activity.router)
app.include_router(exercise.router)
app.include_router(heart_rate.router)
app.include_router(recovery.router)
app.include_router(summary.router)
app.include_router(trends.router)


# Global exception handlers for Fitbit API errors
@app.exception_handler(FitbitRateLimitError)
async def rate_limit_handler(request: Request, exc: FitbitRateLimitError):
    """Handle Fitbit rate limit errors globally."""
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": "Fitbit API rate limit exceeded (150 requests/hour). Try again later.",
            "retry_after": "Wait until the top of the hour for quota reset.",
        },
    )


@app.exception_handler(FitbitAPIError)
async def fitbit_api_error_handler(request: Request, exc: FitbitAPIError):
    """Handle general Fitbit API errors globally."""
    # Map to appropriate HTTP status
    if exc.status_code == 401:
        status = 401
        error = "authentication_error"
    elif exc.status_code == 403:
        status = 403
        error = "forbidden"
    else:
        status = 502  # Bad Gateway - upstream error
        error = "upstream_error"

    return JSONResponse(
        status_code=status,
        content={
            "error": error,
            "message": exc.message,
            "fitbit_status": exc.status_code,
        },
    )


@app.get("/", tags=["Health"])
async def root():
    """API health check and welcome message."""
    return {
        "message": "Fitbit Personal AI Coach API",
        "status": "healthy",
        "docs": "/docs",
        "endpoints": {
            "sleep": {
                "/sleep/last-night": "Most recent sleep with full stage data",
                "/sleep/history": "Sleep trends (duration, efficiency, stages by day)",
            },
            "activity": {
                "/activity/today": "Today's steps, calories, active minutes, HR zones",
                "/activity/history": "Daily activity trends",
            },
            "exercises": {
                "/exercises/recent": "Logged workouts with HR, duration, calories",
            },
            "heart_rate": {
                "/heart-rate/today": "Resting HR, zones, optional intraday",
                "/heart-rate/resting/history": "Resting HR trend",
            },
            "recovery": {
                "/recovery/today": "HRV, SpO2, breathing rate, temperature",
                "/recovery/history": "Recovery metrics trend",
            },
            "summary": {
                "/summary/today": "All today's data in one call (for AI context)",
                "/summary/week": "7-day summary with trends",
            },
            "trends": {
                "/trends/analysis": "Pre-computed trend analysis with weekday/weekend patterns (graceful with limited data)",
            },
        },
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy"}
