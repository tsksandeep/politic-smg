// detailKit — shared bits for the detail pages (NarrativeDetail, AlertDetail, Coverage): the
// section label, a big metric, and an anonymized comment list (sentiment-coloured, never an
// identity — only an HMAC author hash exists, raw commenter handles are never stored, FR-007).

import { CLASH, color, MONO, sentimentColor } from "../theme";

export const sectionLabel = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: color.textFaint,
  margin: "0 0 12px",
  fontWeight: 600,
};

export function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: color.textFaint }}>{label}</div>
      <div style={{ fontFamily: CLASH, fontSize: 22, fontWeight: 600, color: accent ?? color.text, marginTop: 3 }}>{value}</div>
    </div>
  );
}

export interface ExampleComment {
  body: string;
  sentiment: string;
  sentiment_confidence: number;
  language: string;
}

export function CommentList({ comments }: { comments: ExampleComment[] }) {
  if (!comments || comments.length === 0) {
    return <div className="panel" style={{ padding: 18, color: color.textFaint, fontSize: 13 }}>No example comments available.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {comments.map((c, i) => (
        <div key={i} className="panel" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ width: 3, alignSelf: "stretch", borderRadius: 9999, background: sentimentColor(c.sentiment), flexShrink: 0 }} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: color.text, lineHeight: 1.5 }}>{c.body}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.04em", color: color.textFaint, marginTop: 6 }}>
              <span style={{ color: sentimentColor(c.sentiment) }}>{c.sentiment}</span>
              {" "}· {Math.round((c.sentiment_confidence ?? 0) * 100)}% · {c.language}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
