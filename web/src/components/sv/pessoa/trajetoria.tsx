// U18 (D304): trajetória numa linha do tempo única, em ordem cronológica, sem adjetivo. Mandatos, candidaturas (eleitas ou
// não) e o partido atual com a data de início que a fonte registra. Não há contrato de lista de filiações
// (`party_memberships`): o partido de cada candidatura é o que o TSE registrou nela; o do mandato não aparece, porque a
// leitura de mandatos devolve o partido atual, não o da época. Nada aqui diz "trocou de partido": cada linha é um fato.
import type { Candidacy, ElectionResult, Mandate, MandateStatus, Party, PartyProvenance } from "@/lib/data";
import { fmtDate } from "@/components/sv/fmt";
import { mesAno } from "./format";

type Cand = Candidacy & { party: Party; officeName: string; placeLabel: string };
type Mand = Mandate & { party: Party; officeName: string; placeLabel: string };

export type ItemTrajetoria = { chave: string; quando: string; ordem: string; texto: string; fonte: string };

const RESULTADO: Record<ElectionResult, (fem: boolean) => string> = {
  eleito: (f) => (f ? "eleita" : "eleito"),
  eleito_qp: (f) => (f ? "eleita por quociente partidário" : "eleito por quociente partidário"),
  eleito_media: (f) => (f ? "eleita por média" : "eleito por média"),
  suplente: () => "suplente",
  nao_eleito: (f) => (f ? "não eleita" : "não eleito"),
  segundo_turno: () => "foi ao segundo turno",
  indeferido: () => "candidatura indeferida",
  renuncia: () => "renunciou à candidatura",
};

const SITUACAO: Partial<Record<MandateStatus, string>> = {
  em_exercicio: "em exercício",
  eleito_aguardando_posse: "aguardando posse",
  licenciado: "licenciado",
  afastado: "afastado",
  encerrado: "encerrado",
  renunciou: "renunciou",
  cassado: "cassado",
};

const FONTE_PARTIDO: Record<"camara" | "senado" | "tse", string> = { camara: "Câmara dos Deputados", senado: "Senado Federal", tse: "TSE (Justiça Eleitoral)" };
const FONTE_MANDATO: Record<string, string> = { tse: "TSE (Justiça Eleitoral)", camara: "Câmara dos Deputados", senado: "Senado Federal" };

const sigla = (p: Party | null | undefined) => (p ? (p.name && p.name !== p.acronym ? `${p.acronym} (${p.name})` : p.acronym) : null);

/**
 * Itens em ordem cronológica (mais antigo primeiro). Candidatura: só o ano (é o que a fonte dá); uma linha por eleição
 * (ano, cargo e lugar): com dois turnos, vale o resultado do último. Mandato: início e fim (mm/aaaa).
 */
export function itensTrajetoria(cands: Cand[], mandatos: Mand[], partidoAtual: { prov: PartyProvenance; party: Party | null } | null, fem: boolean, hojeIso: string): ItemTrajetoria[] {
  const out: ItemTrajetoria[] = [];
  const vistas = new Set<string>();
  // getCandidacies vem do ano mais recente ao mais antigo e, no mesmo ano, do último turno ao primeiro
  for (const c of cands) {
    const k = `${c.year}|${c.office}|${c.placeIbge}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    const partido = sigla(c.party);
    const res = c.result ? RESULTADO[c.result](fem) : "sem resultado publicado";
    out.push({
      chave: `c-${k}`,
      quando: String(c.year),
      ordem: `${c.year}-10-00-c`,
      texto: `Candidatura a ${c.officeName.toLowerCase()} (${c.placeLabel})${partido ? `, pelo ${partido}` : ""}: ${res}.`,
      fonte: "TSE (Justiça Eleitoral)",
    });
  }
  for (const m of mandatos) {
    const ini = mesAno(m.startedOn);
    const fim = m.endsOn ? mesAno(m.endsOn) : null;
    const sit = SITUACAO[m.status] ?? m.status.replaceAll("_", " ");
    out.push({
      chave: `m-${m.id}`,
      quando: m.startedOn.slice(0, 4),
      ordem: `${m.startedOn}-m`,
      texto: `Mandato de ${m.officeName.toLowerCase()} (${m.placeLabel}), de ${ini}${fim && fim !== "—" ? ` a ${fim}` : ""}. Situação: ${sit}.`,
      fonte: FONTE_MANDATO[m.statusSource] ?? "fonte oficial do mandato",
    });
  }
  // data futura (mandato que ainda não começou) não é filiação registrada: fica de fora
  if (partidoAtual && partidoAtual.prov.kind !== "none" && partidoAtual.party && partidoAtual.prov.since.slice(0, 10) <= hojeIso) {
    const p = partidoAtual.prov;
    out.push({
      chave: "partido-atual",
      quando: p.since.slice(0, 4),
      ordem: `${p.since}-p`,
      texto: `Partido atual, ${sigla(partidoAtual.party)}, registrado desde ${fmtDate(p.since)}.`,
      fonte: p.kind === "tse" && p.electionYear ? `${FONTE_PARTIDO.tse}, candidatura de ${p.electionYear}` : FONTE_PARTIDO[p.kind],
    });
  }
  return out.sort((a, b) => a.ordem.localeCompare(b.ordem));
}

export function LinhaDoTempo({ itens }: { itens: ItemTrajetoria[] }) {
  return (
    <ol className="sv-trj">
      {itens.map((i) => (
        <li key={i.chave}>
          <span className="sv-trj__a">{i.quando}</span>
          <p className="sv-trj__t">
            {i.texto} <span className="sv-sm">Fonte: {i.fonte}.</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
