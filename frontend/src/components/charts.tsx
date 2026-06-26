// charts.tsx — Recharts visualizations, themed for the light dashboard.
//  • DecayChart — a narrative's lifecycle/decay curve from narrative_observation: per-window
//    volume (bars) + engagement velocity (line). Engagement is a PROXY FOR REACH (Principle V);
//    the axis caption says so. Numbers are mono-labelled; colour is never the sole indicator.

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { color, MONO } from "../theme";

const tick = { fontFamily: MONO, fontSize: 11, fill: color.textDim };
const tooltipStyle = { borderRadius: 10, border: `1px solid ${color.border}`, fontFamily: MONO, fontSize: 12 };

export interface Observation {
  at: string;
  volume: number;
  velocity: number;
}

function fmtTime(at: string): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
}

export function DecayChart({ observations }: { observations: Observation[] }) {
  if (!observations || observations.length === 0) {
    return (
      <div className="panel" style={{ padding: 18, color: color.textFaint, fontSize: 13 }}>
        No lifecycle observations captured yet — coverage may be ramping (see Coverage).
      </div>
    );
  }
  const data = [...observations]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((o) => ({ t: fmtTime(o.at), volume: o.volume, velocity: Math.round(o.velocity * 10) / 10 }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="vel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color.ember} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color.ember} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={color.border} vertical={false} />
          <XAxis dataKey="t" tick={tick} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis yAxisId="v" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis yAxisId="e" orientation="right" tick={tick} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} contentStyle={tooltipStyle} />
          <Bar yAxisId="v" dataKey="volume" name="Volume" fill={color.neutral} fillOpacity={0.55} radius={[3, 3, 0, 0]} />
          <Area yAxisId="e" dataKey="velocity" name="Velocity (proxy)" stroke="none" fill="url(#vel)" />
          <Line yAxisId="e" type="monotone" dataKey="velocity" name="Velocity (proxy)" stroke={color.ember} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p style={{ fontFamily: MONO, fontSize: 10, color: color.textFaint, margin: "8px 0 0", letterSpacing: "0.04em" }}>
        Bars = new posts per window · line = engagement velocity (a proxy for reach — impressions are unobservable).
      </p>
    </div>
  );
}
