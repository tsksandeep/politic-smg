// NarrativeDetail (/narratives/:id) — drill-down on one opposition narrative (US1.3): the
// generated theme + signals, the lifecycle/decay curve (narrative_observation), representative
// captions, the amplifier graph (amplifier_targets), and audio/hashtag coordination signals
// (coordination_board). Every probabilistic value is rendered as a labelled signal (Principle V).

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";
import { LifecycleBadge } from "../components/LifecycleBadge";
import { DecayChart, type Observation } from "../components/charts";
import { AmplifierRow, type AmplifierTarget } from "../components/AmplifierRow";
import { CoordinationCard, type CoordinationRow } from "../components/CoordinationCard";
import { Metric, sectionLabel } from "../components/detailKit";
import AppShell from "../components/AppShell";
import type { NarrativeRow } from "../components/NarrativeCard";
import { CLASH, color, MONO } from "../theme";

interface Caption {
  id: string;
  caption: string | null;
  permalink: string | null;
  is_video: boolean;
  taken_at: string;
}

export default function NarrativeDetail() {
  const { id } = useParams();
  const [n, setN] = useState<NarrativeRow | null>(null);
  const [obs, setObs] = useState<Observation[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [amplifiers, setAmplifiers] = useState<AmplifierTarget[]>([]);
  const [coordination, setCoordination] = useState<CoordinationRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [row, o, caps, amp, coord] = await Promise.all([
        supabase.from("narrative_board").select("*").eq("id", id).maybeSingle(),
        supabase.from("narrative_observation").select("at,volume,velocity").eq("narrative_id", id).order("at", { ascending: true }),
        supabase.from("post").select("id,caption,permalink,is_video,taken_at").eq("narrative_id", id).not("caption", "is", null).order("taken_at", { ascending: false }).limit(8),
        supabase.from("amplifier_targets").select("*").eq("narrative_id", id),
        supabase.from("coordination_board").select("*").eq("narrative_id", id).order("detected_at", { ascending: false }),
      ]);
      setN((row.data as NarrativeRow) ?? null);
      setObs((o.data as Observation[]) ?? []);
      setCaptions((caps.data as Caption[]) ?? []);
      setAmplifiers(((amp.data as AmplifierTarget[]) ?? []).sort((a, b) => (b.amplification_score ?? 0) - (a.amplification_score ?? 0)));
      setCoordination((coord.data as CoordinationRow[]) ?? []);
      setLoaded(true);
    })();
  }, [id]);

  if (!loaded) {
    return <AppShell title="Narrative"><div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading narrative…</div></AppShell>;
  }
  if (!n) {
    return (
      <AppShell title="Narrative">
        <Link to="/narratives" className="backlink">← Narrative board</Link>
        <div className="panel" style={{ padding: 28, marginTop: 14, color: color.textDim }}>Narrative not found (or not in your tenant).</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Narrative">
      <Link to="/narratives" className="backlink">← Narrative board</Link>

      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.8vw, 2.1rem)", fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.02em", margin: "14px 0 10px", paddingBottom: 12 }}>
        {n.theme_summary ?? "Unlabelled narrative cluster"}
      </h1>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <LifecycleBadge state={n.lifecycle_state} />
        <FreshnessBanner freshAsOf={n.data_fresh_as_of} />
      </div>

      <div className="detail-grid">
        {/* Left — signals + lifecycle */}
        <div className="detail-sticky" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel" style={{ padding: 18 }}>
            <h3 style={sectionLabel}>Signal readout</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <Metric label="Volume" value={String(n.volume ?? 0)} />
              <Metric label="Growth" value={`${(n.growth_rate ?? 0) >= 0 ? "+" : ""}${(n.growth_rate ?? 0).toFixed(1)}`} />
              <Metric label="Performance" value={Math.round(n.performance_score ?? 0).toLocaleString()} accent={color.ember} />
              <Metric label="Half-life" value={n.half_life_hours != null ? `${n.half_life_hours.toFixed(0)}h` : "—"} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ConfidenceBadge label="narrative" confidence={n.confidence ?? 0} />
              {n.coordination_score != null && <ConfidenceBadge label="coordination (inferred)" confidence={n.coordination_score} />}
            </div>
            <p style={{ color: color.textFaint, fontSize: 12.5, fontStyle: "italic", margin: "14px 0 0", lineHeight: 1.5 }}>
              Theme, lifecycle, and coordination are generated estimates — signals, not verdicts. Engagement is a proxy for reach.
            </p>
          </div>
        </div>

        {/* Right — lifecycle chart, captions, amplifiers, coordination */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <section>
            <h3 style={sectionLabel}>Lifecycle &amp; decay · estimate</h3>
            <div className="panel" style={{ padding: "18px 16px 12px" }}>
              <DecayChart observations={obs} />
            </div>
          </section>

          <section>
            <h3 style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
              <span>Representative captions · public posts</span>
              <span style={{ color: color.textDim }}>{captions.length}</span>
            </h3>
            {captions.length === 0 ? (
              <div className="panel" style={{ padding: 18, color: color.textFaint, fontSize: 13 }}>No captions retained (raw text purges on the retention schedule).</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {captions.map((c) => (
                  <div key={c.id} className="panel" style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 14, color: color.text, lineHeight: 1.5 }}>{c.caption}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: color.textFaint, marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>{c.is_video ? "REEL" : "POST"}</span>
                      <span>{new Date(c.taken_at).toLocaleDateString()}</span>
                      {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="backlink">source ↗</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
              <span>Amplifier graph · ranked accounts</span>
              <span style={{ color: color.textDim }}>{amplifiers.length}</span>
            </h3>
            {amplifiers.length === 0 ? (
              <div className="panel" style={{ padding: 18, color: color.textFaint, fontSize: 13 }}>No amplifier participation computed yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {amplifiers.map((a, i) => <AmplifierRow key={a.tracked_account_id} a={a} rank={i + 1} />)}
              </div>
            )}
          </section>

          <section>
            <h3 style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
              <span>Audio / hashtag coordination · inferred</span>
              <span style={{ color: color.textDim }}>{coordination.length}</span>
            </h3>
            {coordination.length === 0 ? (
              <div className="panel" style={{ padding: 18, color: color.textFaint, fontSize: 13 }}>No coordination signals on this narrative.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {coordination.map((c) => <CoordinationCard key={c.id} c={c} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
