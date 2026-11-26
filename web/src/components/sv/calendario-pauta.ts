// F5b do roteiro do eleitor: calendário (.ics) da pauta do plenário. Módulo puro: recebe as entradas já lidas e devolve o texto iCalendar (RFC 5545).
// Só plenário (comissão é etapa, a decisão final vem depois); sem filtro por tema (o tema da pauta é texto oficial só da Câmara, sem ligação
// conferida com os 17 assuntos). O calendário é um retrato da leitura: não se atualiza sozinho, e a descrição de cada evento diz isso.
import type { PautaEntry } from "@/lib/data/types";

export type CasaCalendario = "camara" | "senado";
export const CASAS_CALENDARIO: readonly CasaCalendario[] = ["camara", "senado"];

/** Valida o parâmetro `casa`: ausente = as duas; valor fora de camara|senado = null (a rota responde 400, nunca chuta). */
export function lerCasa(raw: string | null | undefined): CasaCalendario | "todas" | null {
  if (raw == null || raw === "") return "todas";
  return (CASAS_CALENDARIO as readonly string[]).includes(raw) ? (raw as CasaCalendario) : null;
}

const CASA: Record<CasaCalendario, { art: string; nome: string }> = { camara: { art: "da", nome: "Câmara dos Deputados" }, senado: { art: "do", nome: "Senado Federal" } };
/** Quantos dias à frente o arquivo olha (a pauta das Casas só é publicada para as próximas semanas). */
export const DIAS_A_FRENTE = 14;

/** Leitura de cada Casa como a página a conhece: `readAt` null = Casa não lida; `failed` de `total` reuniões não carregaram. */
export type LeituraCasa = { readAt: string | null; failed: number; total: number };
export type Leituras = Record<CasaCalendario, LeituraCasa>;

/** Escapa texto de valor iCalendar (RFC 5545 §3.3.11): barra, ponto e vírgula, vírgula e quebra de linha; remove controles. */
export function escapar(t: string): string {
  return t
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Dobra a linha em até 75 octetos (RFC 5545 §3.1), sem cortar no meio de um caractere; continuação começa com um espaço. CRLF no fim. */
export function dobrar(linha: string): string {
  const enc = new TextEncoder();
  if (enc.encode(linha).length <= 75) return `${linha}\r\n`;
  const partes: string[] = [];
  let atual = "";
  let bytes = 0;
  let limite = 75;
  for (const ch of linha) {
    const b = enc.encode(ch).length;
    if (bytes + b > limite) {
      partes.push(atual);
      atual = " ";
      bytes = 1;
      limite = 75;
    }
    atual += ch;
    bytes += b;
  }
  partes.push(atual);
  return partes.map((p) => `${p}\r\n`).join("");
}

const utc = (iso: string): string | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

const dataBr = (iso: string): string => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Avisos do arquivo inteiro: Casa pedida que não foi lida e leitura incompleta. Vão no cabeçalho do calendário e na descrição de cada evento. */
export function avisosDe(leituras: Leituras, casa: CasaCalendario | "todas"): string[] {
  const out: string[] = [];
  for (const c of CASAS_CALENDARIO) {
    if (casa !== "todas" && casa !== c) continue;
    const l = leituras[c];
    if (!l.readAt) out.push(`A pauta ${CASA[c].art} ${CASA[c].nome} ainda não foi lida: pode haver propostas marcadas que não estão neste arquivo.`);
    else if (l.failed > 0) out.push(`Leitura incompleta ${CASA[c].art} ${CASA[c].nome}: ${l.failed} de ${l.total} reuniões não carregaram, pode haver mais propostas do que as listadas.`);
  }
  return out;
}

/** Evento de uma proposta no plenário. null se a data da fonte é inválida: evento sem data não entra (não inventamos horário). */
export function eventoDe(e: PautaEntry, o: { base: string; geradoEm: string; leituras: Leituras; avisos: string[]; demo: boolean }): string | null {
  const ini = utc(e.scheduledFor);
  if (!ini) return null;
  const c = CASA[e.body === "senado" ? "senado" : "camara"];
  const leitura = o.leituras[e.body === "senado" ? "senado" : "camara"].readAt;
  const lida = leitura ? `lida em ${dataBr(leitura)}` : "data da leitura não registrada";
  const nome = `${e.type} ${e.number}/${e.year}`;
  const descricao = [
    e.summary ? e.summary : "Ementa não disponível na fonte.",
    `Fonte: pauta do plenário ${c.art} ${c.nome}, ${lida}.`,
    // o horário é o da sessão na fonte, não o da votação desta proposta; a fonte informa o início da sessão e não o fim (1 hora é só espaço na agenda)
    "Horário: início da sessão do plenário, segundo a fonte. A hora em que esta proposta será votada não é informada, e a duração de 1 hora é só espaço na agenda.",
    "A pauta pode mudar depois da leitura e este calendário não se atualiza sozinho: confira a data na página da proposta.",
    ...o.avisos,
    ...(o.demo ? ["Exemplo ilustrativo: proposta inventada para a demonstração."] : []),
  ].join("\n");
  const linhas = [
    "BEGIN:VEVENT",
    `UID:${e.key}-${ini}@segueovoto`,
    `DTSTAMP:${utc(o.geradoEm) ?? ini}`,
    `DTSTART:${ini}`,
    `DTEND:${utc(new Date(new Date(e.scheduledFor).getTime() + 3600_000).toISOString())}`,
    `SUMMARY:${escapar(`${o.demo ? "[Exemplo] " : ""}${nome} no plenário ${c.art} ${c.nome}`)}`,
    `DESCRIPTION:${escapar(descricao)}`,
    `URL:${o.base.replace(/\/$/, "")}/decisao/${encodeURIComponent(e.key)}`,
    "END:VEVENT",
  ];
  return linhas.map(dobrar).join("");
}

/** A Casa pedida (ou as duas) tem alguma leitura? Sem nenhuma, a rota responde 503: um calendário vazio diria "nada marcado", que não sabemos. */
export function haLeitura(leituras: Leituras, casa: CasaCalendario | "todas"): boolean {
  return CASAS_CALENDARIO.some((c) => (casa === "todas" || casa === c) && !!leituras[c].readAt);
}

/**
 * Calendário completo. `entradas` = plenário desta semana e das próximas. Só entra o que é plenário, da Casa pedida, de agora até DIAS_A_FRENTE dias
 * (o que já passou não vai para a agenda). Sem entradas ainda é um calendário válido (vazio), com os avisos no cabeçalho. Ordem: data, depois chave.
 */
export function montarCalendario(entradas: readonly PautaEntry[], opts: { base: string; geradoEm: string; leituras: Leituras; casa?: CasaCalendario | "todas"; demo?: boolean }): string {
  const casa = opts.casa ?? "todas";
  const agora = new Date(opts.geradoEm).getTime();
  const limite = agora + DIAS_A_FRENTE * 86_400_000;
  const avisos = avisosDe(opts.leituras, casa);
  const vistos = new Set<string>();
  const eventos = entradas
    .filter((e) => e.stage === "plenario" && (casa === "todas" || e.body === casa))
    .filter((e) => {
      const t = new Date(e.scheduledFor).getTime();
      return t >= agora && t <= limite;
    })
    .filter((e) => {
      const k = `${e.key}|${e.scheduledFor}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : a.scheduledFor > b.scheduledFor ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((e) => eventoDe(e, { base: opts.base, geradoEm: opts.geradoEm, leituras: opts.leituras, avisos, demo: !!opts.demo }))
    .filter((x): x is string => x !== null);
  const nome = casa === "todas" ? "Pauta do plenário (Câmara e Senado)" : `Pauta do plenário (${CASA[casa].nome})`;
  const desc = [`Propostas que acompanhamos no plenário, de agora até ${DIAS_A_FRENTE} dias. Retrato da pauta lida: não se atualiza sozinho. Sem filtro por assunto.`, ...avisos].join(" ");
  return [
    "BEGIN:VCALENDAR\r\n",
    "VERSION:2.0\r\n",
    "PRODID:-//Segue o Voto//Pauta do plenario//PT\r\n",
    "CALSCALE:GREGORIAN\r\n",
    "METHOD:PUBLISH\r\n",
    dobrar(`X-WR-CALNAME:${escapar(nome)}`),
    dobrar(`X-WR-CALDESC:${escapar(desc)}`),
    ...eventos,
    "END:VCALENDAR\r\n",
  ].join("");
}
