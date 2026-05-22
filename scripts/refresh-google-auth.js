#!/usr/bin/env node

/**
 * Google Health API OAuth 2.0 Re-authentication Script
 *
 * Use this to get fresh Google OAuth tokens after migrating from Fitbit.
 * Tokens do NOT carry over — one-time re-consent is required.
 *
 * Prerequisites:
 *   1. Create an OAuth 2.0 client ID in Google Cloud Console
 *      (Application type: Web application)
 *   2. Add http://localhost:8080/callback as an authorised redirect URI
 *   3. Enable the Google Health API in the project
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/refresh-google-auth.js
 *
 * After running:
 *   1. Upload token to Secret Manager:
 *      gcloud secrets create google-health-token --project=ai-coach-485409
 *      gcloud secrets versions add google-health-token \
 *        --data-file=./output/.google-token.json --project=ai-coach-485409
 *   2. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Secret Manager
 *   3. Update Cloud Run to use GOOGLE_HEALTH_TOKEN secret + new client credentials
 *   4. Set USE_GOOGLE_HEALTH_API=true in Cloud Run env vars to switch the client
 */

import http from 'http';
import { URL } from 'url';
import { writeFileSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { platform } from 'os';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8080/callback';
const PORT = 8080;

// Google Health API OAuth 2.0 scopes — verify at https://developers.google.com/health/setup
const SCOPES = [
  'https://www.googleapis.com/auth/health.activity_and_fitness',
  'https://www.googleapis.com/auth/health.health_metrics_and_measurements',
  'https://www.googleapis.com/auth/health.sleep',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing credentials!');
  console.error('\nUsage:');
  console.error('  GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/refresh-google-auth.js');
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `response_type=code&` +
  `client_id=${encodeURIComponent(CLIENT_ID)}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `scope=${encodeURIComponent(SCOPES)}&` +
  `access_type=offline&` +
  // Force the consent screen even if the user has previously granted access,
  // ensuring we receive a refresh token on every run.
  `prompt=consent`;

console.log('Google Health API OAuth 2.0 Re-authentication\n');
console.log('Opening authorization URL in your browser...\n');
console.log('If the browser does not open automatically, visit:\n');
console.log(authUrl);
console.log('\n');

const openCmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
const openArgs = platform() === 'win32' ? ['/c', 'start', authUrl] : [authUrl];
execFile(openCmd, openArgs, (error) => {
  if (error) console.log('Could not open browser automatically. Please copy the URL above.');
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    console.error(`\nAuthorization failed: ${error}`);
    res.writeHead(400);
    res.end('<h1>Authorization Failed</h1><p>You can close this window.</p>');
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400);
    res.end('<h1>Missing authorization code</h1>');
    server.close();
    process.exit(1);
  }

  console.log('Authorization code received!');
  console.log('Exchanging code for tokens...\n');

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`Token exchange failed: ${tokenResponse.status}`);
      console.error(errorText);
      res.writeHead(500);
      res.end('<h1>Token Exchange Failed</h1><p>Check console for details.</p>');
      server.close();
      process.exit(1);
    }

    const tokens = await tokenResponse.json();

    if (!tokens.refresh_token) {
      console.error(
        '\nWARNING: No refresh_token in response. ' +
        'This can happen if the account already granted access without prompt=consent. ' +
        'Revoke access at https://myaccount.google.com/permissions and try again.'
      );
    }

    // Save only the fields the client needs
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? '',
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    };

    const outputPath = './output/.google-token.json';
    mkdirSync('./output', { recursive: true });
    writeFileSync(outputPath, JSON.stringify(tokenData, null, 2));

    console.log('Tokens saved to:', outputPath);
    console.log('\nToken details:');
    console.log(`  - Expires in: ${tokens.expires_in / 3600} hours`);
    console.log(`  - Scopes: ${tokens.scope}`);
    console.log(`  - Refresh token: ${tokens.refresh_token ? 'received' : 'MISSING - see warning above'}`);
    console.log('\nRe-authentication complete!\n');
    console.log('Next steps:');
    console.log('  1. Create secret (first time only):');
    console.log('     gcloud secrets create google-health-token --project=ai-coach-485409');
    console.log('  2. Upload token:');
    console.log('     gcloud secrets versions add google-health-token --data-file=./output/.google-token.json --project=ai-coach-485409');
    console.log('  3. Add client credentials to Secret Manager:');
    console.log('     echo -n "$GOOGLE_CLIENT_ID" | gcloud secrets create google-client-id --data-file=- --project=ai-coach-485409');
    console.log('     echo -n "$GOOGLE_CLIENT_SECRET" | gcloud secrets create google-client-secret --data-file=- --project=ai-coach-485409');
    console.log('  4. Update Cloud Run service with new env vars:');
    console.log('     gcloud run services update fitbit-api --region=europe-north1 --project=ai-coach-485409 \\');
    console.log('       --update-secrets=GOOGLE_HEALTH_TOKEN=google-health-token:latest,GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest');
    console.log('  5. Enable the Google client (feature flag):');
    console.log('     gcloud run services update fitbit-api --region=europe-north1 --project=ai-coach-485409 \\');
    console.log('       --update-env-vars=USE_GOOGLE_HEALTH_API=true');
    console.log('  6. Test: Check your Grafana dashboard!\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>Success!</title></head>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1 style="color: green;">Authentication Successful!</h1>
          <p>Google Health tokens have been saved. You can close this window.</p>
          <p style="color: #666; font-size: 14px;">Check your terminal for next steps.</p>
        </body>
      </html>
    `);

    server.close();
  } catch (error) {
    console.error('Error during token exchange:', error);
    res.writeHead(500);
    res.end('<h1>Error</h1><p>Check console for details.</p>');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Local server listening on http://localhost:${PORT}`);
  console.log('Waiting for Google authorization...\n');
});

process.on('SIGINT', () => {
  console.log('\nCancelled by user');
  server.close();
  process.exit(0);
});
