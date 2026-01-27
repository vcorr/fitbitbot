# Code Review Report: Fitbit Personal AI Coach API

**Review date:** January 27, 2025  
**Last re-check:** (after fixes)  
**Scope:** Full codebase (API, auth, endpoints, deployment)

---

## Status Update (Re-check)

Several items from the first review have been **fixed**; three larger refactors are **deferred to a future PR**. This section summarizes current state.

### Fixed ✓

| Item | Location | Change |
|------|----------|--------|
| Global exception handlers | `api/main.py` | `FitbitRateLimitError` → 429, `FitbitAPIError` → 401/403/502 with stable JSON body. |
| Activity history steps average | `api/routers/activity.py` | Uses `recent_steps` / `older_steps` with correct denominator and `if recent_steps and older_steps` guard. |
| Heart rate intraday | `api/routers/heart_rate.py` | Comment clarifies: always request 1min; `include_intraday` only controls whether intraday is returned. No bug. |
| Broad `except Exception` | summary, recovery, heart_rate | Replaced with specific exceptions (e.g. `KeyError`, `TypeError`, `AttributeError`, `ZeroDivisionError`) and `logger.debug(...)`. |
| Auth HTTP timeouts | `auth/__init__.py` | `timeout=30` added to `exchange_code_for_token` and `refresh_token`. |

### Deferred (future PR)

The following are **not** expected to be done in the current cycle; keep as backlog:

- **Activity `/today` 31 API calls** — Refactor to use time-series API (e.g. `get_activity_time_series` over a range) so `/activity/today` uses 1–2 calls instead of 31.
- **Duplicate parsers** — Extract `parse_sleep_record`, `parse_activity_summary`, etc. to a shared module (e.g. `api/parsers.py`).
- **Timezone handling** — Add optional timezone support across routers for “today” / “yesterday” and date ranges (or document server-local dates).

---

## Executive Summary

The project is a well-structured FastAPI backend wrapping the Fitbit API for AI coaching. Documentation is strong and the separation between routers, client, and models is clear. After the recent fixes, the main **remaining issues** are: one **critical bug** (last night’s sleep date), **CORS** in production, **redundant exception handling** in the summary router, and a few **minor** consistency and defensive-coding items. Larger refactors (activity today, parsers, timezone) are documented as deferred.

---

## 1. Bugs

### 1.1 Last night’s sleep date is wrong (Critical) — STILL OPEN

**Location:** `api/routers/summary.py`

Fitbit uses **dateOfSleep** = the date the user **wakes up**. So “last night’s sleep” (the sleep that ended this morning) has `dateOfSleep = today`, not `yesterday`.

- **Morning report** (`_build_morning_report`): uses `get_sleep_by_date(yesterday)` for “last night’s sleep” → returns the **previous** night (e.g. sleep that ended yesterday morning).
- **Today summary** (`get_today_summary`): “Sleep (last night)” also uses `get_sleep_by_date(yesterday)`.

**Fix:** Use `today` when fetching “last night’s sleep” in both places. Keep `yesterday` for “yesterday’s activity” and comparison windows.

Reference: `api/routers/sleep.py` does it correctly — `get_last_night_sleep` uses `today_str` and `get_sleep_by_date(today_str)`.

---

## 2. Security & Configuration

### 2.1 CORS: allow all origins with credentials — STILL OPEN

**Location:** `api/main.py`

```python
allow_origins=["*"],
allow_credentials=True,
```

For production, restrict `allow_origins` to the actual frontend origins (e.g. from env like `CORS_ORIGINS`) and document. Current setup is acceptable for local development only.

---

## 3. Robustness & Error Handling

### 3.1 Fitbit client and broad exceptions — NOTE

**Location:** `api/fitbit_client.py`

- If `_save_token_to_secret_manager` fails, in-memory tokens are still updated; only persistence fails. Document this behavior so “token refresh succeeded but Cloud persistence failed” is clear.
- Optional: log at info when token file is missing or invalid so operators know token wasn’t loaded from file.

The previous “broad exception swallowing” issue in summary, recovery, and heart_rate has been fixed (specific exceptions + logging).

---

## 4. Consistency & Maintainability

### 4.1 Duplicate except FitbitRateLimitError — STILL OPEN

**Location:** `api/routers/summary.py`

Several try blocks have two consecutive identical handlers:

```python
except FitbitRateLimitError:
    raise
except FitbitRateLimitError:
    raise
except FitbitAPIError as e:
    ...
```

Remove the duplicate `except FitbitRateLimitError: raise` in each block.

---

### 4.2 Morning report: redundant HTTPException for rate limit

**Location:** `api/routers/summary.py`, `get_morning_report`

The endpoint catches `FitbitRateLimitError` and raises `HTTPException(status_code=429, ...)`. The global exception handler in `api/main.py` already maps `FitbitRateLimitError` to 429 with a stable body. You can simplify by letting `FitbitRateLimitError` propagate and removing the local try/except in `get_morning_report` (optional cleanup).

---

### 4.3 Mutating Pydantic model after creation

**Location:** `api/routers/summary.py`, ~lines 908–919

`RecentTrends` is created and then `sleep_vs_avg`, `hrv_vs_avg`, `activity_vs_avg` are set on it. With Pydantic v2 this is valid. For clarity and future-proofing (e.g. if the model becomes frozen), consider computing these three fields and passing them into `RecentTrends(...)` in one go.

---

## 5. Deferred (Future PR) — No Action This Cycle

| Item | Description |
|------|-------------|
| **Activity /today 31 API calls** | Refactor to use time-series range API so `/activity/today` uses 1–2 calls instead of 31. |
| **Duplicate parsers** | Extract `parse_sleep_record`, `parse_activity_summary` (and any other shared Fitbit parsers) to e.g. `api/parsers.py`. |
| **Timezone handling** | Add optional timezone support for “today” / “yesterday” and date ranges across routers, or document server-local behavior. |

---

## 6. Data & API Assumptions (Unchanged)

### 6.1 SpO2 range response shape

**Location:** `api/routers/recovery.py`, SpO2 history

The loop `for entry in spo2_raw if isinstance(spo2_raw, list) else [spo2_raw]` may not match Fitbit’s actual range response (e.g. dict with `"value"` containing a list of daily entries). Verify the real response format and ensure one record per day.

### 6.2 Sleep stages summary structure

**Location:** `parse_sleep_record` (sleep.py and summary.py)

Uses `summary.get("deep", {}).get("minutes")` etc. If Fitbit ever returns a non-dict for a stage, this could break. Consider defensive checks (e.g. only call `.get("minutes")` when the value is a dict).

---

## 7. Dependency & Deployment (Unchanged)

- **Legacy endpoints** (`endpoints/*`): use `requests` without timeout; document as local/script-only and add timeouts if they stay in use.
- **Dockerfile**: consider pinning base image tag (e.g. `python:3.13.0-slim`) for reproducible builds.

---

## 8. Summary of Recommendations

| Priority   | Item | Action |
|-----------|------|--------|
| **Critical** | Last night’s sleep date | Use `today` (not `yesterday`) for “last night’s sleep” in summary router (`get_today_summary` and `_build_morning_report`). |
| **High**    | CORS | Restrict `allow_origins` in production; document. |
| **Medium**  | Duplicate `except FitbitRateLimitError` | Remove redundant second handler in each try block in `api/routers/summary.py`. |
| **Low**     | Morning report rate-limit handling | Optional: remove local HTTPException for `FitbitRateLimitError` and rely on global handler. |
| **Low**     | RecentTrends | Optional: build with comparison fields in constructor. |
| **Backlog** | Activity /today, duplicate parsers, timezone | Deferred to future PR; see §5. |

---

## 9. Positive Notes

- Global exception handlers give consistent 429/401/403/502 and error shape.
- Activity history steps trend uses correct averages and guards.
- Error handling in summary, recovery, and heart_rate uses specific exceptions and logging.
- Auth module uses timeouts; Fitbit client already did.
- Clear module layout, good use of FastAPI and Pydantic, strong AGENTS.md and deployment docs.
- Health and docs endpoints are in place.

---

*End of report.*
