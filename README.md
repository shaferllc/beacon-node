# @beacon-status/node

Typed Node.js / TypeScript client for [Beacon](https://usebeacon.pro) status pages: the full REST API v1, the incident ingest endpoints, heartbeat pings and webhook signature verification.

- Zero runtime dependencies — uses the global `fetch` (Node 18+).
- ESM and CommonJS builds with bundled type definitions.
- Cursor pagination iterators, typed errors with `code`, `status` and `retryAfter`.

> **Not yet published to npm.** Until it is, build a tarball from this repository:
>
> ```bash
> git clone https://github.com/shaferllc/beacon.git
> cd beacon/sdks/node && npm ci && npm pack      # → beacon-status-node-1.0.0.tgz
> cd /your/app && npm install /path/to/beacon-status-node-1.0.0.tgz
> ```
>
> (`npm install` can't install from a git subdirectory.)

## Setup

```ts
import { Beacon } from '@beacon-status/node';

const beacon = new Beacon({
  token: process.env.BEACON_API_TOKEN!, // bchk_… (Settings → API tokens)
  baseUrl: process.env.BEACON_URL,      // optional, defaults to https://usebeacon.pro
  pageSlug: 'acme',                     // optional default page for the ingest helpers
});
```

Options: `timeoutMs` (default 10 000), `maxRetries` (default 2 — 429s are retried after `Retry-After` for every method, 5xx and network errors only for GETs) and `fetch` (custom implementation).

## Incidents and components (ingest)

```ts
const incident = await beacon.createIncident({
  title: 'Payment processing delays',
  impact: 'major',
  state: 'investigating',
  message: 'Stripe webhook delivery is delayed.',
  component_ids: [12],
});

await beacon.addIncidentUpdate(incident.id, 'Fix deployed, monitoring.');
await beacon.resolveIncident(incident.id, 'Webhook delivery restored.');

await beacon.updateComponent(12, { status: 'degraded_performance' });
await beacon.updateComponent(12, { status: 'operational' }, 'another-page');
```

Ingest responses use the flat ingest shape (ids are strings), exactly like the HTTP API.

## REST resources

Every resource takes the status page slug first. Lists return `{ data, meta, links }`; `iterate()` walks every page.

```ts
const page = await beacon.statusPages.create({ name: 'Acme Cloud', theme: 'dark' });
const api = await beacon.components.create(page.slug, { name: 'API' });

await beacon.monitors.create(page.slug, {
  name: 'API health',
  type: 'http',
  url: 'https://api.acme.com/health',
  interval_minutes: 5,
  allow_cold_start: true,
  check_window_start: '08:00',
  check_window_end: '20:00',
  status_component_id: api.id,
});

for await (const incident of beacon.incidents.iterate(page.slug, { state: 'open' })) {
  console.log(incident.title);
}

const hook = await beacon.webhooks.create(page.slug, { url: 'https://example.com/beacon' });
console.log(hook.secret); // returned once — store it
```

| Namespace | Methods |
| --- | --- |
| `statusPages` | `list`, `iterate`, `get`, `create`, `update`, `delete` |
| `components` | `list`, `iterate`, `get`, `create`, `update`, `delete`, `reorder` |
| `monitors` | `list`, `iterate`, `get`, `create`, `update`, `delete` |
| `incidents` | `list`, `iterate`, `get`, `create`, `update`, `delete`, `listUpdates`, `addUpdate` |
| `maintenances` | `list`, `iterate`, `get`, `create`, `update`, `delete` |
| `subscribers` | `list`, `iterate`, `get`, `create`, `update` (component filter), `delete` |
| `webhooks` | `list`, `iterate`, `get`, `create`, `update`, `delete` |
| `imports` | `list`, `iterate`, `get`, `create` |

`beacon.request(method, path, body?, query?)` reaches anything else under `/api/v1`.

## Heartbeats

```ts
import { pingHeartbeat } from '@beacon-status/node';

await runNightlyBackup();
await pingHeartbeat('YOUR-HEARTBEAT-TOKEN');           // no API token needed
await pingHeartbeat(monitor.heartbeat_url!, { method: 'GET' });
await beacon.heartbeat('YOUR-HEARTBEAT-TOKEN');        // same, using the client's baseUrl
```

## Errors

```ts
import { BeaconError } from '@beacon-status/node';

try {
  await beacon.components.create('acme', { name: '' });
} catch (err) {
  if (err instanceof BeaconError) {
    err.status;     // 422
    err.code;       // 'validation_failed' | 'unauthenticated' | 'insufficient_scope' | 'not_found' | 'plan_limit_reached' | 'workspace_read_only' | 'rate_limited' | …
    err.errors;     // { name: ['The name field is required.'] }
    err.retryAfter; // seconds, on 429
  }
}
```

## Verifying webhooks

```ts
import express from 'express';
import { verifyWebhookSignature } from '@beacon-status/node';

app.post('/beacon', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifyWebhookSignature(req.body, req.headers, process.env.BEACON_WEBHOOK_SECRET!)) {
    return res.sendStatus(403);
  }
  const event = JSON.parse(req.body.toString());
  res.sendStatus(204);
});
```

Pass the raw body (string, `Buffer` or `Uint8Array`) and the headers (Node headers object or a Fetch `Headers`). The check is constant-time and rejects timestamps more than 300 seconds off (`{ toleranceSeconds }` to change).

## Development

```bash
npm ci
npm test         # vitest, mocked fetch
npm run build    # dist/ (ESM + CJS + .d.ts)
```
