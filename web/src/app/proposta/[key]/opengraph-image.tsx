import { ImageResponse } from "next/og";
import { data } from "@/lib/data";
import { date } from "@/lib/format";
import { assertCard, CAVEAT } from "@/lib/og-card";
import { OG } from "@/lib/og-tokens";
import { bodyFullName, label, typeName } from "@/lib/pauta";

// U17: card da proposta. Só o que a pauta oficial diz, com fonte, data da leitura e a ressalva de que a pauta muda. Sem adjetivo.
export const alt = "Cartão da proposta com a data da pauta, a fonte e a ressalva";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key;
  const p = /^[a-z0-9-]{1,120}$/.test(key) ? await data.getPautaProposal(key) : null;
  if (!p) return fallback();
  const e = p.entry;
  const asOf = p.readAt ? `pauta lida em ${date(p.readAt)}` : `gerado em ${date(new Date().toISOString())}`;
  const card = assertCard({
    asOf,
    facts: [{ value: date(e.scheduledFor), label: "data prevista na pauta", source: bodyFullName(e.body), caveat: CAVEAT.schedule }],
  });
  const summary = (e.plain ?? e.summary ?? "").trim();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: OG.bg, padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 26, color: OG.textMuted }}>{typeName(e.type)} · {bodyFullName(e.body)}</div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 84, fontWeight: 700, color: OG.text, lineHeight: 1.05 }}>{label(e)}</div>
        {summary ? <div style={{ display: "flex", marginTop: 20, fontSize: 30, color: OG.text, lineHeight: 1.3 }}>{summary.length > 200 ? `${summary.slice(0, 197).trimEnd()}…` : summary}</div> : null}
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: "auto", gap: 20 }}>
          {card.facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", width: 340, padding: 20, background: OG.surface, border: `2px solid ${OG.border}`, borderRadius: 14 }}>
              <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: OG.text }}>{f.value}</div>
              <div style={{ display: "flex", fontSize: 20, color: OG.text, marginTop: 6 }}>{f.label}</div>
              <div style={{ display: "flex", fontSize: 17, color: OG.text, fontWeight: 700, marginTop: 6 }}>{f.caveat}</div>
              <div style={{ display: "flex", fontSize: 16, color: OG.textMuted, marginTop: 4 }}>Fonte: {f.source}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, fontSize: 20, color: OG.textMuted }}>
          <span style={{ color: OG.accent, fontWeight: 700 }}>Segue o Voto</span>
          <span>{card.asOf} · Sem nota, sem ranking.</span>
        </div>
      </div>
    ),
    size,
  );
}

function fallback() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: OG.bg, fontSize: 56, color: OG.text }}>Segue o Voto</div>,
    size,
  );
}
