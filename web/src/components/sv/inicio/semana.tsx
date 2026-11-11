import Link from "next/link";
import { BODY_NAME, billLabel, clip, fmtDateTime } from "@/components/sv/fmt";
import { AFIRMACAO, conferidoEm } from "@/components/sv/estados";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { JaVale, JaValeLegenda, Lacuna, Prova } from "@/components/sv/ui";
import { data, type AnswerClaim, type PautaEntry, type PautaOverview } from "@/lib/data";
import { casaEstadual } from "./lemos";
import { addDays, dayKey, dayNum, fmtRange, mondayOf, weekday } from "./datas";

const MAX_RESPOSTAS = 24; // limite de leituras de respostas (uma por item exibido com resposta publicada)
const MAX_VIDA = 3; // --vida: no máximo 3 rótulos coloridos na tela

export const esferaDe = (e: PautaEntry) => `Federal · ${BODY_NAME[e.body]} · ${e.stage === "plenario" ? "plenário" : e.committee ? `comissão ${e.committee}` : "comissão"}`;
export const tituloDe = (e: PautaEntry) => e.plain ?? clip(e.summary ?? billLabel(e), 150);
export const byDate = (a: PautaEntry, b: PautaEntry) => a.scheduledFor.localeCompare(b.scheduledFor) || a.key.localeCompare(b.key);

/** Os 7 dias da pauta lida (segunda a domingo) e os itens dela que caem neles: plenário e comissão. */
export function faixaDaSemana(overview: PautaOverview, hoje: string): { dias: string[]; entries: PautaEntry[] } {
  const inicio = dayKey(overview.week.weekStarts) ?? mondayOf(hoje);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  const entries = [...overview.plenary, ...overview.committees]
    .filter((e) => {
      const k = dayKey(e.scheduledFor);
      return !!k && k >= dias[0] && k <= dias[6];
    })
    .sort(byDate);
  return { dias, entries };
}

type Muda = { claim: AnswerClaim; reviewedAt: string };

/** "o que muda" só dos itens exibidos que têm respostas revisadas e publicadas (`reviewedAt`): nada de N+1 sobre a pauta inteira. */
// Na demonstração a pauta não marca `reviewedAt`, então lá todo item exibido é consultado.
async function respostas(entries: PautaEntry[]): Promise<Map<string, Muda>> {
  const keys = [...new Set(entries.filter((e) => e.reviewedAt || data.isDemo).map((e) => e.key))].slice(0, MAX_RESPOSTAS);
  const rows = await Promise.all(keys.map(async (k) => [k, await data.getPautaProposal(k).catch(() => null)] as const));
  const out = new Map<string, Muda>();
  for (const [k, p] of rows) {
    const claim = p?.answers?.fields.o_que_muda;
    if (p?.answers && claim && claim.state === "diz" && claim.says) out.set(k, { claim, reviewedAt: p.answers.reviewedAt });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Segunda 9 e quinta 12 a domingo 15": dias seguidos vazios viram um intervalo. */
function descreverDias(keys: string[], todos: string[]): string {
  const idx = keys.map((k) => todos.indexOf(k));
  const runs: number[][] = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  }
  const nome = (i: number) => `${weekday(todos[i])} ${dayNum(todos[i])}`;
  const partes = runs.map((r) => (r.length === 1 ? nome(r[0]) : `${nome(r[0])} a ${nome(r[r.length - 1])}`));
  return cap(partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes[0]);
}

function Cabecalho({ sub, leg = true }: { sub?: string; leg?: boolean }) {
  return (
    <div className="sv-thr">
      <h2 className="sv-th" id="inicio-semana">
        Esta semana {sub && <span>{sub}</span>} <ExemploIlustrativo />
      </h2>
      {leg && <JaValeLegenda />}
    </div>
  );
}

/** "Esta semana": faixa de segunda a domingo da pauta lida. Só eventos públicos; as pessoas escolhidas ficam em "Em quem eu votei". */
export async function Semana({ overview, ufSigla, estadualLigado, hoje }: { overview: PautaOverview | null; ufSigla: string | null; estadualLigado: boolean; hoje: string }) {
  if (!overview || (!overview.reads.camara.readAt && !overview.reads.senado.readAt)) {
    return (
      <section className="sv-tl sv-tl--e sv-ge" aria-labelledby="inicio-semana">
        <Cabecalho leg={false} />
        <Lacuna>{overview ? "Ainda não temos esse dado." : "Não conseguimos ler a pauta agora. Tente de novo em alguns minutos."}</Lacuna>
        <Prova>Fonte: Câmara dos Deputados e Senado Federal (pauta). Pauta ainda não lida.</Prova>
      </section>
    );
  }

  const { dias, entries } = faixaDaSemana(overview, hoje);
  const porDia = new Map<string, PautaEntry[]>();
  for (const e of entries) {
    const k = dayKey(e.scheduledFor) as string;
    porDia.set(k, [...(porDia.get(k) ?? []), e]);
  }
  const amanha = addDays(hoje, 1);
  const visiveis = dias.filter((d) => d === hoje || d === amanha || porDia.has(d));
  const vazios = dias.filter((d) => !visiveis.includes(d));
  const hojeNaFaixa = dias.includes(hoje);
  const muda = await respostas(entries);
  const falhou = overview.reads.camara.failed + overview.reads.senado.failed > 0;
  const lido = overview.week.readAt;
  let vida = 0;
  let primeiro = true;

  return (
    <section className="sv-tl sv-tl--e sv-ge" aria-labelledby="inicio-semana">
      <Cabecalho sub={fmtRange(dias[0], dias[6])} />
      <ol className={`sv-s7${porDia.has(hoje) ? "" : " is-hoje-vazio"}`}>
        {visiveis.map((d) => {
          const itens = porDia.get(d) ?? [];
          const eHoje = d === hoje;
          const eAmanha = d === amanha;
          return (
            <li key={d} className={`sv-d${eHoje ? " sv-d--hoje" : ""}${eAmanha ? " sv-d--amanha" : ""}`}>
              <h3 className="sv-d__c">
                <span>{weekday(d)}</span> <span className="sv-d__n">{dayNum(d)}</span>
                {(eHoje || eAmanha) && <span className="sv-d__q">{eHoje ? "Hoje" : "Amanhã"}</span>}
              </h3>
              {itens.length === 0 && (
                <p className="sv-d__nada">
                  Nada marcado no Congresso{eHoje ? " para hoje" : eAmanha ? " para amanhã" : ""}.{falhou ? " A leitura foi incompleta." : ""}
                </p>
              )}
              {itens.map((e) => {
                const m = muda.get(e.key);
                const colorir = !!m && vida < MAX_VIDA;
                if (m && colorir) vida += 1;
                const eh1 = primeiro;
                primeiro = false;
                return (
                  <div key={`${e.key}-${e.scheduledFor}-${e.committee ?? ""}`} className={`sv-dec${eh1 ? " sv-dec--1" : ""}`}>
                    <p className="sv-esf">{esferaDe(e)}</p>
                    <p className="sv-dec__t">
                      <Link href={`/v2/decisao/${e.key}`}>
                        {tituloDe(e)} <span aria-hidden="true">→</span>
                      </Link>
                    </p>
                    <p className="sv-vale-l">
                      Já vale? <JaVale estado="ainda" />
                    </p>
                    {m ? (
                      <p className="sv-t">
                        {colorir ? <b className="sv-vida">O que muda:</b> : <b>O que muda:</b>} {m.claim.text}
                      </p>
                    ) : (
                      <p className="sv-t">
                        <span className="sv-conf">{AFIRMACAO.aguardando}.</span>
                      </p>
                    )}
                    {m && (
                      <>
                        <p className="sv-t">
                          “{m.claim.quote}”{m.claim.page > 0 ? ` (p. ${m.claim.page})` : ""}
                        </p>
                        <p className="sv-conf">{conferidoEm(m.reviewedAt)}.</p>
                      </>
                    )}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
      {!hojeNaFaixa && <p className="sv-resto">A última leitura da pauta é de uma semana que já passou. Os dias abaixo são os dessa leitura.</p>}
      {vazios.length > 0 && (
        <p className="sv-resto">
          {descreverDias(vazios, dias)}: nada marcado no Congresso.{falhou ? " A leitura foi incompleta: pode haver itens que não lemos." : ""}
        </p>
      )}
      {ufSigla && estadualLigado && (
        <Lacuna>
          <b>{casaEstadual(ufSigla)}:</b> a pauta da {casaEstadual(ufSigla)} não faz parte do que lemos hoje.
        </Lacuna>
      )}
      <Prova>Fonte: Câmara dos Deputados e Senado Federal (pauta), {lido ? `lida em ${fmtDateTime(lido)}` : "sem data de leitura registrada"}.</Prova>
    </section>
  );
}
