import { verify as cryptoVerify } from 'node:crypto';

/**
 * HighLevel signs marketplace webhooks with Ed25519 over the RAW request body; the
 * signature arrives base64 in `X-GHL-Signature` (the legacy RSA `X-WH-Signature` is
 * deprecated 2026-07-01). Verify against the raw bytes BEFORE parsing JSON.
 *
 * Public key from HighLevel's Webhook Integration Guide. Override via
 * WEBHOOK_SIGNATURE_PUBLIC_KEY if HighLevel rotates it. NOTE: confirm this key against
 * a real VoiceAiCallEnd delivery before enforcing (WEBHOOK_REQUIRE_SIGNATURE=true).
 */
const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

function defaultKey(): string {
  return process.env.WEBHOOK_SIGNATURE_PUBLIC_KEY?.replace(/\\n/g, '\n') ?? GHL_ED25519_PUBLIC_KEY;
}

/**
 * True iff `signature` is a valid Ed25519 signature of `rawBody` under `publicKeyPem`.
 * Total: returns false on missing/garbage input rather than throwing.
 */
export function verifyGhlSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  publicKeyPem: string = defaultKey(),
): boolean {
  if (!signature || signature === 'N/A') return false;
  try {
    const payload = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const sig = Buffer.from(signature, 'base64');
    return cryptoVerify(null, payload, publicKeyPem, sig);
  } catch {
    return false;
  }
}
