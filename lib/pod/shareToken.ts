import {
  createHmac,
  timingSafeEqual,
} from "crypto";

type PodSharePayload = {
  jobId: string;
  tenantId: string;
  expiresAt: number;
};

const DEFAULT_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  const secret = process.env.POD_SHARE_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "POD_SHARE_SECRET must be configured with at least 32 characters."
    );
  }

  return secret;
}

function encodePayload(payload: PodSharePayload): string {
  return Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", getSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createPodShareToken(
  jobId: string,
  tenantId: string,
  lifetimeSeconds = DEFAULT_LIFETIME_SECONDS
): string {
  const payload: PodSharePayload = {
    jobId,
    tenantId,
    expiresAt:
      Math.floor(Date.now() / 1000) +
      lifetimeSeconds,
  };

  const encoded = encodePayload(payload);

  return `${encoded}.${sign(encoded)}`;
}

export function verifyPodShareToken(
  token: string
): PodSharePayload | null {
  const [encoded, suppliedSignature, extra] =
    token.split(".");

  if (
    !encoded ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    return null;
  }

  const expectedSignature = sign(encoded);

  const suppliedBuffer = Buffer.from(
    suppliedSignature
  );

  const expectedBuffer = Buffer.from(
    expectedSignature
  );

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(
      suppliedBuffer,
      expectedBuffer
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<PodSharePayload>;

    if (
      typeof payload.jobId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }

    if (
      payload.expiresAt <
      Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      jobId: payload.jobId,
      tenantId: payload.tenantId,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}
