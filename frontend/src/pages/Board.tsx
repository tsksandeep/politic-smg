// Board (T029) — the live war-room coverage board. Two-sided: favourable (pro-party) narratives
// best/worst, the anti-party narratives (which carry alerts), and per-cadre positive vs negative
// coverage. Subscribes to alert + narrative changes via Supabase Realtime (FR-006).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

interface Scope {
  cadres?: number;
  posts?: number;
}
interface AlertCard {
  id: string;
  status: string;
  theme_summary: string | null;
  volume: number;
  growth_rate: number;
  confidence: number | null;
  coordination_score: number | null;
  affected_scope: Scope;
  data_fresh_as_of: string | null;
}
interface NarrativeCard {
  id: string;
  theme_summary: string | null;
  volume: number;
  growth_rate: number;
  confidence: number | null;
  performance_score: number;
  affected_scope: Scope;
  data_fresh_as_of: string | null;
}
interface Cadre {
  cadre_id: string;
  display_name: string;
  positive_count: number;
  negative_count: number;
}

export default function Board() {
  const [anti, setAnti] = useState<AlertCard[]>([]);
  const [favourable, setFavourable] = useState<NarrativeCard[]>([]);
  const [cadres, setCadres] = useState<Cadre[]>([]);

  async function load() {
    const [a, f, c] = await Promise.all([
      supabase.from("alert_board").select("*").in("status", ["open", "acknowledged"]).order("detected_at", { ascending: false }),
      supabase.from("narrative_board").select("*").eq("stance", "pro_party").order("performance_score", { ascending: false }),
      supabase.from("cadre_coverage").select("*"),
    ]);
    setAnti((a.data as AlertCard[]) ?? []);
    setFavourable((f.data as NarrativeCard[]) ?? []);
    setCadres((c.data as Cadre[]) ?? []);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("board")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "narrative" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const best = favourable[0] ?? null;
  const worst = favourable.length > 1 ? favourable[favourable.length - 1] : null;
  const posCadres = [...cadres].filter((c) => c.positive_count > 0).sort((x, y) => y.positive_count - x.positive_count).slice(0, 6);
  const negCadres = [...cadres].filter((c) => c.negative_count > 0).sort((x, y) => y.negative_count - x.negative_count).slice(0, 6);
  const freshest = [...anti.map((a) => a.data_fresh_as_of), ...favourable.map((f) => f.data_fresh_as_of)].filter(Boolean).sort().at(-1) ?? null;

  return (
    <AppShell title="War Room">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          Narrative <span style={{ color: color.ember }}>coverage</span>
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint }}>
          {favourable.length} favourable · {anti.length} anti-party · {cadres.length} cadres
        </span>
      </div>
      <div style={{ marginBottom: 26 }}>
        <FreshnessBanner freshAsOf={freshest} />
      </div>

      {/* 1 + 2: best & worst favourable */}
      <SectionHead label="In favour of the party — best & worst" dot={color.positive} />
      <div className="two-col" style={{ marginBottom: 30 }}>
        {best
          ? <FavourableCard n={best} tone="best" tag="BEST IN FAVOUR" />
          : <EmptyPanel text="No favourable narrative yet." />}
        {worst
          ? <FavourableCard n={worst} tone="worst" tag="WORST IN FAVOUR" />
          : <EmptyPanel text="Only one favourable narrative so far." />}
      </div>

      {/* 3: anti-party narratives */}
      <SectionHead label="Anti-party narratives" dot={color.ember} />
      {anti.length === 0
        ? <EmptyPanel text="No active anti-party narratives detected." />
        : (
          <div className="board-grid" style={{ marginBottom: 30 }}>
            {anti.map((a) => <AntiCard key={a.id} a={a} />)}
          </div>
        )}

      {/* 4 + 5: cadre coverage */}
      <SectionHead label="Cadre coverage" dot={color.textDim} />
      <div className="two-col">
        <div>
          <SubHead label="Maximum positive coverage" c={color.positive} />
          <CadreBars rows={posCadres} kind="pos" />
        </div>
        <div>
          <SubHead label="Maximum negative coverage" c={color.ember} />
          <CadreBars rows={negCadres} kind="neg" />
        </div>
      </div>
    </AppShell>
  );
}

function SectionHead({ label, dot }: { label: string; dot: string }) {
  return (
    <div className="scanline" style={{ display: "flex", alignItems: "center", gap: 9, paddingBottom: 8, marginBottom: 14 }}>
      <span style={{ width: 7, height: 7, borderRadius: 9999, background: dot, boxShadow: `0 0 8px ${dot}` }} />
      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: color.textDim }}>{label}</span>
    </div>
  );
}

function SubHead({ label, c }: { label: string; c: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: c }} />
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: color.textFaint }}>{label}</span>
    </div>
  );
}

function Metrics({ volume, growth, scope }: { volume: number; growth: number; scope: Scope }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 12, color: color.textDim, margin: "10px 0 12px", display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
      <span>VOL <b style={{ color: color.text }}>{volume}</b></span>
      <span>GROWTH <b style={{ color: color.text }}>×{growth?.toFixed(1)}</b></span>
      <span>{scope?.cadres ?? 0} cadres · {scope?.posts ?? 0} posts</span>
    </div>
  );
}

function FavourableCard({ n, tone, tag }: { n: NarrativeCard; tone: "best" | "worst"; tag: string }) {
  const accent = tone === "best" ? color.positive : color.neutral;
  return (
    <Link to={`/narratives/${n.id}`} className="panel card-link" style={{ padding: "18px 20px 18px 22px", position: "relative" }}>
      <span style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 9999, background: accent, boxShadow: `0 0 12px ${accent}` }} aria-hidden="true" />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontFamily: CLASH, fontSize: 17, fontWeight: 600, lineHeight: 1.25, color: color.text }}>
          {n.theme_summary ?? "Favourable narrative"}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: accent, border: `1px solid ${accent}66`, borderRadius: 9999, padding: "3px 9px", whiteSpace: "nowrap" }}>{tag}</span>
      </div>
      <Metrics volume={n.volume} growth={n.growth_rate} scope={n.affected_scope} />
      <ConfidenceBadge label="support" confidence={n.confidence ?? 0} />
    </Link>
  );
}

function AntiCard({ a }: { a: AlertCard }) {
  return (
    <Link to={`/alerts/${a.id}`} className="panel card-link" style={{ padding: "18px 20px 18px 22px", position: "relative" }}>
      <span style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 9999, background: color.ember, boxShadow: `0 0 12px ${color.ember}` }} aria-hidden="true" />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
        <span style={{ fontFamily: CLASH, fontSize: 17, fontWeight: 600, lineHeight: 1.25, color: color.text }}>
          {a.theme_summary ?? "Emerging narrative"}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: a.status === "acknowledged" ? color.neutral : color.ember, border: `1px solid ${a.status === "acknowledged" ? "rgba(224,162,60,0.4)" : "rgba(255,90,54,0.4)"}`, borderRadius: 9999, padding: "3px 9px", whiteSpace: "nowrap" }}>
          {a.status.toUpperCase()}
        </span>
      </div>
      <Metrics volume={a.volume} growth={a.growth_rate} scope={a.affected_scope} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ConfidenceBadge label="anti-party" confidence={a.confidence ?? 0} />
        <ConfidenceBadge label="coordination" confidence={a.coordination_score ?? 0} />
      </div>
    </Link>
  );
}

function CadreBars({ rows, kind }: { rows: Cadre[]; kind: "pos" | "neg" }) {
  const accent = kind === "pos" ? color.positive : color.ember;
  const val = (r: Cadre) => (kind === "pos" ? r.positive_count : r.negative_count);
  const max = Math.max(...rows.map(val), 1);
  if (rows.length === 0) return <EmptyPanel text="No coverage yet." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r, idx) => (
        <Link key={r.cadre_id} to={`/cadres/${r.cadre_id}`} className="panel card-link" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint, width: 16, textAlign: "right" }}>{idx + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 500, color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.display_name}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: accent }}>{val(r)}</span>
            </div>
            <div style={{ height: 5, borderRadius: 9999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((val(r) / max) * 100)}%`, background: accent, borderRadius: 9999 }} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="panel" style={{ padding: "22px", color: color.textFaint, fontSize: 13 }}>{text}</div>
  );
}
