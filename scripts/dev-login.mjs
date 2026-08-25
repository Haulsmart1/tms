/* Reach an auth-gated page on localhost without waiting for a magic-link email.

   Supabase only emails a magic link to a redirect URL on its allowlist, and
   http://localhost:3000/** is not on this project's. So the email lands on the
   live domain instead and localhost stays locked out. This mints the same link
   locally with the service-role key.

   It is NOT an auth bypass. admin.generateLink returns the identical
   `token_hash` a real magic link carries, and the URL it prints goes through
   app/api/auth/callback/route.ts's normal verifyOtp branch. The token is
   SINGLE-USE and expires, so browser automation must sign in once and reuse the
   one context.

   DANGER: .env.local points NEXT_PUBLIC_SUPABASE_URL at the LIVE hosted
   project. Signing in here reads production data, and anything you then click
   that saves WRITES production data. Read-only passes are safe; use a throwaway
   record before exercising any write path.

     node scripts/dev-login.mjs                     # list usable accounts
     node scripts/dev-login.mjs <email> [nextPath]  # mint a sign-in URL

   This file is committed deliberately: an earlier copy lived untracked and was
   lost, and rediscovering it cost a session. */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.DEV_LOGIN_ORIGIN || "http://localhost:3000";

function loadEnvLocal() {
  const env = {};
  let raw;

  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    console.error("No .env.local found. Copy .env.example and fill it in.");
    process.exit(1);
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }

  return env;
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [email, nextPath = "/dashboard"] = process.argv.slice(2);

if (!email) {
  /* Tenant context only reaches status "ready" when the profile has a
     company_id, so an account without one signs in and then sits on the
     no-tenant panel. Listing that column is the whole point of this branch. */
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, company_id, tenant_id")
    .order("email", { ascending: true });

  if (error) {
    console.error(`Could not list profiles: ${error.message}`);
    process.exit(1);
  }

  console.log(`\nAccounts on ${url}\n`);

  for (const profile of data ?? []) {
    const ready = profile.company_id ? "ready" : "NO company_id, will land on the no-tenant panel";
    console.log(`  ${profile.email ?? profile.id}\n      ${ready}`);
  }

  /* No process.exit(0) here. The Supabase client keeps a handle open, and
     exiting on top of it trips a libuv assertion on Windows that prints
     "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" after the output
     has already been written. It looks like a crash and is not one. Falling
     off the end of the branch instead lets Node close down cleanly. */
  console.log(`\nMint a link:  node scripts/dev-login.mjs <email> [nextPath]\n`);
} else {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    console.error(`Could not generate a link for ${email}: ${error.message}`);
    process.exit(1);
  }

  const hashedToken = data?.properties?.hashed_token;

  if (!hashedToken) {
    console.error("Supabase returned no hashed_token. Does that account exist?");
    process.exit(1);
  }

  const signInUrl = new URL("/api/auth/callback", ORIGIN);
  signInUrl.searchParams.set("token_hash", hashedToken);
  signInUrl.searchParams.set("type", "magiclink");
  signInUrl.searchParams.set("next", nextPath);

  console.log(`\nSingle-use sign-in URL for ${email} (expires; one use only):\n`);
  console.log(signInUrl.toString());
  console.log("");
}
