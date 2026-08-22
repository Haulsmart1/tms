import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "crypto";

export type QuotationSharePayload = {
  shareLinkId: string;
  quotationId: string;
  tenantId: string;
  expiresAt: number;
};

function getQuotationShareSecret(): string {
  const secret =
    process.env.QUOTATION_SHARE_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "QUOTATION_SHARE_SECRET must be configured with at least 32 characters."
    );
  }

  return secret;
}

function encodePayload(
  payload: QuotationSharePayload
): string {
  return Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url");
}

function signPayload(
  encodedPayload: string
): string {
  return createHmac(
    "sha256",
    getQuotationShareSecret()
  )
    .update(encodedPayload)
    .digest("base64url");
}

export function createQuotationShareToken(
  payload: QuotationSharePayload
): string {
  const encoded =
    encodePayload(payload);

  return `${encoded}.${signPayload(encoded)}`;
}

export function hashQuotationShareToken(
  token: string
): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

export function verifyQuotationShareToken(
  token: string
): QuotationSharePayload | null {
  const [
    encodedPayload,
    suppliedSignature,
    extra,
  ] = token.split(".");

  if (
    !encodedPayload ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    return null;
  }

  const expectedSignature =
    signPayload(encodedPayload);

  const suppliedBuffer =
    Buffer.from(suppliedSignature);

  const expectedBuffer =
    Buffer.from(expectedSignature);

  if (
    suppliedBuffer.length !==
      expectedBuffer.length ||
    !timingSafeEqual(
      suppliedBuffer,
      expectedBuffer
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(
        encodedPayload,
        "base64url"
      ).toString("utf8")
    ) as Partial<QuotationSharePayload>;

    if (
      typeof payload.shareLinkId !== "string" ||
      typeof payload.quotationId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }

    if (
      payload.expiresAt <=
      Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      shareLinkId:
        payload.shareLinkId,

      quotationId:
        payload.quotationId,

      tenantId:
        payload.tenantId,

      expiresAt:
        payload.expiresAt,
    };
  }
  catch {
    return null;
  }
}