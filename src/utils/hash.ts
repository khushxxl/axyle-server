/**
 * Hash utilities for sensitive data (e.g. API keys).
 * We store only the hash; the plain key is shown once at creation and never again.
 */

import { createHash } from "crypto";

const HASH_ALGORITHM = "sha256";
const HASH_ENCODING = "hex" as const;

/**
 * Hash an API key for storage. One-way; the plain key cannot be recovered.
 */
export function hashApiKey(plainKey: string): string {
  return createHash(HASH_ALGORITHM).update(plainKey, "utf8").digest(HASH_ENCODING);
}
