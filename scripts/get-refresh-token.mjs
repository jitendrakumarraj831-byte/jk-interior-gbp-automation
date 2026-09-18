#!/usr/bin/env node
/**
 * One-time helper: obtain a Google refresh token for the Business Profile APIs.
 *
 * Run it LOCALLY only. The token is printed to your terminal and never written
 * to disk, never sent anywhere, and must never be committed.
 *
 *   npm run get-refresh-token
 *
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in
 * .env.local, with the redirect URI pointing at http://localhost:5858/callback
 * and that URI registered on the OAuth client in Google Cloud Console.
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

function loadEnvFile(path) {
  try {
    const content = readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env.local is fine — values may come from the shell */
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5858/callback';

if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.');
  console.error('Add them to .env.local first (see .env.example).');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: `${SCOPE} openid email`,
    state,
  }).toString();

async function exchange(code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    console.error(`\nToken exchange failed (HTTP ${response.status}):`);
    console.error(body.error_description || body.error || 'unknown error');
    process.exit(1);
  }
  if (!body.refresh_token) {
    console.error('\nGoogle returned no refresh_token.');
    console.error('Remove this app at https://myaccount.google.com/permissions and rerun.');
    process.exit(1);
  }

  console.log('\n================ GOOGLE_REFRESH_TOKEN ================\n');
  console.log(body.refresh_token);
  console.log('\n======================================================');
  console.log('\nCopy this into .env.local and into your Vercel project');
  console.log('environment variables. Treat it like a password: never');
  console.log('commit it, never paste it into an issue or a chat.\n');
}

const parsedRedirect = new URL(redirectUri);
const isLocalServerFlow =
  parsedRedirect.hostname === 'localhost' || parsedRedirect.hostname === '127.0.0.1';

console.log('\nOpen this URL in the browser signed in as the Business Profile owner:\n');
console.log(authUrl);

if (isLocalServerFlow) {
  const port = Number(parsedRedirect.port || 80);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== parsedRedirect.pathname) {
      response.writeHead(404).end('Not found');
      return;
    }
    if (url.searchParams.get('state') !== state) {
      response.writeHead(400).end('State mismatch. Rerun the script.');
      return;
    }
    const error = url.searchParams.get('error');
    if (error) {
      response.writeHead(400).end(`Google returned: ${error}`);
      server.close();
      process.exit(1);
    }

    response
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<p>Done. Return to your terminal — the refresh token is printed there.</p>');

    server.close();
    await exchange(url.searchParams.get('code'));
    process.exit(0);
  });

  server.listen(port, () => {
    console.log(`\nWaiting for the Google redirect on ${redirectUri} …\n`);
  });
} else {
  console.log(`\nGOOGLE_REDIRECT_URI is ${redirectUri}, which this script cannot listen on.`);
  console.log('Complete the consent screen, then paste the "code" query parameter here.\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Authorization code: ', async (code) => {
    rl.close();
    await exchange(code.trim());
    process.exit(0);
  });
}
