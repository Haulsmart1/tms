/*
  Server-only: QR token generation and hashing. Never import from client code
  (node:crypto). 16 Crockford base32 characters = 80 random bits.
*/

import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateQrToken(): string {
  return Array.from(randomBytes(16), (b) => ALPHABET[b & 31]).join("");
}

export function hashQrToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
