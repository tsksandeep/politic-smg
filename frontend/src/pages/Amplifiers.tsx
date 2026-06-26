// Amplifiers (FR-012) — the ranked amplifier target list across all narratives, from the
// amplifier_targets view: the opposition accounts that most reliably convert a narrative into
// engagement velocity, plus probable origin / patient-zero flags. Amplification and origin are
// ESTIMATES (Principle V), labelled as such. Only public account handles appear — never commenters.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabase";
import { AmplifierRow, type AmplifierTarget } from "../components/AmplifierRow";
import AppShell from "../components/AppShell";
import { CLASH, color, MONO } from "../theme";

export default function Amplifiers() {
  const [rows, setRows] = useState<AmplifierTarget[]>([]);
  const [originOnly, setOriginOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("amplifier_targets").select("*").order("amplification_score", { ascending: false });
      setRows((data as AmplifierTarget[]) ?? []);
      setLoaded(true);
    })();
  }, []);

  const filtered = useMemo(() => (originOnly ? rows.filter((r) => r.is_origin) : rows), [rows, originOnly]);
  const uniqueAccounts = useMemo(() => new Set(rows.map((r) => r.tracked_account_id)).size, [rows]);

  return (
    <AppShell title="Amplifiers">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontFamily: CLASH, fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          Key <span style={{ color: color.ember }}>amplifiers</span>
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 12, color: color.textFaint }}>
          {uniqueAccounts} accounts · {rows.length} narrative roles
        </span>
      </div>
      <p style={{ color: color.textFaint, fontSize: 13, margin: "0 0 18px", maxWidth: 720, lineHeight: 1.55 }}>
        Ranked by how reliably each account converts a narrative into engagement velocity — an estimate, not a verdict. Engagement is a proxy for reach.
      </p>

      <div className="scanline" style={{ paddingBottom: 8, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: color.textDim }}>Ranked targets</span>
        <button type="button" className="sort-tab" data-active={originOnly} onClick={() => setOriginOnly((v) => !v)}>
          origins only
        </button>
      </div>

      {!loaded ? (
        <div className="panel" style={{ padding: 28, color: color.textDim, fontFamily: MONO, fontSize: 13 }}>Loading amplifiers…</div>
      ) : filtered.length === 0 ? (
        <div className="panel" style={{ padding: 28, color: color.textFaint, fontSize: 13 }}>
          {originOnly ? "No probable origins flagged yet." : "No amplifier participation computed yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((a, i) => <AmplifierRow key={`${a.tracked_account_id}-${a.narrative_id}`} a={a} rank={i + 1} showNarrative />)}
        </div>
      )}
    </AppShell>
  );
}
