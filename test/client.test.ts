import { describe, expect, it } from 'vitest';
import { Beacon, BeaconError, pingHeartbeat } from '../src/index.js';

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };

/** A fetch stub that records calls and replays queued responses. */
function mockFetch(...responses: Response[]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({
      url: new URL(String(input)),
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const res = responses.shift();
    if (!res) throw new Error('unexpected request');
    return res;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const page = (data: unknown[], next: string | null) => ({
  data,
  meta: { path: '', per_page: 2, next_cursor: next, prev_cursor: null },
  links: { first: null, last: null, prev: null, next: null },
});

describe('Beacon REST client', () => {
  it('sends the bearer token to /api/v1 and unwraps the data envelope', async () => {
    const { fetch, calls } = mockFetch(json({ data: { id: 1, slug: 'acme', name: 'Acme' } }));
    const beacon = new Beacon({ token: 'bchk_test', baseUrl: 'https://beacon.test/', fetch });

    const sp = await beacon.statusPages.get('acme');

    expect(sp.name).toBe('Acme');
    expect(calls[0].url.href).toBe('https://beacon.test/api/v1/status-pages/acme');
    expect(calls[0].headers.Authorization).toBe('Bearer bchk_test');
    expect(calls[0].headers['Content-Type']).toBeUndefined();
  });

  it('defaults to the hosted Beacon URL', async () => {
    const { fetch, calls } = mockFetch(json(page([], null)));
    await new Beacon({ token: 't', fetch }).statusPages.list();
    expect(calls[0].url.origin).toBe('https://usebeacon.pro');
  });

  it('creates, updates and deletes nested resources with JSON bodies', async () => {
    const { fetch, calls } = mockFetch(
      json({ data: { id: 7, name: 'API', type: 'http' } }, 201),
      json({ data: { id: 7, name: 'API v2' } }),
      new Response(null, { status: 204 }),
    );
    const beacon = new Beacon({ token: 't', baseUrl: 'https://b.test', fetch });

    const created = await beacon.monitors.create('acme', { name: 'API', url: 'https://api.acme.test', allow_cold_start: true, check_window_start: '08:00', check_window_end: '18:00' });
    const updated = await beacon.monitors.update('acme', 7, { name: 'API v2' });
    const deleted = await beacon.monitors.delete('acme', 7);

    expect(created.id).toBe(7);
    expect(updated.name).toBe('API v2');
    expect(deleted).toBeUndefined();
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /api/v1/status-pages/acme/monitors',
      'PATCH /api/v1/status-pages/acme/monitors/7',
      'DELETE /api/v1/status-pages/acme/monitors/7',
    ]);
    expect(calls[0].body).toMatchObject({ allow_cold_start: true, check_window_start: '08:00' });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('passes filters and pagination params as query strings', async () => {
    const { fetch, calls } = mockFetch(json(page([], null)), json(page([], null)));
    const beacon = new Beacon({ token: 't', baseUrl: 'https://b.test', fetch });

    await beacon.incidents.list('acme', { state: 'open', per_page: 50 });
    await beacon.subscribers.list('acme', { confirmed: true });

    expect(calls[0].url.search).toBe('?state=open&per_page=50');
    expect(calls[1].url.search).toBe('?confirmed=1');
  });

  it('iterates every page following meta.next_cursor', async () => {
    const { fetch, calls } = mockFetch(json(page([{ id: 1 }, { id: 2 }], 'abc')), json(page([{ id: 3 }], null)));
    const beacon = new Beacon({ token: 't', baseUrl: 'https://b.test', fetch });

    const ids: number[] = [];
    for await (const c of beacon.components.iterate('acme', { per_page: 2 })) ids.push(c.id);

    expect(ids).toEqual([1, 2, 3]);
    expect(calls[0].url.searchParams.get('cursor')).toBeNull();
    expect(calls[1].url.searchParams.get('cursor')).toBe('abc');
    expect(calls[1].url.searchParams.get('per_page')).toBe('2');
  });

  it('returns the one-time webhook secret alongside the created webhook', async () => {
    const { fetch } = mockFetch(json({ data: { id: 3, url: 'https://hook.test', enabled: true }, secret: 'whsec_abc' }, 201));
    const hook = await new Beacon({ token: 't', fetch }).webhooks.create('acme', { url: 'https://hook.test' });
    expect(hook).toMatchObject({ id: 3, secret: 'whsec_abc' });
  });

  it('reorders components and adds incident updates', async () => {
    const { fetch, calls } = mockFetch(json({ data: [{ id: 2 }, { id: 1 }] }), json({ data: { id: 9, message: 'Fixed' } }, 201));
    const beacon = new Beacon({ token: 't', fetch });

    expect(await beacon.components.reorder('acme', [2, 1])).toHaveLength(2);
    expect((await beacon.incidents.addUpdate('acme', 4, 'Fixed')).id).toBe(9);
    expect(calls[0].body).toEqual({ ids: [2, 1] });
    expect(calls[1].url.pathname).toBe('/api/v1/status-pages/acme/incidents/4/updates');
  });
});

describe('errors', () => {
  it('throws a typed BeaconError with code and field errors', async () => {
    const { fetch } = mockFetch(json({ message: 'Validation failed.', code: 'validation_failed', errors: { name: ['required'] } }, 422));
    const err = await new Beacon({ token: 't', fetch }).components.create('acme', { name: '' }).catch((e) => e);

    expect(err).toBeInstanceOf(BeaconError);
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', errors: { name: ['required'] }, retryAfter: null });
  });

  it('exposes Retry-After on 429 once retries are exhausted', async () => {
    const { fetch } = mockFetch(json({ message: 'Too many requests.', code: 'rate_limited' }, 429, { 'Retry-After': '42' }));
    const err = await new Beacon({ token: 't', fetch, maxRetries: 0 }).statusPages.list().catch((e) => e);

    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 42 });
  });

  it('retries a 429 after Retry-After, even for writes', async () => {
    const { fetch, calls } = mockFetch(json({ code: 'rate_limited', message: 'x' }, 429, { 'Retry-After': '0' }), json({ id: '5' }, 201));
    const res = await new Beacon({ token: 't', fetch, pageSlug: 'acme' }).createIncident({ title: 'Down' });

    expect(res.id).toBe('5');
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 5xx on writes', async () => {
    const { fetch, calls } = mockFetch(new Response('oops', { status: 502 }));
    const err = await new Beacon({ token: 't', fetch }).statusPages.create({ name: 'x' }).catch((e) => e);

    expect(err).toMatchObject({ status: 502, code: 'http_error' });
    expect(calls).toHaveLength(1);
  });
});

describe('ingest helpers', () => {
  it('opens, updates and resolves incidents on the default page', async () => {
    const { fetch, calls } = mockFetch(json({ id: '10', state: 'investigating' }, 201), json({ id: '10' }), json({ id: '10', state: 'resolved' }));
    const beacon = new Beacon({ token: 't', baseUrl: 'https://b.test', pageSlug: 'acme', fetch });

    await beacon.createIncident({ title: 'Payments down', impact: 'major', component_ids: [1] });
    await beacon.addIncidentUpdate('10', 'Deploying fix');
    const resolved = await beacon.resolveIncident(10, 'All good');

    expect(resolved.state).toBe('resolved');
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /api/v1/pages/acme/incidents',
      'POST /api/v1/incidents/10/updates',
      'PATCH /api/v1/incidents/10',
    ]);
    expect(calls[2].body).toEqual({ resolved: true, message: 'All good' });
  });

  it('sets a component status, with a per-call page slug', async () => {
    const { fetch, calls } = mockFetch(json({ id: '3', status: 'major_outage' }));
    await new Beacon({ token: 't', fetch }).updateComponent(3, { status: 'major_outage' }, 'other');
    expect(calls[0].url.pathname).toBe('/api/v1/pages/other/components/3');
  });

  it('requires a page slug for ingest', () => {
    expect(() => new Beacon({ token: 't' }).createIncident({ title: 'x' })).toThrow(/page slug/);
  });
});

describe('heartbeats', () => {
  it('pings by token without sending the API token', async () => {
    const { fetch, calls } = mockFetch(json({ ok: true }));
    await new Beacon({ token: 'secret', baseUrl: 'https://b.test', fetch }).heartbeat('hb_123');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.href).toBe('https://b.test/api/v1/heartbeat/hb_123');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('accepts a full heartbeat URL and other methods', async () => {
    const { fetch, calls } = mockFetch(new Response(null, { status: 200 }));
    await pingHeartbeat('https://b.test/api/v1/heartbeat/abc', { method: 'HEAD', fetch });
    expect(calls[0]).toMatchObject({ method: 'HEAD' });
    expect(calls[0].url.pathname).toBe('/api/v1/heartbeat/abc');
  });

  it('throws on an unknown token', async () => {
    const { fetch } = mockFetch(new Response('', { status: 404 }));
    await expect(pingHeartbeat('nope', { fetch })).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
