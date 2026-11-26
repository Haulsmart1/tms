import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "../api/server";
import { bankDetailsSchema, type BankDetails } from "./subcontractorBank";

function bankKey() {
  const value = process.env.SUBCONTRACTOR_BANK_DETAILS_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new ApiError(503, "Bank details are temporarily unavailable.");
  return Buffer.from(value, "hex");
}

export function bankDetailsScope(tenantId: string, subcontractorId: string) {
  return `${tenantId}:${subcontractorId}`;
}

export function encryptBankDetails(details: BankDetails, scope: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bankKey(), iv);
  cipher.setAAD(Buffer.from(scope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptBankDetails(encrypted: string, scope: string) {
  const bytes = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", bankKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  return bankDetailsSchema.parse(JSON.parse(plaintext.toString("utf8")));
}

export function bankDatabaseError(code?: string) {
  console.error("[subcontractor bank details] database error", code);
  return new ApiError(500, "Unable to process bank details.");
}
