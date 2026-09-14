import crypto from "node:crypto";
import { createAdminClient } from "../server";

const AUTHORIZE_URL =
  "https://login.xero.com/identity/connect/authorize";

const TOKEN_URL =
  "https://identity.xero.com/connect/token";

const REVOCATION_URL =
  "https://identity.xero.com/connect/revocation";

const CONNECTIONS_URL =
  "https://api.xero.com/connections";

const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.invoices",
  "accounting.payments",
  "accounting.contacts",
  "accounting.settings",
  "accounting.attachments",
].join(" ");

type XeroTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

type XeroConnection = {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string | null;
  createdDateUtc: string;
  updatedDateUtc: string;
};

type StoredCredential = {
  id: string;
  tenant_id: string;
  integration_id: string;
  provider: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string | null;
  scope: string | null;
  expires_at: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function encryptionKey(): Buffer {
  const raw = requireEnv("ACCOUNTING_TOKEN_ENCRYPTION_KEY");

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "ACCOUNTING_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
    );
  }

  return key;
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, encryptedPart] =
    payload.split(".");

  if (
    version !== "v1" ||
    !ivPart ||
    !tagPart ||
    !encryptedPart
  ) {
    throw new Error("Stored accounting credential is invalid.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64url")
  );

  decipher.setAuthTag(
    Buffer.from(tagPart, "base64url")
  );

  const decrypted = Buffer.concat([
    decipher.update(
      Buffer.from(encryptedPart, "base64url")
    ),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function basicAuthorization(): string {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");

  return `Basic ${Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64")}`;
}

export function xeroRedirectUri(): string {
  return requireEnv("XERO_REDIRECT_URI");
}

export function createXeroAuthorizationUrl(
  state: string
): string {
  const url = new URL(AUTHORIZE_URL);

  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "client_id",
    requireEnv("XERO_CLIENT_ID")
  );
  url.searchParams.set(
    "redirect_uri",
    xeroRedirectUri()
  );
  url.searchParams.set("scope", XERO_SCOPES);
  url.searchParams.set("state", state);

  return url.toString();
}

async function tokenRequest(
  params: URLSearchParams
): Promise<XeroTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(),
      "Content-Type":
        "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
    cache: "no-store",
  });

  const body = (await response.json()) as
    | XeroTokenResponse
    | { error?: string; error_description?: string };

  if (!response.ok) {
    const errorBody = body as {
      error?: string;
      error_description?: string;
    };

    throw new Error(
      errorBody.error_description ||
        errorBody.error ||
        `Xero token request failed (${response.status}).`
    );
  }

  return body as XeroTokenResponse;
}

export async function exchangeXeroCode(
  code: string
): Promise<XeroTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: xeroRedirectUri(),
    })
  );
}

export async function refreshXeroToken(
  refreshToken: string
): Promise<XeroTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

function decodeJwtPayload(
  token: string
): Record<string, unknown> {
  const parts = token.split(".");

  if (parts.length < 2) {
    return {};
  }

  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString(
        "utf8"
      )
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The authentication_event_id claim, which scopes /connections to this consent. */
export function xeroAuthEventId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  return typeof payload.authentication_event_id === "string"
    ? payload.authentication_event_id
    : null;
}

export async function getXeroConnections(
  accessToken: string
): Promise<XeroConnection[]> {
  const authEventId = xeroAuthEventId(accessToken);

  const url = new URL(CONNECTIONS_URL);

  if (authEventId) {
    url.searchParams.set(
      "authEventId",
      authEventId
    );
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      `Unable to read Xero organisations (${response.status}).`
    );
  }

  return (body as XeroConnection[]).filter(
    (connection) =>
      connection.tenantType === "ORGANISATION"
  );
}

/**
  Stores the token pair. With `expectedUpdatedAt`, the update only applies when
  the row has not changed since it was read, and the function returns false
  when another request refreshed first (review ACC-17).
*/
export async function saveXeroCredentials(args: {
  tenantId: string;
  integrationId: string;
  token: XeroTokenResponse;
  expectedUpdatedAt?: string | null;
}): Promise<boolean> {
  const admin = createAdminClient();

  const expiresAt = new Date(
    Date.now() + args.token.expires_in * 1000
  ).toISOString();

  const payload = {
    tenant_id: args.tenantId,
    integration_id: args.integrationId,
    provider: "xero",
    access_token_encrypted: encryptSecret(
      args.token.access_token
    ),
    refresh_token_encrypted:
      args.token.refresh_token
        ? encryptSecret(
            args.token.refresh_token
          )
        : null,
    token_type: args.token.token_type || "Bearer",
    scope: args.token.scope || XERO_SCOPES,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: readError } =
    await admin
      .from("accounting_oauth_credentials")
      .select("id")
      .eq("integration_id", args.integrationId)
      .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  if (existing) {
    let update = admin
      .from("accounting_oauth_credentials")
      .update(payload)
      .eq("id", existing.id);

    if (args.expectedUpdatedAt) {
      update = update.eq("updated_at", args.expectedUpdatedAt);
    }

    const { data: updated, error } = await update.select("id");

    if (error) {
      throw new Error(error.message);
    }

    return (updated ?? []).length > 0;
  }

  const { error } = await admin
    .from("accounting_oauth_credentials")
    .insert(payload);

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

async function readCredential(
  integrationId: string
): Promise<StoredCredential> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("accounting_oauth_credentials")
    .select("*")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(
      "No stored Xero credentials were found."
    );
  }

  return data as StoredCredential;
}

export async function getValidXeroAccessToken(
  integrationId: string
): Promise<string> {
  const credential =
    await readCredential(integrationId);

  const expiresAt = credential.expires_at
    ? new Date(credential.expires_at).getTime()
    : 0;

  const refreshEarlyMs = 2 * 60 * 1000;

  if (
    expiresAt >
    Date.now() + refreshEarlyMs
  ) {
    return decryptSecret(
      credential.access_token_encrypted
    );
  }

  if (!credential.refresh_token_encrypted) {
    throw new Error(
      "Xero refresh token is missing. Reconnect Xero."
    );
  }

  const refreshToken = decryptSecret(
    credential.refresh_token_encrypted
  );

  const refreshed =
    await refreshXeroToken(refreshToken);

  // Review ACC-17: only store the new pair if nobody refreshed since we read
  // the row. A request that loses the race uses the stored pair instead of
  // overwriting a newer one with an older one.
  const readUpdatedAt =
    (credential as StoredCredential & { updated_at?: string | null }).updated_at ?? null;

  const saved = await saveXeroCredentials({
    tenantId: credential.tenant_id,
    integrationId:
      credential.integration_id,
    token: refreshed,
    expectedUpdatedAt: readUpdatedAt,
  });

  if (!saved) {
    const latest = await readCredential(integrationId);
    const latestExpiry = latest.expires_at ? new Date(latest.expires_at).getTime() : 0;

    if (latestExpiry > Date.now() + refreshEarlyMs) {
      return decryptSecret(latest.access_token_encrypted);
    }
  }

  return refreshed.access_token;
}

/**
  Best-effort revocation at Xero, then removal of the stored credential
  (review ACC-16). A missing credential, a token Xero already revoked, or Xero
  being unreachable never throws, so disconnect cannot get stuck.
*/
export async function revokeXeroConnection(
  integrationId: string
): Promise<{ revokedAtXero: boolean }> {
  const admin = createAdminClient();

  const { data: credential, error: readError } = await admin
    .from("accounting_oauth_credentials")
    .select("refresh_token_encrypted")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  let revokedAtXero = false;

  if (credential?.refresh_token_encrypted) {
    try {
      const refreshToken = decryptSecret(
        credential.refresh_token_encrypted
      );

      const response = await fetch(
        REVOCATION_URL,
        {
          method: "POST",
          headers: {
            Authorization: basicAuthorization(),
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            token: refreshToken,
          }),
          cache: "no-store",
        }
      );

      revokedAtXero = response.ok;

      if (!response.ok) {
        console.warn(`[xero] token revocation answered ${response.status}; removing the local credential anyway.`);
      }
    } catch (error) {
      console.warn("[xero] token revocation failed; removing the local credential anyway.", error);
    }
  }

  const { error } = await admin
    .from("accounting_oauth_credentials")
    .delete()
    .eq("integration_id", integrationId);

  if (error) {
    throw new Error(error.message);
  }

  return { revokedAtXero };
}
