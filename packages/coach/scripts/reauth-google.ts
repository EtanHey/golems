#!/usr/bin/env bun
/**
 * One-time script to re-authorize Google OAuth with both Gmail + Calendar scopes.
 * Opens browser → user clicks Allow → prints new refresh token.
 *
 * Usage: bun scripts/reauth-google.ts
 */

import "@golems/shared/lib/load-env";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

const REDIRECT_URI = "http://localhost:9876";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  REDIRECT_URI,
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // Force re-consent to get new refresh token
  scope: SCOPES,
});

console.log("\n🔑 Opening browser for Google OAuth...\n");
console.log("If it doesn't open, visit:\n", authUrl, "\n");

// Open in Brave
Bun.spawn(["open", "-a", "Brave Browser", authUrl]);

// Start local server to catch the callback
const server = Bun.serve({
  port: 9876,
  async fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("\n❌ Auth error:", error);
      setTimeout(() => process.exit(1), 100);
      return new Response(`Auth error: ${error}`, { status: 400 });
    }

    if (!code) {
      return new Response("Waiting for OAuth callback...", { status: 200 });
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log("\n✅ Got tokens!");
      console.log("\nGMAIL_REFRESH_TOKEN=" + tokens.refresh_token);
      console.log("\nScopes:", tokens.scope);
      console.log(
        "\nUpdate your .env file and 1Password with the new GMAIL_REFRESH_TOKEN above.",
      );

      setTimeout(() => process.exit(0), 500);
      return new Response(
        "<h1>Success!</h1><p>Got refresh token. You can close this tab.</p>",
        { headers: { "Content-Type": "text/html" } },
      );
    } catch (err) {
      console.error("\n❌ Token exchange failed:", err);
      setTimeout(() => process.exit(1), 100);
      return new Response(`Token exchange failed: ${err}`, { status: 500 });
    }
  },
});

console.log(`Listening on http://localhost:${server.port} for callback...`);
