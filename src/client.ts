import type {
  Component,
  ComponentInput,
  CreatedWebhook,
  ErrorBody,
  ErrorCode,
  Id,
  Import,
  ImportInput,
  Incident,
  IncidentInput,
  IncidentState,
  IncidentUpdate,
  IngestComponent,
  IngestCreateIncident,
  IngestIncident,
  IngestUpdateComponent,
  IngestUpdateIncident,
  ListParams,
  Maintenance,
  MaintenanceInput,
  MaintenanceState,
  Monitor,
  MonitorInput,
  Page,
  StatusPage,
  StatusPageInput,
  Subscriber,
  SubscriberInput,
  Webhook,
  WebhookInput,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://usebeacon.pro';
export const VERSION = '1.0.0';

export interface BeaconOptions {
  /** Workspace API token (bchk_…). */
  token: string;
  /** Beacon host, without /api/v1. Defaults to https://usebeacon.pro. */
  baseUrl?: string;
  /** Default page slug for the ingest helpers (createIncident, updateComponent). */
  pageSlug?: string;
  /** Per-request timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Retries for 429 (all methods) and 5xx / network errors (GET only). Default 2. */
  maxRetries?: number;
  /** Custom fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export class BeaconError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly errors: Record<string, string[]> | undefined;
  /** Seconds from the Retry-After header (429 responses), otherwise null. */
  readonly retryAfter: number | null;
  readonly body: ErrorBody | undefined;

  constructor(message: string, status: number, code: ErrorCode, body?: ErrorBody, retryAfter: number | null = null) {
    super(message);
    this.name = 'BeaconError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.errors = body?.errors;
    this.retryAfter = retryAfter;
  }
}

type Query = Record<string, string | number | boolean | undefined>;
type Method = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'DELETE';

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Beacon {
  readonly baseUrl: string;
  readonly pageSlug: string | undefined;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BeaconOptions) {
    if (!options?.token) throw new TypeError('Beacon: `token` is required');
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.pageSlug = options.pageSlug;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  // ---------------------------------------------------------------- REST resources

  readonly statusPages = {
    list: (params?: ListParams) => this.request<Page<StatusPage>>('GET', '/status-pages', undefined, params),
    iterate: (params?: ListParams) => this.paginate<StatusPage>('/status-pages', params),
    get: (slug: string) => this.data<StatusPage>('GET', `/status-pages/${enc(slug)}`),
    create: (input: StatusPageInput & { name: string }) => this.data<StatusPage>('POST', '/status-pages', input),
    update: (slug: string, input: StatusPageInput) => this.data<StatusPage>('PATCH', `/status-pages/${enc(slug)}`, input),
    delete: (slug: string) => this.request<void>('DELETE', `/status-pages/${enc(slug)}`),
  };

  readonly components = {
    ...this.nested<Component, ComponentInput & { name: string }, ComponentInput>('components'),
    /** `ids` must list every component on the page, in display order. */
    reorder: (slug: string, ids: Id[]) =>
      this.data<Component[]>('POST', `/status-pages/${enc(slug)}/components/reorder`, { ids }),
  };

  readonly monitors = this.nested<Monitor, MonitorInput & { name: string }, Omit<MonitorInput, 'type'>>('monitors');

  readonly incidents = {
    ...this.nested<Incident, IncidentInput & { title: string }, IncidentInput, { state?: 'open' | IncidentState | (string & {}) }>('incidents'),
    listUpdates: (slug: string, incidentId: Id, params?: ListParams) =>
      this.request<Page<IncidentUpdate>>('GET', `/status-pages/${enc(slug)}/incidents/${incidentId}/updates`, undefined, params),
    addUpdate: (slug: string, incidentId: Id, message: string) =>
      this.data<IncidentUpdate>('POST', `/status-pages/${enc(slug)}/incidents/${incidentId}/updates`, { message }),
  };

  readonly maintenances = this.nested<
    Maintenance,
    MaintenanceInput & { title: string; starts_at: string; ends_at: string },
    MaintenanceInput,
    { state?: MaintenanceState | (string & {}) }
  >('maintenances');

  readonly subscribers = (() => {
    const { update: _ignored, ...rest } = this.nested<Subscriber, SubscriberInput, never, { confirmed?: boolean }>('subscribers');
    return {
      ...rest,
      /** Replace the component filter. An empty list = every component. */
      update: (slug: string, id: Id, input: { component_ids: Id[] }) =>
        this.data<Subscriber>('PATCH', `/status-pages/${enc(slug)}/subscribers/${id}`, input),
    };
  })();

  readonly webhooks = (() => {
    const base = this.nested<Webhook, WebhookInput & { url: string }, WebhookInput>('webhooks');
    return {
      ...base,
      /** The returned `secret` is only ever shown here; store it to verify deliveries. */
      create: async (slug: string, input: WebhookInput & { url: string }): Promise<CreatedWebhook> => {
        const res = await this.request<{ data: Webhook; secret: string }>('POST', `/status-pages/${enc(slug)}/webhooks`, input);
        return { ...res.data, secret: res.secret };
      },
    };
  })();

  readonly imports = (() => {
    const { list, iterate, get, create } = this.nested<Import, ImportInput, never>('imports');
    return { list, iterate, get, create };
  })();

  // ---------------------------------------------------------------- Ingest (flat JSON)

  /** Open an incident on `pageSlug` (or the client's default page). */
  createIncident(input: IngestCreateIncident, pageSlug = this.requirePageSlug()): Promise<IngestIncident> {
    return this.request('POST', `/pages/${enc(pageSlug)}/incidents`, input);
  }

  updateIncident(incidentId: Id | string, input: IngestUpdateIncident): Promise<IngestIncident> {
    return this.request('PATCH', `/incidents/${enc(String(incidentId))}`, input);
  }

  addIncidentUpdate(incidentId: Id | string, message: string): Promise<IngestIncident> {
    return this.request('POST', `/incidents/${enc(String(incidentId))}/updates`, { message });
  }

  /** Resolves the incident (restoring linked components) with an optional closing message. */
  resolveIncident(incidentId: Id | string, message?: string): Promise<IngestIncident> {
    return this.updateIncident(incidentId, message ? { resolved: true, message } : { resolved: true });
  }

  updateComponent(componentId: Id | string, input: IngestUpdateComponent, pageSlug = this.requirePageSlug()): Promise<IngestComponent> {
    return this.request('PATCH', `/pages/${enc(pageSlug)}/components/${enc(String(componentId))}`, input);
  }

  /** Heartbeat check-in. Accepts the token or the monitor's full heartbeat_url. */
  heartbeat(tokenOrUrl: string, method: 'GET' | 'HEAD' | 'POST' = 'POST'): Promise<void> {
    return pingHeartbeat(tokenOrUrl, { baseUrl: this.baseUrl, method, timeoutMs: this.timeoutMs, fetch: this.fetchImpl });
  }

  // ---------------------------------------------------------------- Plumbing

  /** Raw request against /api/v1. Returns the parsed JSON body (undefined for 204). */
  async request<T>(method: Method, path: string, body?: unknown, query?: Query): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'User-Agent': `beacon-node/${VERSION}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (method === 'GET' && attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw err;
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const retryable = res.status === 429 || (res.status >= 500 && method === 'GET');
      if (retryable && attempt < this.maxRetries) {
        await sleep(retryAfter !== null ? Math.min(retryAfter, 60) * 1000 : backoff(attempt));
        continue;
      }
      throw await toError(res, retryAfter);
    }
  }

  /** Iterate every item of a cursor-paginated list, fetching pages lazily. */
  async *paginate<T>(path: string, params: ListParams & Query = {}): AsyncGenerator<T, void, undefined> {
    let cursor = params.cursor;
    do {
      const page: Page<T> = await this.request('GET', path, undefined, { ...params, cursor });
      yield* page.data;
      cursor = page.meta?.next_cursor ?? undefined;
    } while (cursor);
  }

  private async data<T>(method: Method, path: string, body?: unknown): Promise<T> {
    return (await this.request<{ data: T }>(method, path, body)).data;
  }

  private nested<T, C, U, F extends Query = Query>(name: string) {
    const base = (slug: string) => `/status-pages/${enc(slug)}/${name}`;
    return {
      list: (slug: string, params?: ListParams & F) => this.request<Page<T>>('GET', base(slug), undefined, params),
      iterate: (slug: string, params?: ListParams & F) => this.paginate<T>(base(slug), params),
      get: (slug: string, id: Id) => this.data<T>('GET', `${base(slug)}/${id}`),
      create: (slug: string, input: C) => this.data<T>('POST', base(slug), input),
      update: (slug: string, id: Id, input: U) => this.data<T>('PATCH', `${base(slug)}/${id}`, input),
      delete: (slug: string, id: Id) => this.request<void>('DELETE', `${base(slug)}/${id}`),
    };
  }

  private requirePageSlug(): string {
    if (!this.pageSlug) throw new TypeError('Beacon: pass a page slug or set `pageSlug` on the client');
    return this.pageSlug;
  }
}

export interface PingOptions {
  baseUrl?: string;
  method?: 'GET' | 'HEAD' | 'POST';
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Heartbeat check-in without an API token (the heartbeat URL is the secret). Throws BeaconError on non-2xx. */
export async function pingHeartbeat(tokenOrUrl: string, options: PingOptions = {}): Promise<void> {
  const url = /^https?:\/\//.test(tokenOrUrl)
    ? tokenOrUrl
    : `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/api/v1/heartbeat/${enc(tokenOrUrl)}`;
  const res = await (options.fetch ?? globalThis.fetch)(url, {
    method: options.method ?? 'POST',
    headers: { Accept: 'application/json', 'User-Agent': `beacon-node/${VERSION}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw await toError(res, parseRetryAfter(res.headers.get('retry-after')));
}

function backoff(attempt: number): number {
  return 500 * 2 ** attempt;
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function toError(res: Response, retryAfter: number | null): Promise<BeaconError> {
  let body: ErrorBody | undefined;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    // Non-JSON error (proxy page, HEAD request, …).
  }
  const fallback: ErrorCode = res.status === 429 ? 'rate_limited' : res.status === 404 ? 'not_found' : 'http_error';
  return new BeaconError(body?.message ?? `Beacon API returned HTTP ${res.status}`, res.status, body?.code ?? fallback, body, retryAfter);
}
