// options.ts — operator setup + status UI. Talks to the background SW via messages.
// It also requests the runtime host permission for the operator-entered coordinator origin
// (the coordinator host is not known at build time, so it lives in optional_host_permissions).

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();

function send<T = any>(msg: any): Promise<T> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function ensureCoordinatorPermission(coordinatorUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(coordinatorUrl).origin + "/*";
  } catch {
    return false;
  }
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  // Must be called from a user gesture (the Enrol click) to show the prompt.
  return chrome.permissions.request({ origins: [origin] });
}

async function enrol(): Promise<void> {
  const coordinatorUrl = val("coordinatorUrl");
  const enrolmentCode = val("enrolmentCode");
  const label = val("label");
  const msg = $("msg");

  if (!coordinatorUrl || !enrolmentCode || !label) {
    msg.textContent = "Fill in all three fields.";
    return;
  }
  msg.textContent = "Requesting permission + registering…";

  const granted = await ensureCoordinatorPermission(coordinatorUrl);
  if (!granted) {
    msg.textContent = "Coordinator host permission was denied — cannot enrol.";
    return;
  }

  const res = await send<{ ok: boolean; error?: string }>({
    type: "register",
    coordinatorUrl,
    enrolmentCode,
    label,
  });
  msg.textContent = res.ok
    ? "Enrolled. The node will start leasing work shortly."
    : `Enrolment failed: ${res.error ?? "unknown error"}`;
  await refresh();
}

function pill(el: HTMLElement, value: string): void {
  el.textContent = value;
  el.className =
    "pill " +
    (value === "active" || value === "healthy"
      ? "ok"
      : value === "throttled"
      ? "warn"
      : value === "blocked" || value === "quarantined"
      ? "bad"
      : "");
}

async function refresh(): Promise<void> {
  const res = await send<{ ok: boolean; status?: Record<string, any> }>({ type: "status" });
  const s = res.status ?? {};
  pill($("nodeStatus"), s.nodeStatus ?? "unknown");
  pill($("ipStatus"), s.ipStatus ?? "unknown");
  $("captures").textContent = String(s.stats?.captures ?? 0);

  const safe = {
    enrolled: !!s.nodeId,
    label: s.label ?? null,
    tenant_id: s.tenantId ?? null,
    coordinator: s.coordinatorUrl ?? null,
    rate: s.rate ?? null,
    node_status: s.nodeStatus ?? null,
    ip_status: s.ipStatus ?? null,
    today: s.daily ?? null,
    last_capture_at: s.stats?.lastCaptureAt ?? null,
    last_error: s.stats?.lastError ?? null,
    backoff_until: s.backoffUntil ? new Date(s.backoffUntil).toISOString() : null,
  };
  $("statusDump").textContent = JSON.stringify(safe, null, 2);
}

$("enrol").addEventListener("click", () => void enrol());
$("runNow").addEventListener("click", async () => {
  await send({ type: "runNow" });
  setTimeout(() => void refresh(), 1500);
});
$("refresh").addEventListener("click", () => void refresh());

// Prefill the coordinator field if already enrolled, and show current status.
void send<{ ok: boolean; status?: Record<string, any> }>({ type: "status" }).then((res) => {
  if (res.status?.coordinatorUrl) {
    ($("coordinatorUrl") as HTMLInputElement).value = res.status.coordinatorUrl;
  }
  if (res.status?.label) ($("label") as HTMLInputElement).value = res.status.label;
  void refresh();
});
