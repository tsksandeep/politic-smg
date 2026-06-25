// charts.tsx — Recharts visualizations, themed for the light dashboard.
//  • CoverageChart  — grouped horizontal bars: positive vs negative coverage per cadre (clickable).
//  • SentimentDonut — 3-way positive/negative/neutral split for one cadre.
// Numbers are mono-labelled directly on the marks (colour is never the sole indicator).

import { useNavigate } from "react-router-dom";
import { Bar, BarChart, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { color, MONO } from "../theme";

const tick = { fontFamily: MONO, fontSize: 11, fill: color.textDim };
const tooltipStyle = { borderRadius: 10, border: `1px solid ${color.border}`, fontFamily: MONO, fontSize: 12 };
const legendStyle = { fontFamily: MONO, fontSize: 11 };
const labelStyle = { fontFamily: MONO, fontSize: 11, fill: color.text };

interface CoverageRow {
  cadre_id: string;
  display_name: string;
  positive_count: number;
  negative_count: number;
}

export function CoverageChart({ rows }: { rows: CoverageRow[] }) {
  const navigate = useNavigate();
  const data = [...rows].sort((a, b) => (b.positive_count + b.negative_count) - (a.positive_count + a.negative_count));
  const height = Math.max(180, data.length * 58 + 44);
  // deno-lint-ignore no-explicit-any
  const open = (d: any) => {
    const id = d?.cadre_id ?? d?.payload?.cadre_id;
    if (id) navigate(`/cadres/${id}`);
  };
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: 30, bottom: 0, left: 6 }} barCategoryGap={16} barGap={2}>
          <XAxis type="number" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="display_name" tick={tick} axisLine={false} tickLine={false} width={100} />
          <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} contentStyle={tooltipStyle} />
          <Legend wrapperStyle={legendStyle} iconType="circle" />
          <Bar dataKey="positive_count" name="Positive" fill={color.positive} radius={[0, 4, 4, 0]} cursor="pointer" onClick={open}>
            <LabelList dataKey="positive_count" position="right" style={labelStyle} />
          </Bar>
          <Bar dataKey="negative_count" name="Negative" fill={color.hostile} radius={[0, 4, 4, 0]} cursor="pointer" onClick={open}>
            <LabelList dataKey="negative_count" position="right" style={labelStyle} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={{ fontFamily: MONO, fontSize: 10, color: color.textFaint, margin: "8px 0 0", letterSpacing: "0.04em" }}>
        Select a bar to open a cadre.
      </p>
    </div>
  );
}

export function SentimentDonut({ positive, negative, neutral }: { positive: number; negative: number; neutral: number }) {
  const total = positive + negative + neutral;
  const data = [
    { name: "Positive", value: positive, fill: color.positive },
    { name: "Negative", value: negative, fill: color.hostile },
    { name: "Neutral", value: neutral, fill: color.neutral },
  ].filter((d) => d.value > 0);
  return (
    <div style={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={92} paddingAngle={2} stroke="#fff" strokeWidth={2}>
            {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={legendStyle} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "calc(50% - 18px)", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontFamily: "'Clash Display', ui-sans-serif, system-ui, sans-serif", fontSize: 26, fontWeight: 600, color: color.text, lineHeight: 1 }}>{total}</div>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: color.textFaint, marginTop: 3 }}>comments</div>
      </div>
    </div>
  );
}
