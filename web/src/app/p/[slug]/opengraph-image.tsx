import { ImageResponse } from "next/og";
import { campaignTotals } from "@/lib/campaign";
import { data } from "@/lib/data";
import { count, date, money } from "@/lib/format";
import { OG } from "@/lib/og-tokens";
import { assertCard, CAVEAT, type CardFact } from "@/lib/og-card";

// W2 item 12: card de compartilhamento por crachá (WhatsApp, redes). Sem foto: não temos licença de uso das fotos oficiais.
// Até 4 números, cada um com a fonte; nenhum adjetivo, nota ou cor de partido.
export const alt = "Cartão com nome, cargo, partido e números oficiais";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const found = /^[a-z0-9-]{1,120}$/.test(slug) ? await data.getPerson(slug) : null;
  if (!found) return fallback();
  const person = found.person;
  const [mandates, cands, stats, yearly, accrued] = await Promise.all([
    data.getMandates(person.id),
    data.getCandidacies(person.id),
    data.getStats(person.id, "career"),
    data.getYearlyStats(person.id),
    data.getSalaryAccrued(person.id),
  ]);
  const main = mandates.find((m) => m.status === "em_exercicio") ?? mandates[0];
  const senado = main?.office === "senador";
  const house = senado ? "Senado" : "Câmara";
  const since = (k: "presencePresent" | "proposalsPrincipal") => yearly.find((y) => y[k] !== null)?.year;
  const elected = cands.find((c) => c.result?.startsWith("eleito"));
  const assets = cands.find((c) => c.assetsCents !== null);
  const camp = campaignTotals(cands);

  const facts: (CardFact | null)[] = [
    stats.salaryMonthlyCents !== null
      ? { value: `${stats.salaryIsCeiling ? "até " : ""}${money(stats.salaryMonthlyCents)}`, label: stats.salaryIsCeiling ? "teto do salário por mês" : "salário bruto por mês", source: stats.salaryIsCeiling ? "Constituição" : "lei do subsídio", caveat: stats.salaryIsCeiling ? CAVEAT.salaryCeiling : CAVEAT.salary }
      : null,
    stats.presenceTotal
      ? { value: `${Math.round(((stats.presencePresent ?? 0) / stats.presenceTotal) * 100)}%`, label: `presença desde ${since("presencePresent")}`, source: house, caveat: CAVEAT.presence }
      : null,
    stats.proposalsPrincipal !== null ? { value: count(stats.proposalsPrincipal), label: `propostas desde ${since("proposalsPrincipal")}`, source: house, caveat: CAVEAT.proposals } : null,
    elected?.votes != null ? { value: count(elected.votes), label: `votos em ${elected.year}`, source: "TSE", caveat: CAVEAT.votes } : null,
    assets ? { value: money(assets.assetsCents!), label: `patrimônio declarado (${assets.year})`, source: "TSE", caveat: CAVEAT.assets } : null,
    camp.raisedCents !== null ? { value: money(camp.raisedCents), label: "arrecadado nas campanhas", source: "TSE", caveat: CAVEAT.raised } : null,
    accrued ? { value: money(accrued.cents), label: "salário recebido", source: "lei do subsídio", caveat: CAVEAT.salaryAccrued } : null,
  ];
  // D281: data = o carimbo mais antigo das fontes usadas (a conservadora); sem carimbo, a data de geração, dita como tal.
  const stamps = await Promise.all([data.getStamp(senado ? "senado" : "camara"), data.getStamp("tse")].map((p) => p.catch(() => null)));
  const oldest = stamps.map((s) => s?.refreshedAt).filter((x): x is string => !!x).sort()[0];
  const asOf = oldest ? `dados de ${date(oldest)}` : `gerado em ${date(new Date().toISOString())}`;
  const shown = assertCard({ facts: facts.filter((f): f is CardFact => f !== null).slice(0, 4), asOf }).facts;
  const role = main ? `${main.officeName} · ${main.placeLabel} · ${main.party.acronym}` : "";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: OG.bg, padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 26, color: OG.textMuted }}>{role}</div>
        <div style={{ display: "flex", marginTop: 8, fontSize: person.displayName.length > 28 ? 64 : 84, fontWeight: 700, color: OG.text, lineHeight: 1.05 }}>{person.displayName}</div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: "auto", gap: 20 }}>
          {shown.map((f) => (
            <div
              key={f.label}
              style={{ display: "flex", flexDirection: "column", width: 255, padding: 20, background: OG.surface, border: `2px solid ${OG.border}`, borderRadius: 14 }}
            >
              <div style={{ display: "flex", fontSize: f.value.length > 11 ? 29 : 38, fontWeight: 700, color: OG.text }}>{f.value}</div>
              <div style={{ display: "flex", fontSize: 20, color: OG.text, marginTop: 6 }}>{f.label}</div>
              <div style={{ display: "flex", fontSize: 17, color: OG.text, fontWeight: 700, marginTop: 6 }}>{f.caveat}</div>
              <div style={{ display: "flex", fontSize: 16, color: OG.textMuted, marginTop: 4 }}>Fonte: {f.source}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, fontSize: 20, color: OG.textMuted }}>
          <span style={{ color: OG.accent, fontWeight: 700 }}>quem · representa</span>
          <span>{asOf} · Sem nota, sem ranking.</span>
        </div>
      </div>
    ),
    size,
  );
}

function fallback() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: OG.bg, fontSize: 56, color: OG.text }}>
        quem · representa
      </div>
    ),
    size,
  );
}
