#!/usr/bin/env node

/**
 * Fitbit OAuth 2.0 Re-authentication Script
 *
 * This script helps you get fresh Fitbit tokens by:
 * 1. Opening the Fitbit authorization URL in your browser
 * 2. Starting a local server to receive the callback
 * 3. Exchanging the auth code for tokens
 * 4. Saving tokens to output/.token.json
 */

import http from 'http';
import { URL } from 'url';
import { writeFileSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { platform } from 'os';

// Configuration (env vars only — CLI args expose secrets in process listings)
const CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8080/callback';
const PORT = 8080;

// Scopes needed for the app
const SCOPES = encodeURIComponent([
  'activity',
  'heartrate',
  'sleep',
  'respiratory_rate',
  'temperature',
  'oxygen_saturation'
].join(' '));

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing credentials!');
  console.error('\nUsage:');
  console.error('  FITBIT_CLIENT_ID=xxx FITBIT_CLIENT_SECRET=yyy node scripts/refresh-fitbit-auth.js');
  process.exit(1);
}

// Build authorization URL
const authUrl = `https://www.fitbit.com/oauth2/authorize?` +
  `response_type=code&` +
  `client_id=${CLIENT_ID}&` +
  `scope=${SCOPES}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

console.log('🔐 Fitbit OAuth 2.0 Re-authentication\n');
console.log('Opening authorization URL in your browser...\n');
console.log('If browser doesn\'t open automatically, visit:\n');
console.log(authUrl);
console.log('\n');

// Open browser (cross-platform, no shell to avoid command injection)
const openCmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
const openArgs = platform() === 'win32' ? ['/c', 'start', authUrl] : [authUrl];
execFile(openCmd, openArgs, (error) => {
  if (error) {
    console.log('Could not open browser automatically. Please copy the URL above.');
  }
});

// Start local server to receive callback
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
    console.error(`\n❌ Authorization failed: ${error}`);
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

  console.log('✅ Authorization code received!');
  console.log('Exchanging code for tokens...\n');

  // Exchange code for tokens
  try {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`❌ Token exchange failed: ${tokenResponse.status}`);
      console.error(errorText);
      res.writeHead(500);
      res.end('<h1>Token Exchange Failed</h1><p>Check console for details.</p>');
      server.close();
      process.exit(1);
    }

    const tokens = await tokenResponse.json();

    // Save tokens
    const outputPath = './output/.token.json';
    mkdirSync('./output', { recursive: true });
    writeFileSync(outputPath, JSON.stringify(tokens, null, 2));

    console.log('✅ Tokens saved to:', outputPath);
    console.log('\nToken details:');
    console.log(`  - User ID: ${tokens.user_id}`);
    console.log(`  - Expires in: ${tokens.expires_in / 3600} hours`);
    console.log(`  - Scopes: ${tokens.scope}`);
    console.log('\n🎉 Re-authentication complete!\n');
    console.log('Next steps:');
    console.log('  1. Upload token to Secret Manager:');
    console.log('     gcloud secrets versions add fitbit-token --data-file=./output/.token.json --project=ai-coach-485409');
    console.log('  2. Restart Cloud Run:');
    console.log('     gcloud run services update fitbit-api --region=europe-north1 --project=ai-coach-485409 --update-labels=token-update=v8');
    console.log('  3. Test: Check your Grafana dashboard!\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>Success!</title></head>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1 style="color: green;">✅ Authentication Successful!</h1>
          <p>Tokens have been saved. You can close this window.</p>
          <p style="color: #666; font-size: 14px;">Check your terminal for next steps.</p>
        </body>
      </html>
    `);

    server.close();
  } catch (error) {
    console.error('❌ Error during token exchange:', error);
    res.writeHead(500);
    res.end('<h1>Error</h1><p>Check console for details.</p>');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\n🌐 Local server listening on http://localhost:${PORT}`);
  console.log('Waiting for Fitbit authorization...\n');
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n❌ Cancelled by user');
  server.close();
  process.exit(0);
});
