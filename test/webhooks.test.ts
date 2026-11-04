import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature } from '../src/index.js';

const secret = 'whsec_test_secret';
const body = '{"event":"incident.opened","incident":{"id":"1"}}';
const now = 1_760_000_000;
// Computed independently of the SDK, exactly as the docs describe it.
const sig = 'sha256=' + createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
const headers = { 'x-beacon-timestamp': String(now), 'x-beacon-signature': sig };

describe('verifyWebhookSignature', () => {
  it('accepts a valid delivery (string, Buffer, Headers, mixed-case keys)', () => {
    expect(signWebhookPayload(body, secret, now)).toBe(sig);
    expect(verifyWebhookSignature(body, headers, secret, { now })).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(body), headers, secret, { now })).toBe(true);
    expect(verifyWebhookSignature(body, new Headers(headers), secret, { now })).toBe(true);
    expect(verifyWebhookSignature(body, { 'X-Beacon-Timestamp': String(now), 'X-Beacon-Signature': sig }, secret, { now })).toBe(true);
  });

  it('rejects a tampered body or wrong secret', () => {
    expect(verifyWebhookSignature(body.replace('1', '2'), headers, secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, headers, 'other', { now })).toBe(false);
    expect(verifyWebhookSignature(body, { ...headers, 'x-beacon-signature': sig.slice(0, -2) }, secret, { now })).toBe(false);
  });

  it('rejects stale or future timestamps outside the tolerance', () => {
    expect(verifyWebhookSignature(body, headers, secret, { now: now + 301 })).toBe(false);
    expect(verifyWebhookSignature(body, headers, secret, { now: now - 301 })).toBe(false);
    expect(verifyWebhookSignature(body, headers, secret, { now: now + 300 })).toBe(true);
    expect(verifyWebhookSignature(body, headers, secret, { now: now + 900, toleranceSeconds: 1000 })).toBe(true);
  });

  it('rejects missing or non-numeric timestamps and missing secrets', () => {
    expect(verifyWebhookSignature(body, { 'x-beacon-signature': sig }, secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, { ...headers, 'x-beacon-timestamp': `${now}.5` }, secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, headers, '', { now })).toBe(false);
  });
});
