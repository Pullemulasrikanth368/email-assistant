#!/usr/bin/env node
/**
 * Microsoft 365 Developer Account & Azure App Setup Validator
 *
 * This script helps you verify that your Microsoft 365 Developer account
 * and Azure App Registration are correctly configured for the Outlook
 * email-reading integration.
 *
 * Usage:
 *   node scripts/setup-outlook-dev.js
 *   node scripts/setup-outlook-dev.js --test-auth   (after setting env vars)
 *
 * Steps it covers:
 *   1. Validates all required environment variables
 *   2. Verifies the Azure App Registration is reachable
 *   3. Prints the exact redirect URIs to register in Azure
 *   4. Prints the exact API permissions to add in Azure
 *   5. Optionally tests the token endpoint with client credentials
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const https = require("https");
const readline = require("readline");

/* ─────────────────────── colour helpers ─────────────────────── */
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
};
const ok    = (msg) => console.log(`  ${c.green}✓${c.reset} ${msg}`);
const fail  = (msg) => console.log(`  ${c.red}✗${c.reset} ${msg}`);
const warn  = (msg) => console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
const info  = (msg) => console.log(`  ${c.cyan}→${c.reset} ${msg}`);
const head  = (msg) => console.log(`\n${c.bold}${msg}${c.reset}`);
const line  = ()    => console.log(c.grey + "─".repeat(60) + c.reset);

/* ─────────────────────── config read ─────────────────────── */

const ENV = process.env.ENVIRONMENT || "LOCAL";
const PREFIX = ENV.toUpperCase() + "_";

function getEnv(...keys) {
  for (const k of keys) {
    if (process.env[k]) return process.env[k];
  }
  return null;
}

const PORT   = getEnv(`${PREFIX}PORT`, "LOCAL_PORT", "PORT") || "8676";
const SERVER = getEnv(`${PREFIX}SERVER_URL`, "LOCAL_SERVER_URL") || `http://localhost:${PORT}/`;

const REQUIRED_VARS = [
  { key: "MICROSOFT_CLIENT_ID",  label: "Azure App Client ID",     envName: "MICROSOFT_CLIENT_ID"  },
  { key: "MICROSOFT_SECRET",     label: "Azure App Client Secret", envName: "MICROSOFT_SECRET"      },
  { key: "MICROSOFT_TENANT_ID",  label: "Azure Tenant ID",         envName: "MICROSOFT_TENANT_ID",  optional: true },
];

const outlookRedirectUri = getEnv("MS_OUTLOOK_REDIRECT_URI") ||
  `${SERVER}api/auth/microsoft/outlook/webhook`;

const teamsRedirectUri = getEnv("MS_TEAMS_REDIRECT_URI") ||
  `${SERVER}api/auth/microsoft/teams/webhook`;

/* ─────────────────────── 1. banner ─────────────────────── */

console.log();
console.log(`${c.bold}${c.cyan}══════════════════════════════════════════════════════════${c.reset}`);
console.log(`${c.bold}${c.cyan}  Outlook Dev Setup Validator — Executive Email Assistant  ${c.reset}`);
console.log(`${c.bold}${c.cyan}══════════════════════════════════════════════════════════${c.reset}`);

/* ─────────────────────── 2. env checks ─────────────────────── */

head("Step 1 — Environment variables");
line();

let allPresent = true;
for (const v of REQUIRED_VARS) {
  const value = process.env[v.key];
  if (value) {
    ok(`${v.label} (${v.envName}) is set`);
  } else if (v.optional) {
    warn(`${v.label} (${v.envName}) is not set — will use "common" tenant`);
  } else {
    fail(`${v.label} (${v.envName}) is MISSING — add to your .env`);
    allPresent = false;
  }
}

if (!allPresent) {
  console.log();
  warn("Fix the missing variables in your .env file and re-run.");
  console.log();
  process.exit(1);
}

/* ─────────────────────── 3. redirect URIs ─────────────────────── */

head("Step 2 — Redirect URIs to register in Azure");
line();
console.log(`  Add BOTH of these as "Web" redirect URIs in your Azure App Registration:`);
console.log();
console.log(`  ${c.cyan}Outlook (mail reading):${c.reset}`);
console.log(`    ${c.bold}${outlookRedirectUri}${c.reset}`);
console.log();
console.log(`  ${c.cyan}Teams (message delivery):${c.reset}`);
console.log(`    ${c.bold}${teamsRedirectUri}${c.reset}`);
console.log();
console.log(`  ${c.grey}Portal path: App registrations → <your app> → Authentication → + Add a platform → Web${c.reset}`);

/* ─────────────────────── 4. API permissions ─────────────────────── */

head("Step 3 — API Permissions to add in Azure");
line();
console.log(`  Add these DELEGATED permissions under Microsoft Graph:`);
console.log();

const PERMISSIONS = [
  { name: "User.Read",         purpose: "Read signed-in user profile",              existing: true  },
  { name: "Mail.Read",         purpose: "Read user's mailbox messages",             existing: false },
  { name: "Mail.ReadWrite",    purpose: "Read + move emails to Deleted Items",      existing: false },
  { name: "Mail.Send",         purpose: "Send replies / quick replies via Outlook", existing: false },
  { name: "Team.ReadBasic.All",purpose: "List user's Teams (for delivery picker)",  existing: true  },
  { name: "Channel.ReadBasic.All", purpose: "List channels in a team",             existing: true  },
  { name: "ChannelMessage.Send",   purpose: "Post briefs to a Teams channel",       existing: true  },
  { name: "offline_access",    purpose: "Get refresh tokens (keep session alive)",  existing: true  },
];

for (const p of PERMISSIONS) {
  const tag = p.existing ? `${c.grey}[existing]${c.reset}` : `${c.yellow}[NEW — add this]${c.reset}`;
  console.log(`  ${c.bold}${p.name}${c.reset} — ${p.purpose} ${tag}`);
}

console.log();
console.log(`  ${c.grey}Portal path: App registrations → <your app> → API permissions → + Add a permission → Microsoft Graph → Delegated${c.reset}`);
console.log();
warn("After adding permissions, click 'Grant admin consent for <tenant>' if required by your org.");

/* ─────────────────────── 5. developer account guide ─────────────────────── */

head("Step 4 — Microsoft 365 Developer Account (for local testing)");
line();
console.log(`
  To test with a real Outlook mailbox without using a production account:

  ${c.bold}Option A — Microsoft 365 Developer Program (free, recommended)${c.reset}
  ┌─────────────────────────────────────────────────────────────┐
  │  1. Go to: https://developer.microsoft.com/en-us/microsoft365/dev-program
  │  2. Click "Join now" → sign in with a Microsoft account
  │  3. Choose "Instant sandbox" (E5 subscription, 25 licences)
  │  4. Note your admin account: admin@<yoursubdomain>.onmicrosoft.com
  │  5. You get a real Outlook inbox at that address
  │  6. Create your Azure App in the SAME tenant as the dev program
  └─────────────────────────────────────────────────────────────┘

  ${c.bold}Option B — Personal Microsoft account${c.reset}
  ┌─────────────────────────────────────────────────────────────┐
  │  1. Use any @outlook.com / @hotmail.com / @live.com account
  │  2. Create an Azure App with MICROSOFT_TENANT_ID=common
  │  3. This allows any Microsoft account to connect
  └─────────────────────────────────────────────────────────────┘

  ${c.bold}Azure App Registration (if you don't have one yet):${c.reset}
  ┌─────────────────────────────────────────────────────────────┐
  │  1. Go to: https://portal.azure.com → App registrations
  │  2. Click "New registration"
  │  3. Name: "Executive Email Assistant" (or any name)
  │  4. Supported account types: "Accounts in any org + personal"
  │  5. Redirect URI: Web → (leave blank for now, add via script output)
  │  6. Click Register
  │  7. Copy "Application (client) ID" → MICROSOFT_CLIENT_ID
  │  8. Certificates & secrets → New client secret → Copy → MICROSOFT_SECRET
  │  9. Overview → Directory (tenant) ID → MICROSOFT_TENANT_ID
  └─────────────────────────────────────────────────────────────┘
`);

/* ─────────────────────── 6. .env template ─────────────────────── */

head("Step 5 — .env entries for Outlook integration");
line();
const clientId = process.env.MICROSOFT_CLIENT_ID || "<your-azure-client-id>";
const tenant   = process.env.MICROSOFT_TENANT_ID  || "common";

console.log(`  Add / update these in your ${c.bold}server/.env${c.reset}:\n`);
console.log(`${c.grey}# Microsoft Azure App (shared by Teams + Outlook)${c.reset}`);
console.log(`MICROSOFT_CLIENT_ID=${clientId}`);
console.log(`MICROSOFT_SECRET=<your-azure-client-secret>`);
console.log(`MICROSOFT_TENANT_ID=${tenant}`);
console.log();
console.log(`${c.grey}# Outlook email-reading redirect URI (must match Azure registration)${c.reset}`);
console.log(`MS_OUTLOOK_REDIRECT_URI=http://localhost:${PORT}/api/auth/microsoft/outlook/webhook`);
console.log();
console.log(`${c.grey}# Teams delivery redirect URI (must match Azure registration)${c.reset}`);
console.log(`MS_TEAMS_REDIRECT_URI=http://localhost:${PORT}/api/auth/microsoft/teams/webhook`);

/* ─────────────────────── 7. optional token test ─────────────────────── */

if (process.argv.includes("--test-auth")) {
  head("Step 6 — Testing Azure token endpoint reachability");
  line();

  const clientId     = process.env.MICROSOFT_CLIENT_ID;
  const tenant       = process.env.MICROSOFT_TENANT_ID || "common";
  const tokenUrl     = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  info(`Testing POST ${tokenUrl}`);

  // We just test that the endpoint is reachable (don't have a code yet).
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: process.env.MICROSOFT_SECRET,
    grant_type:    "client_credentials",
    scope:         "https://graph.microsoft.com/.default",
  }).toString();

  const url = new URL(tokenUrl);
  const options = {
    hostname: url.hostname,
    path:     url.pathname,
    method:   "POST",
    headers:  {
      "Content-Type":   "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => {
      try {
        const json = JSON.parse(data);
        if (json.access_token) {
          ok("Azure token endpoint responded with an access_token ✓");
          ok("App Registration credentials are valid!");
        } else if (json.error) {
          warn(`Azure responded: ${json.error} — ${json.error_description}`);
          if (json.error === "invalid_client") {
            fail("Client secret is wrong or expired. Generate a new one in Azure portal.");
          } else if (json.error === "unauthorized_client") {
            warn("Client credentials flow not allowed (normal for delegated-only apps).");
            info("This is expected — the app uses delegated auth (OAuth2 browser flow), not client credentials.");
            ok("Redirect URI and API permissions setup is what matters for this app.");
          }
        }
      } catch {
        warn(`Could not parse response: ${data.slice(0, 200)}`);
      }
      printSummary();
    });
  });
  req.on("error", (err) => {
    fail(`Could not reach Azure: ${err.message}`);
    printSummary();
  });
  req.write(body);
  req.end();
} else {
  printSummary();
}

/* ─────────────────────── summary ─────────────────────── */

function printSummary() {
  head("Summary — What to do next");
  line();
  console.log(`
  ${c.bold}1.${c.reset} Register redirect URIs in Azure (printed above in Step 2)
  ${c.bold}2.${c.reset} Add the NEW API permissions in Azure (Step 3)
  ${c.bold}3.${c.reset} Add/update your .env with the entries from Step 5
  ${c.bold}4.${c.reset} Start the server: ${c.cyan}cd server && npm run dev${c.reset}
  ${c.bold}5.${c.reset} Open the app → Connections & Delivery → click "Connect Outlook"
  ${c.bold}6.${c.reset} Sign in with your Microsoft 365 Dev / personal Microsoft account
  ${c.bold}7.${c.reset} Watch the Inbox Triage page — Outlook emails will appear within ~30s

  ${c.grey}Re-run this script anytime: node scripts/setup-outlook-dev.js${c.reset}
  ${c.grey}Test auth:                  node scripts/setup-outlook-dev.js --test-auth${c.reset}
  `);
  console.log(`${c.bold}${c.cyan}══════════════════════════════════════════════════════════${c.reset}`);
  console.log();
}
