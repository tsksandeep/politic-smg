// Shared types: the coordinator wire contract (coordinator-api.md) + internal capture shapes.

export type TargetKind = "account" | "post_metrics" | "comments";

export interface Rate {
  max_requests_per_day: number;
  min_interval_ms: number;
  jitter_ms: number;
}

export interface RegisterResponse {
  node_id: string;
  node_token: string; // shown once; we store only this run, then keep it in storage
  tenant_id: string;
  rate: Rate;
}

export interface WorkItem {
  assignment_id: string;
  target_kind: TargetKind;
  handle?: string;
  external_id?: string;
  shortcode?: string;
  hint?: { app_id?: string };
}

export interface WorkLeaseResponse {
  lease_expires_at: string;
  items: WorkItem[];
  rate?: Rate;
}

// --- /submit payloads (coordinator-api.md) ---

export interface AccountField {
  external_id: string;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  is_private: boolean;
}

export interface PostField {
  shortcode: string;
  is_video: boolean;
  caption: string | null;
  audio_id: string | null;
  taken_at: string | null; // ISO-8601
  permalink: string;
  like_count: number | null;
  comment_count: number | null;
  view_count: number | null;
  media_url: string | null; // transient; coordinator clears once the media worker transcribes
}

// NOTE (Principle III): author_handle is a RAW public handle. We send it only because the
// coordinator HMAC-hashes it at ingest and immediately discards the raw value. The node never
// persists, logs, or analyses comment authors — it stays "dumb".
export interface CommentField {
  author_handle: string;
  text: string;
  created_at: string | null; // ISO-8601
}

export interface SubmitAccount {
  assignment_id: string;
  captured_at: string;
  account: AccountField;
  posts: PostField[];
}

export interface SubmitPostMetrics {
  assignment_id: string;
  captured_at: string;
  post_shortcode: string;
  post: PostField;
}

export interface SubmitComments {
  assignment_id: string;
  captured_at: string;
  post_shortcode: string;
  comments: CommentField[];
}

export type SubmitPayload = SubmitAccount | SubmitPostMetrics | SubmitComments;

export interface SubmitResponse {
  accepted: boolean;
  submission_id: string;
  deduped?: number;
}

export type IpStatus = "healthy" | "throttled" | "blocked";

export interface HeartbeatRequest {
  ok_count: number;
  error_count: number;
  ip_status: IpStatus;
}

export interface HeartbeatResponse {
  node_status: "active" | "quarantined";
  backoff_ms: number;
}

// --- Internal capture results ---

export interface CaptureAccountResult {
  account: AccountField;
  posts: PostField[];
}

/** A capture can succeed, hit a recoverable error, or report the IP as burned. */
export interface CaptureOutcome<T> {
  ok: boolean;
  data?: T;
  ipBurned?: boolean; // persistent 401 -> Principle IX graceful degradation
  error?: string;
}
