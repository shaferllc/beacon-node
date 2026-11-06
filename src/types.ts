// Hand-written from resources/api/openapi.json (REST API v1). Keep in sync when the spec changes.

export type Id = number;
export type Timestamp = string | null;

export type ComponentStatus =
  | 'operational'
  | 'degraded'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown';
export type Impact = 'none' | 'minor' | 'major' | 'critical';
export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type MaintenanceState = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type MonitorType = 'http' | 'heartbeat' | 'tcp' | 'ping' | 'dns' | 'browser';

/** One step of a browser (scripted) monitor; `fill` values may use {{secret:NAME}}. Timeouts in ms. */
export type BrowserStep =
  | { action: 'goto'; url: string }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'press'; key: string }
  | { action: 'wait_for_selector'; selector: string; timeout?: number }
  | { action: 'wait_for_url'; pattern: string; timeout?: number }
  | { action: 'assert_text'; text: string; selector?: string; timeout?: number }
  | { action: 'assert_status'; status: number };
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';
export type Theme = 'dark' | 'light' | 'minimal';

export type ErrorCode =
  | 'unauthenticated'
  | 'insufficient_scope'
  | 'not_found'
  | 'validation_failed'
  | 'plan_limit_reached'
  | 'workspace_read_only'
  | 'rate_limited'
  | (string & {});

export interface ErrorBody {
  message: string;
  code: ErrorCode;
  errors?: Record<string, string[]>;
  required_scope?: string;
  limit?: string;
  max?: number | null;
  plan?: string;
}

export interface CursorMeta {
  path: string;
  per_page: number;
  next_cursor: string | null;
  prev_cursor: string | null;
}

export interface CursorLinks {
  first: string | null;
  last: string | null;
  prev: string | null;
  next: string | null;
}

export interface Page<T> {
  data: T[];
  meta: CursorMeta;
  links: CursorLinks;
}

export type ListParams = {
  cursor?: string;
  per_page?: number;
};

export interface StatusPage {
  id: Id;
  slug: string;
  name: string;
  description: string | null;
  timezone: string | null;
  is_public: boolean;
  published: boolean;
  visibility: 'public' | 'password' | 'members';
  theme: string;
  incident_notifications_enabled: boolean;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  public_url: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface StatusPageInput {
  name?: string;
  slug?: string;
  description?: string | null;
  timezone?: string;
  is_public?: boolean;
  theme?: Theme;
  incident_notifications_enabled?: boolean;
}

export interface Component {
  id: Id;
  status_page_id: Id;
  name: string;
  description: string | null;
  status: ComponentStatus;
  position: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ComponentInput {
  name?: string;
  description?: string | null;
  status?: ComponentStatus;
  position?: number;
}

export interface MonitorInput {
  name?: string;
  type?: MonitorType;
  url?: string | null;
  host?: string | null;
  port?: number | null;
  dns_record_type?: DnsRecordType | null;
  dns_expected_value?: string | null;
  confirm_from_locations?: boolean;
  confirmation_quorum?: number | null;
  expiry_alerts_enabled?: boolean;
  /** Comma-separated days, e.g. "14,7,1". */
  expiry_alert_days?: string;
  http_method?: 'GET' | 'HEAD';
  expected_status_code?: number;
  keyword?: string | null;
  keyword_match_type?: 'contains' | 'not_contains' | null;
  interval_minutes?: number;
  timeout_seconds?: number;
  consecutive_threshold?: number;
  allow_cold_start?: boolean;
  cold_start_timeout_seconds?: number;
  /** "HH:MM" in the page's timezone; set both or neither. */
  check_window_start?: string | null;
  check_window_end?: string | null;
  status_component_id?: Id | null;
  enabled?: boolean;
  /** Browser monitors (Pro): required for type "browser"; the first step must be goto. */
  browser_steps?: BrowserStep[] | null;
  /** Write-only. On update a string sets that secret, null removes it, names left out are kept. */
  browser_secrets?: Record<string, string | null> | null;
}

export interface Monitor extends Required<Omit<MonitorInput, 'http_method' | 'keyword_match_type' | 'dns_record_type' | 'expected_status_code' | 'browser_secrets'>> {
  id: Id;
  status_page_id: Id;
  /** Names only; secret values are never returned. */
  browser_secret_names: string[];
  http_method: string;
  expected_status_code: number | null;
  keyword_match_type: string | null;
  dns_record_type: string | null;
  ssl_expires_at: Timestamp;
  ssl_issuer: string | null;
  domain_expires_at: Timestamp;
  auto_created: boolean;
  state: 'up' | 'down' | 'unknown' | null;
  consecutive_failures: number | null;
  last_checked_at: Timestamp;
  next_check_at: Timestamp;
  last_status_code: number | null;
  last_response_time_ms: number | null;
  last_error_message: string | null;
  uptime_percentage: number | null;
  heartbeat_url: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface IncidentUpdate {
  id: Id;
  incident_id: Id;
  message: string;
  created_at: Timestamp;
}

export interface Incident {
  id: Id;
  status_page_id: Id;
  title: string;
  impact: Impact;
  state: IncidentState;
  latest_update: string | null;
  started_at: Timestamp;
  resolved_at: Timestamp;
  component_ids: Id[];
  updates: IncidentUpdate[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface IncidentInput {
  title?: string;
  impact?: Impact;
  state?: IncidentState;
  message?: string | null;
  component_ids?: Id[];
  started_at?: string;
}

export interface Maintenance {
  id: Id;
  status_page_id: Id;
  title: string;
  description: string | null;
  state: MaintenanceState;
  starts_at: Timestamp;
  ends_at: Timestamp;
  component_ids: Id[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MaintenanceInput {
  title?: string;
  description?: string | null;
  starts_at?: string;
  ends_at?: string;
  state?: MaintenanceState;
  component_ids?: Id[];
}

export interface Subscriber {
  id: Id;
  status_page_id: Id;
  channel: 'email' | 'slack' | 'teams' | 'discord' | 'webhook';
  email: string | null;
  destination: string;
  confirmed: boolean;
  confirmed_at: Timestamp;
  quarantined_at: Timestamp;
  component_ids: Id[];
  created_at: Timestamp;
}

export interface SubscriberInput {
  email: string;
  /** Requires the subscribers:confirm scope. */
  confirmed?: boolean;
  component_ids?: Id[];
}

export interface Webhook {
  id: Id;
  status_page_id: Id;
  url: string;
  enabled: boolean;
  status_component_id: Id | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WebhookInput {
  url?: string;
  enabled?: boolean;
  status_component_id?: Id | null;
  /** Write-only. Omit on create to have Beacon generate one (returned once). */
  secret?: string;
}

/** Create returns the signing secret once, next to the webhook. */
export interface CreatedWebhook extends Webhook {
  secret: string;
}

export interface Import {
  id: Id;
  status_page_id: Id;
  source: 'api' | 'public';
  source_reference: string;
  state: 'queued' | 'running' | 'completed' | 'stopped' | 'failed';
  stage: string | null;
  counts: Record<string, number>;
  message: string | null;
  include_subscribers: boolean;
  subscribers_consent: boolean;
  started_at: Timestamp;
  finished_at: Timestamp;
  created_at: Timestamp;
}

export interface ImportInput {
  source: 'api' | 'public';
  api_key?: string;
  page_id?: string;
  url?: string;
  include_subscribers?: boolean;
  subscribers_consent?: boolean;
}

// Ingest endpoints return a flat (un-enveloped) shape where ids are strings.

export interface IngestIncident {
  id: string;
  status_page_id: string;
  title: string;
  impact: Impact;
  state: IncidentState;
  latest_update: string | null;
  started_at: Timestamp;
  resolved_at: Timestamp;
  component_ids: string[];
  updates: { message: string; created_at: Timestamp }[];
}

export interface IngestCreateIncident {
  title: string;
  impact?: Impact;
  state?: IncidentState;
  message?: string;
  component_ids?: (number | string)[];
}

export interface IngestUpdateIncident {
  title?: string;
  impact?: Impact;
  state?: IncidentState;
  message?: string | null;
  resolved?: boolean;
}

export interface IngestComponent {
  id: string;
  name: string;
  status: ComponentStatus;
  position: number;
  description: string | null;
}

export interface IngestUpdateComponent {
  status: ComponentStatus;
  description?: string | null;
}
