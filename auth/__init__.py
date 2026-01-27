"""
Fitbit OAuth 2.0 Authorization Code Flow
"""
import os
import json
import webbrowser
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

import requests
from dotenv import load_dotenv

# Fitbit OAuth endpoints
AUTH_URL = "https://www.fitbit.com/oauth2/authorize"
TOKEN_URL = "https://api.fitbit.com/oauth2/token"
CALLBACK_URL = "http://localhost:8080/callback"
TOKEN_FILE = Path(__file__).parent.parent / "output" / ".token.json"

# Scopes for all data types we want to access
SCOPES = [
    "activity",
    "heartrate",
    "sleep",
    "oxygen_saturation",
    "respiratory_rate",
    "temperature",
    "cardio_fitness",
]


class CallbackHandler(BaseHTTPRequestHandler):
    """HTTP handler to capture OAuth callback."""

    auth_code = None

    def do_GET(self):
        """Handle GET request from Fitbit callback."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "code" in params:
            CallbackHandler.auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"""
                <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1>Authorization Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                </body>
                </html>
            """)
        else:
            error = params.get("error", ["Unknown error"])[0]
            self.send_response(400)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(f"<html><body><h1>Error: {error}</h1></body></html>".encode())

    def log_message(self, format, *args):
        """Suppress HTTP server logs."""
        pass


def load_credentials():
    """Load CLIENT_ID and CLIENT_SECRET from .env file."""
    load_dotenv()

    client_id = os.getenv("CLIENT_ID")
    client_secret = os.getenv("CLIENT_SECRET")

    if not client_id or not client_secret:
        print("\nError: Missing credentials!")
        print("Please create a .env file with CLIENT_ID and CLIENT_SECRET")
        print("See .env.example for the template")
        print("\nTo get credentials:")
        print("1. Go to https://dev.fitbit.com/apps/new")
        print("2. Register a new application:")
        print("   - Application Type: Personal (required for intraday data)")
        print("   - Callback URL: http://localhost:8080/callback")
        print("3. Copy your Client ID and Client Secret to .env")
        return None, None

    return client_id, client_secret


def load_cached_token():
    """Load token from cache if available and valid."""
    if not TOKEN_FILE.exists():
        return None

    try:
        with open(TOKEN_FILE) as f:
            token_data = json.load(f)

        # Check if we have an access token
        if "access_token" in token_data:
            return token_data
    except (json.JSONDecodeError, IOError):
        pass

    return None


def save_token(token_data):
    """Save token to cache file."""
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)


def get_authorization_code(client_id):
    """Open browser for user authorization and capture callback."""
    # Build authorization URL
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK_URL,
        "scope": " ".join(SCOPES),
    }
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"

    print("\nOpening browser for Fitbit authorization...")
    print(f"If browser doesn't open, go to:\n{auth_url}\n")

    # Start local server to capture callback
    server = HTTPServer(("localhost", 8080), CallbackHandler)

    # Open browser
    webbrowser.open(auth_url)

    # Wait for callback (single request)
    print("Waiting for authorization...")
    server.handle_request()
    server.server_close()

    return CallbackHandler.auth_code


def exchange_code_for_token(client_id, client_secret, auth_code):
    """Exchange authorization code for access token."""
    response = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": CALLBACK_URL,
        },
        auth=(client_id, client_secret),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )

    if response.status_code != 200:
        print(f"Error getting token: {response.status_code}")
        print(response.text)
        return None

    return response.json()


def refresh_token(client_id, client_secret, token_data):
    """Refresh an expired access token."""
    if "refresh_token" not in token_data:
        return None

    response = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": token_data["refresh_token"],
        },
        auth=(client_id, client_secret),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )

    if response.status_code != 200:
        return None

    return response.json()


def authenticate():
    """
    Main authentication function.
    Returns access_token string or None if auth fails.
    """
    client_id, client_secret = load_credentials()
    if not client_id:
        return None

    # Try cached token first
    token_data = load_cached_token()
    if token_data:
        print("Found cached token, attempting to use...")

        # Try refreshing the token
        new_token = refresh_token(client_id, client_secret, token_data)
        if new_token:
            print("Token refreshed successfully!")
            save_token(new_token)
            return new_token["access_token"]
        else:
            print("Token expired, need to re-authorize...")

    # Get fresh authorization
    auth_code = get_authorization_code(client_id)
    if not auth_code:
        print("Failed to get authorization code")
        return None

    # Exchange for token
    token_data = exchange_code_for_token(client_id, client_secret, auth_code)
    if not token_data:
        return None

    # Save and return
    save_token(token_data)
    print("Authentication successful!")

    return token_data["access_token"]
