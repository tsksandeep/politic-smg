// CadreDetail (/cadres/:id) — drill-down for a single cadre: how much positive vs negative
// coverage their own posts attract, which narratives they appear in (favourable + anti-party),
// and anonymized recent example comments. Reached from the board's cadre-coverage rankings.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../services/supabase";
import AppShell from "../components/AppShell";
import { CommentList, type ExampleComment, Metric, sectionLabel } from "../components/detailKit";
import { CLASH, color, MONO } from "../theme";

interface Coverage {
  cadre_id: string;
  display_name: string;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  total_count: number;
}
interface CadreNarrative {
  narrative_id: string;
  stance: string;
  theme_summary: string | null;
  volume: number;
  cadre_comment_count: number;
}

export default function CadreDetail() {
  const { id } = useParams();
  const [cov, setCov] = useState<Coverage | null>(null);
  const [narratives, setNarratives] = useState<CadreNarrative[]>([]);
  const [examples, setExamples] = useState<ExampleComment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, n, ex] = await Promise.all([
        supabase.from("cadre_coverage").select("*").eq("cadre_id", id).maybeSingle(),
        supabase.from("cadre_narrative").select("*").eq("cadre_id", id).order("cadre_comment_count", { ascending: false }),
        supabase.from("cadre_comment").select("body,sentiment,sentiment_confidence,language").eq("cadre_id", id).not("body", "is", null).order("ingested_at", { ascending: false }).limit(12),
      ]);
      setCov((c.data as Coverage) ?? null);
      setNarratives((n.data as CadreNarrative[]) ?? []);
      setExamples((ex.data as ExampleComment[]) ?? []);
      setLoaded(true);
    })();
  }, [id]);

  if (!loaded) {
    return <AppShell title="Cadre"><div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading cadre…</div></AppShell>;
  }
  if (!cov) {
    return (
      <AppShell title="Cadre">
        <Link to="/board" className="backlink">← War room board</Link>
        <div className="panel" style={{ padding: 28, marginTop: 14, color: color.textDim }}>Cadre not found.</div>
      </AppShell>
    );
  }

  const pos = cov.positive_count;
  const neg = cov.negative_count;
  const pn = pos + neg;
  const posPct = pn ? Math.round((pos / pn) * 100) : 0;
  const favourable = narratives.filter((n) => n.stance === "pro_party");
  const anti = narratives.filter((n) => n.stance === "anti_party");

  return (
    <AppShell title="Cadre">
      <Link to="/board" className="backlink">← War room board</Link>

      <h1 className="scanline" style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.8vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 16px", paddingBottom: 12 }}>
        {cov.display_name}
      </h1>

      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <h3 style={sectionLabel}>Coverage</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
          <Metric label="Positive" value={String(pos)} accent={color.positive} />
          <Metric label="Negative" value={String(neg)} accent={color.ember} />
          <Metric label="Neutral" value={String(cov.neutral_count)} />
          <Metric label="Total" value={String(cov.total_count)} />
        </div>
        {pn > 0 && (
          <>
            <div style={{ display: "flex", height: 8, borderRadius: 9999, overflow: "hidden", background: "rgba(255,255,255,0.08)" }}>
              <div style={{ width: `${posPct}%`, background: color.positive }} />
              <div style={{ width: `${100 - posPct}%`, background: color.ember }} />
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: color.textFaint, marginTop: 7 }}>
              {posPct}% positive · {100 - posPct}% negative (of polarized reactions)
            </div>
          </>
        )}
      </div>

      <div className="detail-grid">
        <div className="detail-sticky">
          <h3 style={sectionLabel}>Narratives this cadre appears in</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {narratives.length === 0 && <div className="panel" style={{ padding: 18, color: color.textFaint, fontSize: 13 }}>Not part of any clustered narrative yet.</div>}
            {[...favourable, ...anti].map((nv) => {
              const accent = nv.stance === "pro_party" ? color.positive : color.ember;
              return (
                <Link key={nv.narrative_id} to={`/narratives/${nv.narrative_id}`} className="panel card-link" style={{ padding: "12px 14px", position: "relative", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 9999, background: accent, flexShrink: 0 }} aria-hidden="true" />
                    <span style={{ color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nv.theme_summary ?? "Narrative"}</span>
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: accent, whiteSpace: "nowrap" }}>{nv.cadre_comment_count}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <h3 style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
            <span>Recent comments · anonymized</span>
            <span style={{ color: color.textDim }}>{examples.length}</span>
          </h3>
          <CommentList comments={examples} />
        </div>
      </div>
    </AppShell>
  );
}
