"""
Fitbit API Client
Centralized client for all Fitbit API calls with automatic token refresh.
"""
import json
import logging
import os
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

# Optional: Google Cloud Secret Manager for persisting refreshed tokens
try:
    from google.cloud import secretmanager
    HAS_SECRET_MANAGER = True
except ImportError:
    HAS_SECRET_MANAGER = False

# Configure logging
logger = logging.getLogger(__name__)

# Token file path (same as auth module)
TOKEN_FILE = Path(__file__).parent.parent / "output" / ".token.json"
TOKEN_URL = "https://api.fitbit.com/oauth2/token"
BASE_URL = "https://api.fitbit.com"

# Request timeout in seconds
REQUEST_TIMEOUT = 30


class FitbitAPIError(Exception):
    """Exception raised for Fitbit API errors."""
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"HTTP {status_code}: {message}")


class FitbitRateLimitError(FitbitAPIError):
    """Exception raised when Fitbit API rate limit is hit."""
    def __init__(self, message: str = "Rate limit exceeded. Try again later."):
        super().__init__(429, message)


class FitbitClient:
    """
    Fitbit API client with automatic token refresh.
    """

    def __init__(self):
        load_dotenv()
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._client_id = os.getenv("CLIENT_ID")
        self._client_secret = os.getenv("CLIENT_SECRET")
        self._load_token()

    def _load_token(self) -> None:
        """
        Load token from environment variable or cache file.

        Priority:
        1. FITBIT_TOKEN env var (JSON string) - for cloud deployment
        2. Local token file - for local development
        """
        # Try environment variable first (for Cloud Run)
        token_env = os.getenv("FITBIT_TOKEN")
        if token_env:
            try:
                token_data = json.loads(token_env)
                access_token = token_data.get("access_token")
                refresh_token = token_data.get("refresh_token")
                if access_token and refresh_token:
                    self._access_token = access_token
                    self._refresh_token = refresh_token
                    logger.debug("Loaded tokens from FITBIT_TOKEN environment variable")
                    return
                else:
                    logger.warning("FITBIT_TOKEN missing access_token or refresh_token, falling back to file")
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse FITBIT_TOKEN env var: %s", e)

        # Fall back to local file (for local development)
        if TOKEN_FILE.exists():
            try:
                with open(TOKEN_FILE) as f:
                    token_data = json.load(f)
                    self._access_token = token_data.get("access_token")
                    self._refresh_token = token_data.get("refresh_token")
                    logger.debug("Loaded tokens from %s", TOKEN_FILE)
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse token file %s: %s", TOKEN_FILE, e)
            except OSError as e:
                logger.warning("Failed to read token file %s: %s", TOKEN_FILE, e)
        else:
            logger.info("Token file not found at %s. Run authentication first.", TOKEN_FILE)

    def _save_token(self, token_data: dict) -> None:
        """
        Save token - to file for local dev, to Secret Manager for cloud.
        """
        self._access_token = token_data.get("access_token")
        self._refresh_token = token_data.get("refresh_token")

        # Cloud deployment: persist to Secret Manager
        if os.getenv("FITBIT_TOKEN") and HAS_SECRET_MANAGER:
            self._save_token_to_secret_manager(token_data)
        elif os.getenv("FITBIT_TOKEN") and not HAS_SECRET_MANAGER:
            logger.warning(
                "FITBIT_TOKEN is set but Secret Manager unavailable. "
                "Refreshed tokens will not persist across container restarts."
            )
        # Local development: save to file
        elif not os.getenv("FITBIT_TOKEN"):
            try:
                TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
                with open(TOKEN_FILE, "w") as f:
                    json.dump(token_data, f, indent=2)
                logger.debug("Saved tokens to %s", TOKEN_FILE)
            except OSError as e:
                logger.warning("Failed to save token file: %s", e)

    def _save_token_to_secret_manager(self, token_data: dict) -> None:
        """Persist refreshed token to Google Secret Manager."""
        try:
            # Get project ID from metadata server or environment
            project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT")
            if not project_id:
                # Try to get from metadata server (works on Cloud Run)
                try:
                    import urllib.request
                    req = urllib.request.Request(
                        "http://metadata.google.internal/computeMetadata/v1/project/project-id",
                        headers={"Metadata-Flavor": "Google"}
                    )
                    with urllib.request.urlopen(req, timeout=2) as response:
                        project_id = response.read().decode()
                except Exception:
                    logger.warning("Could not determine project ID for Secret Manager")
                    return

            client = secretmanager.SecretManagerServiceClient()
            secret_name = f"projects/{project_id}/secrets/fitbit-token"

            # Add new version with refreshed token
            token_json = json.dumps(token_data)
            client.add_secret_version(
                request={
                    "parent": secret_name,
                    "payload": {"data": token_json.encode("utf-8")},
                }
            )
            logger.info("Persisted refreshed token to Secret Manager")
        except Exception as e:
            # Log but don't fail - token is still valid in memory
            logger.warning("Failed to persist token to Secret Manager: %s", e)

    def _refresh_access_token(self) -> bool:
        """Refresh the access token using the refresh token."""
        if not self._refresh_token or not self._client_id or not self._client_secret:
            logger.warning("Cannot refresh token: missing refresh_token, client_id, or client_secret")
            return False

        try:
            response = requests.post(
                TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": self._refresh_token,
                },
                auth=(self._client_id, self._client_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=REQUEST_TIMEOUT,
            )

            if response.status_code == 200:
                self._save_token(response.json())
                logger.info("Successfully refreshed access token")
                return True
            else:
                logger.error("Token refresh failed with status %d: %s", response.status_code, response.text)
                return False
        except requests.Timeout:
            logger.error("Token refresh request timed out after %d seconds", REQUEST_TIMEOUT)
            return False
        except requests.RequestException as e:
            logger.error("Token refresh request failed: %s", e)
            return False

    def _request(self, endpoint: str, params: dict | None = None) -> dict[str, Any]:
        """
        Make an authenticated request to the Fitbit API.
        Handles token refresh automatically.
        """
        if not self._access_token:
            raise FitbitAPIError(401, "No access token available. Run authentication first.")

        url = f"{BASE_URL}{endpoint}"
        headers = {"Authorization": f"Bearer {self._access_token}"}

        try:
            response = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
        except requests.Timeout:
            logger.error("Request to %s timed out after %d seconds", endpoint, REQUEST_TIMEOUT)
            raise FitbitAPIError(504, f"Request timed out after {REQUEST_TIMEOUT} seconds")
        except requests.RequestException as e:
            logger.error("Request to %s failed: %s", endpoint, e)
            raise FitbitAPIError(503, f"Request failed: {e}")

        # Handle token expiration
        if response.status_code == 401:
            logger.info("Access token expired, attempting refresh")
            if self._refresh_access_token():
                headers = {"Authorization": f"Bearer {self._access_token}"}
                try:
                    response = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
                except requests.Timeout:
                    logger.error("Retry request to %s timed out after %d seconds", endpoint, REQUEST_TIMEOUT)
                    raise FitbitAPIError(504, f"Request timed out after {REQUEST_TIMEOUT} seconds")
                except requests.RequestException as e:
                    logger.error("Retry request to %s failed: %s", endpoint, e)
                    raise FitbitAPIError(503, f"Request failed: {e}")
            else:
                raise FitbitAPIError(401, "Token expired and refresh failed. Re-authenticate.")

        if response.status_code == 429:
            logger.warning("Rate limit exceeded for %s", endpoint)
            raise FitbitRateLimitError("Fitbit API rate limit exceeded (150 requests/hour). Try again later.")

        if response.status_code != 200:
            logger.error("API error for %s: HTTP %d - %s", endpoint, response.status_code, response.text[:200])
            raise FitbitAPIError(response.status_code, response.text)

        return response.json()

    # =========================================================================
    # Sleep Endpoints
    # =========================================================================

    def get_sleep_by_date(self, date: str) -> dict[str, Any]:
        """Get sleep data for a specific date."""
        return self._request(f"/1.2/user/-/sleep/date/{date}.json")

    def get_sleep_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get sleep data for a date range."""
        return self._request(f"/1.2/user/-/sleep/date/{start_date}/{end_date}.json")

    def get_sleep_list(self, before_date: str, limit: int = 7) -> dict[str, Any]:
        """Get a list of sleep logs before a date."""
        return self._request(
            "/1.2/user/-/sleep/list.json",
            params={"beforeDate": before_date, "sort": "desc", "limit": limit, "offset": 0}
        )

    # =========================================================================
    # Activity Endpoints
    # =========================================================================

    def get_activity_by_date(self, date: str) -> dict[str, Any]:
        """Get activity summary for a specific date."""
        return self._request(f"/1/user/-/activities/date/{date}.json")

    def get_activity_time_series(self, resource: str, start_date: str, end_date: str) -> dict[str, Any]:
        """
        Get activity time series data.
        Resources: steps, calories, distance, floors, elevation, minutesSedentary,
                   minutesLightlyActive, minutesFairlyActive, minutesVeryActive
        """
        return self._request(f"/1/user/-/activities/{resource}/date/{start_date}/{end_date}.json")

    # =========================================================================
    # Exercise/Logged Activities
    # =========================================================================

    def get_activity_logs(self, before_date: str, limit: int = 20) -> dict[str, Any]:
        """Get logged exercise activities."""
        return self._request(
            "/1/user/-/activities/list.json",
            params={"beforeDate": before_date, "sort": "desc", "limit": limit, "offset": 0}
        )

    # =========================================================================
    # Heart Rate Endpoints
    # =========================================================================

    def get_heart_rate_by_date(self, date: str, detail_level: str = "1min") -> dict[str, Any]:
        """
        Get heart rate data for a specific date.
        detail_level: 1sec, 1min (requires Personal app type for intraday)
        """
        return self._request(f"/1/user/-/activities/heart/date/{date}/1d/{detail_level}.json")

    def get_heart_rate_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get heart rate data for a date range."""
        return self._request(f"/1/user/-/activities/heart/date/{start_date}/{end_date}.json")

    # =========================================================================
    # Recovery Endpoints (HRV, SpO2, Breathing, Temperature)
    # =========================================================================

    def get_hrv_by_date(self, date: str) -> dict[str, Any]:
        """Get HRV data for a specific date."""
        return self._request(f"/1/user/-/hrv/date/{date}.json")

    def get_hrv_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get HRV data for a date range."""
        return self._request(f"/1/user/-/hrv/date/{start_date}/{end_date}.json")

    def get_spo2_by_date(self, date: str) -> dict[str, Any]:
        """Get SpO2 data for a specific date."""
        return self._request(f"/1/user/-/spo2/date/{date}.json")

    def get_spo2_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get SpO2 data for a date range."""
        return self._request(f"/1/user/-/spo2/date/{start_date}/{end_date}.json")

    def get_breathing_rate_by_date(self, date: str) -> dict[str, Any]:
        """Get breathing rate data for a specific date."""
        return self._request(f"/1/user/-/br/date/{date}.json")

    def get_breathing_rate_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get breathing rate data for a date range."""
        return self._request(f"/1/user/-/br/date/{start_date}/{end_date}.json")

    def get_temperature_by_date(self, date: str) -> dict[str, Any]:
        """Get skin temperature data for a specific date."""
        return self._request(f"/1/user/-/temp/skin/date/{date}.json")

    def get_temperature_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get skin temperature data for a date range."""
        return self._request(f"/1/user/-/temp/skin/date/{start_date}/{end_date}.json")

    def get_cardio_fitness_by_date(self, date: str) -> dict[str, Any]:
        """Get cardio fitness (VO2 Max) data for a specific date."""
        return self._request(f"/1/user/-/cardioscore/date/{date}.json")

    def get_cardio_fitness_range(self, start_date: str, end_date: str) -> dict[str, Any]:
        """Get cardio fitness (VO2 Max) data for a date range."""
        return self._request(f"/1/user/-/cardioscore/date/{start_date}/{end_date}.json")


# Singleton instance for dependency injection
_client: FitbitClient | None = None


def get_fitbit_client() -> FitbitClient:
    """Get or create the Fitbit client singleton."""
    global _client
    if _client is None:
        _client = FitbitClient()
    return _client
