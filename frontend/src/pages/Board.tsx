// Board (T029) — the live war-room board (User Story 1). Subscribes to alert changes via
// Supabase Realtime (FR-006) so new/updated alerts appear without manual refresh.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../services/supabase";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { FreshnessBanner } from "../components/FreshnessBanner";

interface BoardAlert {
  id: string;
  status: string;
  theme_summary: string | null;
  volume: number;
  growth_rate: number;
  confidence: number | null;
  coordination_score: number | null;
  affected_scope: { cadres?: number; posts?: number };
  detected_at: string;
  data_fresh_as_of: string | null;
}

export default function Board() {
  const [alerts, setAlerts] = useState<BoardAlert[]>([]);

  async function load() {
    const { data } = await supabase
      .from("alert_board")
      .select("*")
      .in("status", ["open", "acknowledged"])
      .order("detected_at", { ascending: false });
    setAlerts((data as BoardAlert[]) ?? []);
  }

  useEffect(() => {
    load();
    // Realtime: any change to the alert table refreshes the board (FR-006).
    const channel = supabase
      .channel("alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const freshest = alerts.map((a) => a.data_fresh_as_of).filter(Boolean).sort().at(-1) ?? null;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>War Room — Active Narratives</h1>
      <FreshnessBanner freshAsOf={freshest} />
      {alerts.length === 0 && <p>No active anti-party narratives detected.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {alerts.map((a) => (
          <li key={a.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, margin: "12px 0" }}>
            <Link to={`/alerts/${a.id}`} style={{ fontSize: 18, fontWeight: 600 }}>
              {a.theme_summary ?? "Emerging narrative"}
            </Link>
            <div style={{ fontSize: 13, color: "#555", margin: "6px 0" }}>
              {a.status.toUpperCase()} · vol {a.volume} · growth ×{a.growth_rate?.toFixed(1)} ·{" "}
              {a.affected_scope?.cadres ?? 0} cadres, {a.affected_scope?.posts ?? 0} posts
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <ConfidenceBadge label="anti-party" confidence={a.confidence ?? 0} />
              <ConfidenceBadge label="coordination" confidence={a.coordination_score ?? 0} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
