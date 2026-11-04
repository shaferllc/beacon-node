import { createHmac, timingSafeEqual } from 'node:crypto';

export type HeaderBag =
  | Headers
  | Record<string, string | string[] | undefined>;

export interface VerifyOptions {
  /** Max clock skew in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current Unix time in seconds (tests). */
  now?: number;
}

/** sha256=hex(hmac_sha256(secret, `${timestamp}.${rawBody}`)) — the X-Beacon-Signature value. */
export function signWebhookPayload(rawBody: string | Uint8Array, secret: string, timestamp: number | string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/**
 * Verify a Beacon webhook delivery. Pass the raw request body (before JSON parsing),
 * the request headers (Node IncomingHttpHeaders, a Fetch Headers object or a plain object)
 * and the webhook's signing secret. Returns false on any mismatch or a stale timestamp.
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  headers: HeaderBag,
  secret: string,
  options: VerifyOptions = {},
): boolean {
  const timestamp = header(headers, 'x-beacon-timestamp');
  const signature = header(headers, 'x-beacon-signature');
  if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (options.toleranceSeconds ?? 300)) return false;

  const expected = Buffer.from(signWebhookPayload(rawBody, secret, timestamp));
  const received = Buffer.from(signature);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}
