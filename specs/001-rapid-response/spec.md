# Feature Specification: Rapid-Response Narrative Alerting

**Feature Branch**: `001-rapid-response`

**Created**: 2026-06-24

**Status**: Draft

**Input**: User description: "Phase 1 wedge — detect anti-party narratives and coordinated trolling in the comment sections of our own cadres' posts in near-real-time, and surface them fast enough for the party war room to mobilize a counter-response."

## Clarifications

### Session 2026-06-24

- Q: Raw comment text retention window before automated deletion? → A: 30 days for raw text;
  anonymized/aggregated derivatives retained longer.
- Q: How much history do we ingest when a cadre connects an account? → A: Last 30 days (bounded
  backfill to establish a baseline without a heavy quota burst).
- Q: What access-control roles should v1 support? → A: Admin + Analyst (Admin manages
  users/config/connected accounts; Analyst monitors and triages).
- Q: Are detection thresholds analyst-configurable or fixed in v1? → A: Fixed defaults, tunable
  by Admin via a small set of global knobs (no per-analyst configuration).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - War room sees a rising anti-party narrative early (Priority: P1)

A party war-room analyst watches a single live board. When hostile or coordinated commentary
starts building on the party's own cadre posts, a clear alert appears — naming the emerging
narrative, where it is concentrated, and how fast it is growing — early enough that the team
can respond before it peaks.

**Why this priority**: This is the entire reason the product exists for a party rebuilding
after a shock defeat. It is the demonstrable moment that justifies the engagement: "an
anti-party narrative spiked at 9:00; here it is at 9:15; mobilize." Everything else is
supporting.

**Independent Test**: With a small set of pre-connected cadre accounts, inject a burst of
hostile comments on their posts and confirm a single, readable alert surfaces on the war-room
board within the target time, correctly summarizing the narrative and its concentration —
without any other story implemented.

**Acceptance Scenarios**:

1. **Given** connected cadre accounts with normal comment activity, **When** a coordinated
   burst of anti-party comments appears on their posts, **Then** an alert is raised on the
   war-room board within the target detection time, summarizing the narrative theme, affected
   posts/cadres, volume, and growth rate.
2. **Given** an active alert, **When** the analyst opens it, **Then** they see representative
   (anonymized) example comments, the theme summary, a confidence score, and a coordination
   indicator — clearly labeled as signal, not verdict.
3. **Given** ordinary positive or mixed engagement, **When** comment volume rises normally,
   **Then** no alert is raised (the system distinguishes a hostile spike from healthy activity).
4. **Given** a comment commenter classified as likely-opposition vs likely-public, **When** the
   classification is shown, **Then** it is displayed as a confidence score, never as a definite
   label.

---

### User Story 2 - A cadre connects their account by consent (Priority: P2)

A cadre opts in, authorizes the party platform to read their party-related Instagram
(Creator/Business) and YouTube accounts, and from then on their posts and the comments on
those posts feed the war-room board. They can disconnect at any time.

**Why this priority**: It is the data supply for Story 1 at scale. Story 1 can be demonstrated
on a few manually pre-connected accounts, but the product only becomes real when cadres can
self-onboard. It depends on nothing else and is independently testable.

**Independent Test**: A cadre completes the consent flow for one account and confirms their
recent posts and the comments on them begin appearing in the system; the cadre then revokes
access and confirms ingestion stops.

**Acceptance Scenarios**:

1. **Given** a cadre with a party-related Creator/Business account, **When** they complete the
   consent authorization, **Then** the account is connected and its posts plus their comments
   begin to be ingested.
2. **Given** a connected account, **When** the cadre revokes consent, **Then** ingestion stops
   immediately and their data is purged on the documented schedule.
3. **Given** an account that only supports personal (non-creator) access, **When** the cadre
   tries to connect, **Then** they are told the account type is unsupported and guided to
   convert — no data is collected.

---

### User Story 3 - Analyst triages an alert and records the response (Priority: P3)

An analyst acknowledges an alert, assigns it, marks it as being handled, and records what
counter-response was taken, so the war room avoids duplicate effort and can review how fast and
how well it responded.

**Why this priority**: It closes the loop and produces the response-latency metric that proves
value over time, but the core wedge (seeing the threat early) delivers value without it.

**Independent Test**: With an existing alert, an analyst changes its status and logs a note, and
the change is reflected for other analysts on the board.

**Acceptance Scenarios**:

1. **Given** an open alert, **When** an analyst acknowledges and assigns it, **Then** its status
   updates live for all analysts.
2. **Given** an acknowledged alert, **When** the analyst logs the response taken and closes it,
   **Then** the time from detection to response is recorded.

---

### Edge Cases

- **Healthy spike vs hostile spike**: a viral *positive* post drawing heavy engagement must not
  trigger a hostile-narrative alert.
- **Single loud critic vs coordination**: one prolific critic should read differently from many
  accounts pushing identical messaging in a short window.
- **Sarcasm / regional language / code-mixing**: Tamil–English code-mixed and sarcastic comments
  must be handled without large numbers of false positives.
- **Consent revoked mid-incident**: if a cadre disconnects during an active alert, their data
  must drop out and the alert recompute without it.
- **Platform throttling**: when comment retrieval is rate-limited or quota-constrained, the
  system must degrade gracefully (delayed, not lost) and make the freshness of data visible.
- **Deleted comments**: comments removed at the source after ingestion must be handled per the
  retention/deletion policy.
- **Quiet periods**: long stretches with no hostile activity must not produce noise or
  false alerts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST ingest posts and their associated comments only from cadre accounts
  that have granted explicit consent, and only for content on those cadres' own posts.
- **FR-002**: System MUST detect rising anti-party narratives on connected cadres' posts and
  raise an alert that names the narrative theme, the affected cadres/posts, the current volume,
  and the rate of growth.
- **FR-003**: System MUST detect signs of coordination (e.g., many accounts pushing near-identical
  messaging within a short window) and indicate coordination as a labeled signal.
- **FR-004**: System MUST present every probabilistic output (anti-party classification,
  public-vs-opposition classification, coordination) as a confidence score or estimate, never as
  a definitive fact.
- **FR-005**: System MUST distinguish hostile/coordinated spikes from healthy or neutral
  engagement surges to keep false alerts low. Detection thresholds (what constitutes a spike /
  coordination) ship as fixed defaults and MUST be tunable by an Admin through a small set of
  global controls; per-analyst threshold configuration is out of scope for v1.
- **FR-006**: System MUST surface alerts on a shared live war-room view that updates in
  near-real-time without manual refresh.
- **FR-007**: System MUST let an analyst open an alert and view the theme summary, representative
  example comments, the affected scope, and the confidence/coordination signals.
- **FR-008**: System MUST anonymize commenter identities before storage (hashed identifiers) and
  perform detection on patterns rather than named individuals; it MUST NOT expose per-citizen
  profiles.
- **FR-009**: System MUST analyze comments in aggregate and automatically delete raw comment text
  **30 days** after ingestion; anonymized/aggregated derivatives (hashed identifiers, narrative
  and trend data) MAY be retained longer.
- **FR-010**: Cadres MUST be able to connect a supported account via a consent flow and disconnect
  at any time; on disconnect, ingestion MUST stop immediately and data MUST be purged on the
  documented schedule.
- **FR-010a**: On connecting an account, the system MUST backfill posts and their comments from
  the **last 30 days** only, to establish a detection baseline without an unbounded one-time
  ingestion burst (respecting platform quota limits).
- **FR-011**: System MUST NOT collect, scrape, or analyze data from opposition-owned or arbitrary
  open-platform accounts, or from cadres' posts they have not consented to share.
- **FR-012**: System MUST observe and flag only; it MUST NOT claim or attempt to block, gate, or
  remove any post or comment.
- **FR-013**: Analysts MUST be able to acknowledge, assign, annotate, and close an alert, with
  status changes reflected live to other analysts (P3).
- **FR-014**: System MUST record the elapsed time from detection to logged response for closed
  alerts (P3).
- **FR-015**: System MUST make the freshness/recency of underlying data visible so analysts know
  how current the board is, including during platform throttling.
- **FR-016**: System MUST restrict access to internal authorized party users only, supporting two
  least-privilege roles: **Admin** (manages users, global detection settings, and connected
  accounts) and **Analyst** (monitors the war-room board and triages alerts). Analysts MUST NOT
  access user-management or configuration functions.
- **FR-017**: System MUST store all personal data within an India region.

### Key Entities *(include if feature involves data)*

- **Cadre**: a consenting party worker; owns one or more connected social accounts; can grant or
  revoke consent.
- **Connected Account**: a consented Instagram (Creator/Business) or YouTube account belonging to
  a cadre; the only source of ingested content.
- **Post**: a piece of content published by a connected account; the unit comments attach to.
- **Comment**: a reaction on a connected account's post; commenter identity is stored only as a
  hashed identifier; raw text has short retention.
- **Narrative**: a clustered hostile/anti-party theme detected across comments, with volume,
  growth rate, affected scope, and confidence.
- **Alert**: a surfaced narrative event for the war room, with status (open/acknowledged/closed),
  assignee, example comments, confidence and coordination signals, and detection/response times.
- **Analyst (War-room user)**: an authorized internal user who monitors the board and triages
  alerts; cannot manage users or settings.
- **Admin**: an authorized internal user who manages users, connected accounts, and global
  detection settings, in addition to Analyst capabilities.
- **Detection Settings**: the global, Admin-tunable thresholds that govern when a spike or
  coordination signal becomes an alert.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A coordinated hostile burst on connected posts surfaces as an alert on the war-room
  board within **15 minutes** of the burst beginning.
- **SC-002**: An analyst opening an alert can understand the narrative, its scale, and where it is
  concentrated within **30 seconds**, without leaving the board.
- **SC-003**: At least **80%** of raised alerts are judged by analysts to be genuinely worth
  attention (false-alert rate below 20%) during a representative pilot period.
- **SC-004**: No alert or detection ever presents a probabilistic judgment as fact — **100%** of
  classification outputs shown carry a visible confidence/estimate label.
- **SC-005**: A cadre can complete consent onboarding for one account in under **5 minutes**, and
  revocation stops new data within **the next ingestion cycle** and purges data on schedule.
- **SC-006**: Median time from alert detection to logged response decreases over the pilot, with a
  baseline established in the first **two weeks** of use.
- **SC-007**: The board reflects newly arrived comments within the platform-imposed freshness
  window, and never silently shows stale data without indicating recency.

## Assumptions

- **Notification surface (v1)**: alerts are delivered on an in-app live war-room board as the
  primary channel; external push (mobile/messaging) is out of scope for this phase.
- **Scale**: a single party connects on the order of low-thousands of cadre accounts; the design
  targets this range, not mass-public scale.
- **Detection latency** is bounded by what consented platform data and their rate/quota limits
  allow; "near-real-time" is defined as the 15-minute target in SC-001, not instantaneous.
- **Coordination and sentiment** are inferred signals, accepted as imperfect and always labeled;
  perfect attribution of who is "opposition" is explicitly not a goal.
- **Language**: Tamil, English, and Tamil–English code-mixed comments are in scope for the pilot.
- **Single party**: this feature serves one party in an isolated tenant; multi-party operation is
  out of scope.
- **Prerequisite for demo**: Story 1 can be validated with a small set of manually pre-connected
  accounts before Story 2 (self-service onboarding) is complete.
- **Out of scope for this phase**: performance analytics (best/worst content, unique engaged
  audience, cadre-overlap maps) and message-discipline flagging — later phases.
