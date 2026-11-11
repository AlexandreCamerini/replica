import Link from "next/link";
import { BODY_NAME, billLabel, clip, fmtDateTime } from "@/components/sv/fmt";
import { AFIRMACAO, conferidoEm, fraseSemAfirmacao } from "@/components/sv/estados";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { JaVale, JaValeLegenda, Lacuna, Nota, Prova } from "@/components/sv/ui";
import { vigenciaDe } from "@/components/sv/vigencia";
import { data, type AnswerClaim, type PautaEntry, type PautaOverview, type VerifiedBy } from "@/lib/data";
import { casaEstadual } from "./lemos";
import { FRASE_RESPOSTA, estadoResposta, type LeituraResposta } from "./semana-resposta";
import { addDays, dayKey, dayNum, fmtRange, mondayOf, weekday } from "./datas";

const MAX_RESPOSTAS = 6; // no máximo 6 leituras de respostas: só os primeiros itens exibidos que têm resposta publicada
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

type Muda = { claim: AnswerClaim; reviewedAt: string; verifiedBy: VerifiedBy };

/**
 * "o que muda" só dos itens exibidos que têm respostas publicadas (`reviewedAt`), e só dos primeiros MAX_RESPOSTAS: cada
 * `getPautaProposal` custa várias consultas. Item com resposta e sem leitura (acima do limite) leva à página da decisão;
 * leitura que falhou é dita como falha (`ok: false`); só item sem `reviewedAt` diz "Aguardando conferência."
 * `falhar`: simulação de falha de leitura (só na demonstração, `?simular=erro`).
 */
async function respostas(entries: PautaEntry[], falhar: boolean): Promise<Map<string, LeituraResposta<Muda>>> {
  const keys = [...new Set(entries.filter((e) => e.reviewedAt).map((e) => e.key))].slice(0, MAX_RESPOSTAS);
  const out = new Map<string, LeituraResposta<Muda>>();
  await Promise.all(
    keys.map(async (k) => {
      try {
        if (falhar) throw new Error("falha simulada (demonstração)");
        const p = await data.getPautaProposal(k);
        const claim = p?.answers?.fields.o_que_muda;
        // resposta publicada com "o que muda" fora de `diz` também entra: a tela diz que o campo não foi conferido
        out.set(k, { ok: true, muda: p?.answers && claim ? { claim, reviewedAt: p.answers.reviewedAt, verifiedBy: p.answers.verifiedBy } : null });
      } catch {
        out.set(k, { ok: false });
      }
    }),
  );
  return out;
}

/** Casas cuja pauta ainda não foi lida (`readAt` null), já com a preposição: "da Câmara dos Deputados". Delas não se diz "nada marcado". */
export function casasSemLeitura(o: PautaOverview): string[] {
  return [!o.reads.camara.readAt && `da ${BODY_NAME.camara}`, !o.reads.senado.readAt && `do ${BODY_NAME.senado}`].filter((x): x is string => !!x);
}

/** Nota única por bloco: a pauta mostrada é a filtrada pela regra, não a inteira. */
export function NotaRegra() {
  return (
    <Nota>
      Acompanhamos só as propostas que entram na nossa regra de seleção, não a pauta inteira.{" "}
      <Link className="sv-lk" href="/v2/como-funciona">
        Ver a regra
      </Link>
    </Nota>
  );
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
export async function Semana({
  overview,
  ufSigla,
  estadualLigado,
  hoje,
  simularFalha = false,
}: {
  overview: PautaOverview | null;
  ufSigla: string | null;
  estadualLigado: boolean;
  hoje: string;
  /** só na demonstração (`?simular=erro`): a leitura das respostas falha */
  simularFalha?: boolean;
}) {
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
  const muda = await respostas(entries, simularFalha);
  const falhou = overview.reads.camara.failed + overview.reads.senado.failed > 0;
  const lido = overview.week.readAt;
  const naoLidas = casasSemLeitura(overview);
  // com uma Casa sem leitura, "nada marcado" só pode falar da Casa lida
  const ondeLido = naoLidas.length === 1 ? (overview.reads.camara.readAt ? `na ${BODY_NAME.camara}` : `no ${BODY_NAME.senado}`) : "no Congresso";
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
                  Nada do que acompanhamos está marcado {ondeLido}{eHoje ? " para hoje" : eAmanha ? " para amanhã" : ""}.{falhou ? " A leitura foi incompleta." : ""}
                </p>
              )}
              {itens.map((e) => {
                const leitura = muda.get(e.key);
                const estado = estadoResposta(e.reviewedAt, leitura);
                const lida = leitura?.ok ? leitura.muda : null;
                const m = lida && lida.claim.state === "diz" && lida.claim.says ? lida : null;
                const vig = vigenciaDe(e.type);
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
                      Já vale? <JaVale estado={vig.estado} frase={vig.frase} />
                    </p>
                    {m ? (
                      <p className="sv-t">
                        {colorir ? <b className="sv-vida">O que muda:</b> : <b>O que muda:</b>} {m.claim.text}
                      </p>
                    ) : (
                      <p className="sv-t">
                        {estado === "aguardando" ? (
                          <span className="sv-conf">{AFIRMACAO.aguardando}.</span>
                        ) : estado === "falhou" ? (
                          <span className="sv-conf">{FRASE_RESPOSTA.falhou}</span>
                        ) : estado === "na_pagina" || !lida ? (
                          <Link className="sv-lk" href={`/v2/decisao/${e.key}`}>
                            {FRASE_RESPOSTA.naPagina}
                            <span className="sv-vh"> sobre {billLabel(e)}</span> <span aria-hidden="true">→</span>
                          </Link>
                        ) : (
                          <span className="sv-conf">{fraseSemAfirmacao(lida.claim.state)}</span>
                        )}
                      </p>
                    )}
                    {m && (
                      <>
                        <p className="sv-t">
                          “{m.claim.quote}”{m.claim.page > 0 ? ` (p. ${m.claim.page})` : ""}
                        </p>
                        <p className="sv-conf">{conferidoEm(m.reviewedAt, m.verifiedBy)}.</p>
                      </>
                    )}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
      {naoLidas.length === 1 && <p className="sv-resto">A pauta {naoLidas[0]} ainda não foi lida: os dias acima não incluem essa Casa.</p>}
      {!hojeNaFaixa && <p className="sv-resto">A última leitura da pauta é de uma semana que já passou. Os dias abaixo são os dessa leitura.</p>}
      {vazios.length > 0 && (
        <p className="sv-resto">
          {descreverDias(vazios, dias)}: nada do que acompanhamos está marcado {ondeLido}.{falhou ? " A leitura foi incompleta: pode haver itens que não lemos." : ""}
        </p>
      )}
      {ufSigla && estadualLigado && (
        <Lacuna>
          <b>{casaEstadual(ufSigla)}:</b> a pauta da {casaEstadual(ufSigla)} não faz parte do que lemos hoje.
        </Lacuna>
      )}
      <NotaRegra />
      <Prova>Fonte: Câmara dos Deputados e Senado Federal (pauta), {lido ? `lida em ${fmtDateTime(lido)}` : "sem data de leitura registrada"}.</Prova>
    </section>
  );
}
