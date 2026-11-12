import type { Metadata } from "next";
import { cookies } from "next/headers";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FALHOU_LEITURA, SEM_DADO, conferidoEm } from "@/components/sv/estados";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { BODY_NAME, billLabel, clip, fmtDate, fmtDateTime, fmtWeekday } from "@/components/sv/fmt";
import { aguardaPosse, fraseDesde, mandatoPrincipal } from "@/components/sv/mandato";
import { placarDe } from "@/components/sv/placar";
import { COOKIE_TEXTO } from "@/components/sv/prefs";
import { reuniaoTexto, vigenciaDe } from "@/components/sv/vigencia";
import {
  Afirmacao,
  Etiqueta,
  Fonte,
  JaVale,
  JaValeLegenda,
  Lacuna,
  Nota,
  Pergunta,
  Placar,
  Proxima,
  Quadro,
  Resposta,
  Selo,
  VotoMarca,
} from "@/components/sv/ui";
import { data, type AnswerClaim, type Body, type PautaStatus, type VotingEventDetail } from "@/lib/data";
import { deciders } from "@/lib/pauta";

const KEY = /^[a-z0-9-]{3,80}$/;
// cache(): generateMetadata e a página leem a mesma proposta numa só ida ao banco por requisição
const load = cache((key: string) => (KEY.test(key) ? data.getPautaProposal(key) : Promise.resolve(null)));

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const p = await load((await params).key);
  return { title: p ? billLabel(p.entry) : "Decisão não encontrada" };
}

/** Tipo por extenso + sigla: "projeto de lei (PL)". A sigla nunca aparece sozinha na primeira ocorrência. */
const TIPO_EXTENSO: Record<string, string> = {
  PL: "projeto de lei",
  PLP: "projeto de lei complementar",
  PEC: "proposta de emenda à Constituição",
  MPV: "medida provisória",
  PLV: "projeto de lei de conversão",
  PDL: "projeto de decreto legislativo",
};
const identificacao = (e: { type: string; number: number; year: number }) => `${TIPO_EXTENSO[e.type] ?? "proposta"} (${e.type}) ${e.number}/${e.year}`;

function statusLinha(s: PautaStatus): string | null {
  switch (s.kind) {
    case "saiu":
      return `Saiu da pauta em ${fmtDate(s.at)}. A fonte não informa o motivo.`;
    case "reuniao_encerrada":
      return `A reunião de ${fmtDate(s.at)} foi encerrada. O resultado ainda não consta.`;
    case "reuniao_cancelada":
      return `A reunião de ${fmtDate(s.at)} foi cancelada.`;
    case "sem_leitura":
      return `Vista pela última vez na pauta em ${fmtDate(s.lastSeenAt)}.`;
    default:
      return null;
  }
}

/** Direção do dinheiro, em palavras (contrato: entra / sai / dividido). Só quando a afirmação foi conferida. */
const DIRECAO: Record<string, string> = {
  entra: "O governo passa a arrecadar.",
  sai: "O governo passa a gastar ou deixar de arrecadar.",
  dividido: "O dinheiro é repartido entre entes ou fundos.",
};

const temResposta = (c: AnswerClaim | undefined) => Boolean(c && c.state !== "nao_conferido");

// Esfera em palavra, sem estilo próprio. Quem não é parlamentar federal não vota esta proposta.
type Esfera = { nivel: "federal" | "estadual" | "municipal"; texto: string; casa: Body | null; naoVota: string | null };
function esferaDe(office: string): Esfera {
  switch (office) {
    case "deputado_federal":
      return { nivel: "federal", texto: "Esfera: Federal · Câmara dos Deputados", casa: "camara", naoVota: null };
    case "senador":
      return { nivel: "federal", texto: "Esfera: Federal · Senado Federal", casa: "senado", naoVota: null };
    case "presidente":
    case "vice_presidente":
      return { nivel: "federal", texto: "Esfera: Federal · Poder Executivo", casa: null, naoVota: "Não vota esta proposta: ela é votada no Congresso, em Brasília." };
    case "deputado_estadual":
      return { nivel: "estadual", texto: "Esfera: Estadual · Assembleia Legislativa", casa: null, naoVota: "Não vota esta proposta: ela é decidida em Brasília, não na Assembleia." };
    case "deputado_distrital":
      return { nivel: "estadual", texto: "Esfera: Estadual · Câmara Legislativa do Distrito Federal", casa: null, naoVota: "Não vota esta proposta: ela é decidida em Brasília, não na Câmara Legislativa." };
    case "governador":
    case "vice_governador":
      return { nivel: "estadual", texto: "Esfera: Estadual · Poder Executivo", casa: null, naoVota: "Não vota esta proposta: ela é decidida em Brasília, não no governo do estado." };
    case "vereador":
      return { nivel: "municipal", texto: "Esfera: Municipal · Câmara Municipal", casa: null, naoVota: "Não vota esta proposta: ela é decidida em Brasília, não na Câmara Municipal." };
    default:
      return { nivel: "municipal", texto: "Esfera: Municipal · Poder Executivo", casa: null, naoVota: "Não vota esta proposta: ela é decidida em Brasília, não na prefeitura." };
  }
}

/**
 * `falha`: a leitura desta pessoa (ou do mandato dela) falhou; vira lacuna só deste item. `posse`: eleito que ainda não
 * tomou posse. `semMandato`: lida, mas sem mandato carregado (não é falha: é lacuna do dado).
 */
type Escolhido = { slug: string; nome: string | null; cargo: string | null; esfera: Esfera | null; posse: string | null; falha: boolean; semMandato?: boolean };

/** Pessoas do cookie sv_sigo, em ordem alfabética (falhas de leitura no fim). Slug que não existe mais é ignorado. */
async function carregarEscolhidos(slugs: string[], falhar: boolean): Promise<Escolhido[]> {
  const rows = await Promise.all(
    slugs.map(async (slug): Promise<Escolhido | null> => {
      let r: Awaited<ReturnType<typeof data.getPerson>>;
      try {
        r = await lerOuFalhar(falhar, () => data.getPerson(slug));
      } catch {
        return { slug, nome: null, cargo: null, esfera: null, posse: null, falha: true };
      }
      if (!r) return null;
      let ms: Awaited<ReturnType<typeof data.getMandates>>;
      try {
        ms = await data.getMandates(r.person.id);
      } catch {
        return { slug: r.person.slug, nome: r.person.displayName, cargo: null, esfera: null, posse: null, falha: true };
      }
      const m = mandatoPrincipal(ms);
      if (!m) return { slug: r.person.slug, nome: r.person.displayName, cargo: null, esfera: null, posse: null, falha: false, semMandato: true };
      const posse = aguardaPosse(m) ? fraseDesde(m, r.person.gender === "f" ? true : r.person.gender === "m" ? false : null) : null;
      return { slug: r.person.slug, nome: r.person.displayName, cargo: m.officeName, esfera: esferaDe(m.office), posse, falha: false };
    }),
  );
  return rows
    .filter((r): r is Escolhido => r !== null)
    .sort((a, b) => (a.nome === null ? 1 : 0) - (b.nome === null ? 1 : 0) || (a.nome ?? a.slug).localeCompare(b.nome ?? b.slug, "pt-BR"));
}

/** O que a fonte diz do voto de uma pessoa numa votação. */
function votoNaVotacao(ev: VotingEventDetail, slug: string) {
  const v = ev.votes.find((x) => x.slug === slug);
  if (v) return <VotoMarca voto={v.value} />;
  if (ev.isSecret) return <>Votação secreta: a fonte não publica o voto de cada pessoa.</>;
  if (ev.openNoVotes) return <>A fonte não publicou o voto de cada pessoa nesta votação.</>;
  return <>Não consta o voto desta pessoa nesta votação.</>;
}

export default async function Decisao({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ simular?: string | string[] }> }) {
  const p = await load((await params).key);
  // `?simular=erro` só vale na demonstração (simular.ts): a leitura dos escolhidos falha
  const falhar = simulacao((await searchParams).simular) === "erro";
  if (!p) notFound();
  const e = p.entry;
  const a = p.answers;
  const campos = a?.fields ?? null;
  const follows = parseFollows((await cookies()).get(FOLLOW_COOKIE)?.value);

  // cada leitura que falha vira lacuna do próprio item, nunca erro da página; null = a leitura do conjunto falhou
  const [escolhidos, eventosRaw] = await Promise.all([
    carregarEscolhidos(follows, falhar).catch(() => null),
    Promise.all(p.votes.map((v) => data.getVotingEvent(v.id).catch(() => null))),
  ]);
  const eventos = p.votes.map((v, i) => ({ v, ev: eventosRaw[i] }));
  // Quem o leitor marcou nunca some, mesmo de esfera desligada nos Ajustes: a escolha explícita vale mais que o
  // interruptor de esfera (igual ao Início e a Escolhidos). Decisão declarada na PR #22.

  const id = identificacao(e);
  const onde = e.stage === "plenario" ? "plenário" : e.committee ? (/^comiss/i.test(e.committee) ? e.committee : `comissão ${e.committee}`) : "comissão";
  const reuniao = fmtWeekday(e.scheduledFor);
  const lida = p.readAt ? `lida em ${fmtDateTime(p.readAt)}` : "ainda não lida";
  const fontePauta = `${BODY_NAME[e.body]}, pauta, ${lida}`;
  const quem = deciders(e);
  const status = statusLinha(p.status);
  const aguardando = !a;
  const vig = vigenciaDe(e.type);
  const momento = reuniaoTexto(p.status, reuniao);
  // prova do quadro: só diz "conferido" quando o campo do quadro está em `diz`; o selo é da resposta publicada, não do campo
  const provaTexto = (c: AnswerClaim | undefined) =>
    !a ? `Texto oficial, ${BODY_NAME[e.body]}. Ainda sem resposta conferida.` : c?.state === "diz" ? `Texto oficial, ${BODY_NAME[e.body]}. ${conferidoEm(a.reviewedAt, a.verifiedBy)}.` : `Texto oficial, ${BODY_NAME[e.body]}.`;
  const casaDoEvento = (v: { id: string }, ev: VotingEventDetail | null) => ev?.body ?? (v.id.startsWith("senado") ? "senado" : "camara");

  const semConta = !temResposta(campos?.quem_paga) && !temResposta(campos?.dinheiro) && !temResposta(campos?.estimativa_impacto) && p.authors.length === 0;
  const dir = campos?.dinheiro.state === "diz" ? campos.dinheiro.direction : undefined;
  const casasVotos = [...new Set(eventos.map(({ v, ev }) => casaDoEvento(v, ev)))] as Body[];
  // o contrato traz a página e o total (Lista): truncado diz "N de M", nunca "as N mais recentes" sem o total
  const vt = p.votacoes;
  const totalVotacoes =
    vt.total === 0
      ? `Não lemos nenhuma votação desta proposta na ${BODY_NAME[e.body]}.`
      : vt.truncado
        ? `Mostrando as ${vt.itens.length} mais recentes de ${vt.total} votações que lemos desta proposta.`
        : vt.total === 1
          ? "Lemos 1 votação desta proposta."
          : `Lemos ${vt.total} votações desta proposta.`;

  return (
    <div className="sv-pg sv-pg--decisao">
      <div className="sv-folio sv-gh">
        <h1>O que estão decidindo que mexe comigo?</h1>
        <p className="sv-so-larga">
          {e.reason.theme ? `${e.reason.theme} · ` : ""}
          {id} · {reuniao}
        </p>
      </div>

      <Quadro
        id="sv-d1"
        variante="fio"
        numero={1}
        pergunta="O que é isso?"
        className="sv-ga"
        prova={
          <>
            {id} · {p.readAt ? `lida em ${fmtDateTime(p.readAt)}` : "pauta ainda não lida"}. <ExemploIlustrativo />
          </>
        }
      >
        <Afirmacao claim={campos?.o_que_propoe ?? null} conferidaEm={a?.reviewedAt ?? null} conferidaPor={a?.verifiedBy} tamanho="m" />
        <p className="sv-t">
          <b>Onde se decide?</b> Federal · {BODY_NAME[e.body]} · {onde}. {momento.frase}
        </p>
      </Quadro>

      <Quadro id="sv-d2" numero={2} pergunta="Já vale?" className="sv-gb" prova={`Fonte: ${fontePauta}.`}>
        <Resposta tamanho="xl">
          <JaVale estado={vig.estado} frase={vig.frase} />
        </Resposta>
        <p className="sv-t">{vig.explicacao}</p>
        {status && <p className="sv-t">{status}</p>}
        <JaValeLegenda />
      </Quadro>

      <Quadro id="sv-d3" variante="dom" numero={3} vida pergunta="O que muda para mim?" className="sv-gc" prova={provaTexto(campos?.o_que_muda)}>
        <div className="sv-hs">
          <div className="sv-hs__m sv-hs__m--hoje">
            <h3 className="sv-hs__t">Hoje</h3>
            <Lacuna motivo="Falta uma resposta conferida para este ponto.">Ainda não conseguimos conferir como é hoje.</Lacuna>
          </div>
          <div className="sv-hs__m sv-hs__m--se">
            <div className="sv-hs__liso">
              <h3 className="sv-hs__t">Se aprovado</h3>
              <p className="sv-tipo">Do texto oficial</p>
              <Afirmacao claim={campos?.o_que_muda ?? null} conferidaEm={a?.reviewedAt ?? null} conferidaPor={a?.verifiedBy} tamanho="fala" />
            </div>
          </div>
        </div>
        <Nota>Cada resposta tem um de três estados: conferida, ainda não conferida ou “o texto oficial não trata disso”.</Nota>
        {a?.correction && (
          <Nota>
            Corrigido em {fmtDate(a.correction.correctedAt)}: {a.correction.note} <Link href="/v2/como-funciona#correcoes">Ver todas as correções</Link>
          </Nota>
        )}
      </Quadro>

      <Quadro id="sv-d4" variante="fio" numero={4} pergunta="Quem decide agora?" className="sv-gd" prova={`Fonte: ${fontePauta}.`}>
        <Resposta>{quem.who}</Resposta>
        <p className="sv-t">{quem.needs}</p>
        <p className="sv-t">{momento.frase}</p>
        {e.rapporteur && <p className="sv-t">Relator, que sugere a versão final: {e.rapporteur}.</p>}
        <p className="sv-t">Leis estaduais e municipais sobre o mesmo assunto são outras decisões. Esta é só a federal.</p>
      </Quadro>

      <Quadro id="sv-d5" variante="fio" numero={5} pergunta="Quem é afetado?" className="sv-ge" prova={provaTexto(campos?.quem_recebe)}>
        <Afirmacao claim={campos?.quem_recebe ?? null} conferidaEm={a?.reviewedAt ?? null} conferidaPor={a?.verifiedBy} tamanho="m" />
      </Quadro>

      <Quadro id="sv-d6" variante={semConta ? "lacuna" : "padrao"} rotulo="Dinheiro, quem paga e autoria" className="sv-gf" prova={p.readAt ? `Leitura das fontes: ${fmtDateTime(p.readAt)}.` : "Fontes ainda não lidas."}>
        <div className="sv-nc__l">
          <Pergunta id="sv-d6a">Quanto muda na conta?</Pergunta>
          <div className="sv-nc__r">
            <p className="sv-tipo">Dinheiro envolvido</p>
            <Afirmacao claim={campos?.dinheiro ?? null} conferidaEm={a?.reviewedAt ?? null} conferidaPor={a?.verifiedBy} tamanho="r" />
            {dir && DIRECAO[dir] && <p className="sv-t">Direção do dinheiro: {DIRECAO[dir]}</p>}
            <p className="sv-tipo sv-nc__s">Estimativa de impacto</p>
            <Afirmacao claim={campos?.estimativa_impacto ?? null} conferidaEm={a?.reviewedAt ?? null} conferidaPor={a?.verifiedBy} tamanho="r" />
          </div>
          <Fonte>Fonte: texto oficial, {BODY_NAME[e.body]}.</Fonte>
        </div>
        <div className="sv-nc__l">
          <Pergunta id="sv-d6b">Quem paga?</Pergunta>
          <div className="sv-nc__r">
            <Afirmacao claim={campos?.quem_paga ?? null} conferidaEm={a?.reviewedAt ?? null} conferidaPor={a?.verifiedBy} tamanho="r" />
          </div>
          <Fonte>Fonte: texto oficial, {BODY_NAME[e.body]}.</Fonte>
        </div>
        <div className="sv-nc__l">
          <Pergunta id="sv-d6c">Quem propôs?</Pergunta>
          <div className="sv-nc__r">
            {p.authors.length === 0 ? (
              <Lacuna>{SEM_DADO}</Lacuna>
            ) : (
              <ul className="sv-aut">
                {p.authors.map((au) => (
                  <li key={au.slug}>
                    <Link href={`/v2/pessoa/${au.slug}`}>{au.name}</Link> <span className="sv-esf">{au.role === "principal" ? "autoria principal" : "coautoria"}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.autores.truncado && (
              <Nota>
                Mostrando {p.autores.itens.length} de {p.autores.total} autores que lemos: autoria principal primeiro, depois em ordem alfabética.
              </Nota>
            )}
          </div>
          <Fonte>Fonte: {BODY_NAME[e.body]}, ficha da proposta.</Fonte>
        </div>
      </Quadro>

      <Quadro id="sv-d7" variante="fio" numero={6} pergunta="Onde está?" className="sv-gj" prova={`Fonte: ${fontePauta}.`}>
        <Resposta>{momento.presente ? (e.stage === "plenario" ? "No plenário." : "Na comissão.") : `Última pauta em que apareceu: ${e.stage === "plenario" ? "plenário" : "comissão"}.`}</Resposta>
        <ol className="sv-etapas">
          <li>
            <b>Feito:</b> a proposta foi apresentada{p.presentedOn ? ` em ${fmtDate(p.presentedOn)}` : ""}.
          </li>
          <li className="sv-aqui">
            <b>{momento.presente ? "Está aqui:" : "Esteve aqui:"}</b> {onde}, na {BODY_NAME[e.body]}. {momento.frase}
          </li>
          <li>
            <b>Falta:</b> {vig.falta}
          </li>
        </ol>
        <p className="sv-volta">
          <svg viewBox="0 0 44 28" aria-hidden="true">
            <path d="M40 24C40 4 9 4 9 15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="5 4" />
            <polygon points="9,26 3,15 15,15" fill="currentColor" />
          </svg>
          Uma proposta pode voltar etapas.
        </p>
      </Quadro>

      <Quadro
        id="sv-d8"
        variante="fio"
        numero={7}
        pergunta="Como votou quem eu elegi?"
        className="sv-gk"
        prova={p.votes.length > 0 ? `Fonte: ${casasVotos.map((c) => BODY_NAME[c]).join(" e ")}, votação nominal, ${lida}.` : `Fonte: ${fontePauta}.`}
      >
        <Resposta>{totalVotacoes}</Resposta>

        {escolhidos === null ? (
          <Lacuna motivo="A leitura das pessoas que você marcou falhou.">{FALHOU_LEITURA}</Lacuna>
        ) : escolhidos.length === 0 && follows.length > 0 ? (
          <Lacuna>Não encontramos nos dados as pessoas que você marcou.</Lacuna>
        ) : escolhidos.length === 0 ? (
          <>
            <p className="sv-t">Você ainda não escolheu ninguém.</p>
            <p className="sv-t">
              <Link className="sv-lk" href="/v2/pessoas">
                Escolher em quem eu votei <span aria-hidden="true">→</span>
              </Link>
            </p>
          </>
        ) : (
          <>
            <ul className="sv-pes">
              {escolhidos.map((x) => {
                if (x.semMandato)
                  return (
                    <li key={x.slug}>
                      <b>
                        <Link href={`/v2/pessoa/${x.slug}`}>{x.nome}</Link>
                      </b>
                      <span className="sv-pes__v">Não temos o mandato desta pessoa carregado: não dá para dizer se ela vota esta proposta.</span>
                    </li>
                  );
                if (x.falha || !x.esfera)
                  return (
                    <li key={x.slug}>
                      <b>
                        <Link href={`/v2/pessoa/${x.slug}`}>{x.nome ?? "Pessoa que você escolheu"}</Link>
                      </b>
                      <span className="sv-pes__v">Não conseguimos ler os dados desta pessoa agora.</span>
                    </li>
                  );
                const casa = x.esfera.casa;
                // só votações cujo detalhe foi lido, na Casa da pessoa; detalhe que falhou não vira "não consta o voto"
                const dela = casa ? eventos.filter(({ v, ev }) => ev && casaDoEvento(v, ev) === casa) : [];
                return (
                  <li key={x.slug}>
                    <b>
                      <Link href={`/v2/pessoa/${x.slug}`}>{x.nome}</Link>, {x.cargo}
                    </b>
                    <span className="sv-esf">{x.esfera.texto}</span>
                    {x.esfera.naoVota ? (
                      <span className="sv-pes__v">{x.esfera.naoVota}</span>
                    ) : x.posse ? (
                      <span className="sv-pes__v">{`${x.posse.charAt(0).toUpperCase()}${x.posse.slice(1)}: ainda não votou no cargo.`}</span>
                    ) : dela.length === 0 || !casa ? (
                      <span className="sv-pes__v">Não lemos votação desta proposta na {BODY_NAME[casa ?? e.body]}.</span>
                    ) : (
                      dela.map(({ v, ev }) => (
                        <span className="sv-pes__v" key={v.id}>
                          {ev && votoNaVotacao(ev, x.slug)} · votação de {fmtDate(v.occurredAt)}
                        </span>
                      ))
                    )}
                  </li>
                );
              })}
            </ul>
            <Nota>Pessoas em ordem alfabética. Aparece mais texto em quem tem dado publicado. {COOKIE_TEXTO}</Nota>
          </>
        )}

        {eventos.map(({ v, ev }) => {
          const titulo = `${billLabel(e)}, votação de ${fmtDate(v.occurredAt)}`;
          const pl = ev ? placarDe(ev) : null;
          const fonteVt = `${BODY_NAME[casaDoEvento(v, ev)]}, votação nominal`;
          const resumoVazio = v.yes === null && v.no === null ? true : (v.yes ?? 0) + (v.no ?? 0) === 0;
          return (
            <div className="sv-vt" key={v.id}>
              <h3 className="sv-sub">
                <Link href={`/v2/votacao/${v.id}`}>{clip(v.description, 150)}</Link>
              </h3>
              <p className="sv-t">
                Votação de {fmtDate(v.occurredAt)}
                {v.result ? `. Resultado: ${v.result}` : ""}.
              </p>
              {pl?.kind === "placar" ? (
                <>
                  <Placar titulo={titulo} sim={pl.sim} nao={pl.nao} abs={pl.abs} sem={pl.sem} total={pl.total} />
                  {pl.obstrucao > 0 && <p className="sv-nota">Obstrução: {pl.obstrucao}. É um registro próprio da Casa e não entra nas quatro linhas acima.</p>}
                </>
              ) : pl?.kind === "lacuna" ? (
                pl.motivo ? (
                  <Lacuna>{pl.motivo}</Lacuna>
                ) : (
                  <>
                    <Lacuna>{SEM_DADO}</Lacuna>
                    <Fonte>Fonte: {fonteVt}.</Fonte>
                  </>
                )
              ) : resumoVazio ? (
                <>
                  <Lacuna motivo="Não conseguimos ler o detalhe desta votação agora.">{SEM_DADO}</Lacuna>
                  <Fonte>Fonte: {fonteVt}.</Fonte>
                </>
              ) : (
                <Placar titulo={titulo} sim={v.yes} nao={v.no} abs={null} sem={null} />
              )}
            </div>
          );
        })}
        {eventos.length > 0 && <Nota>Sem voto soma quem não registrou voto e quem presidia a sessão. Não é voto contra. A ordem é fixa: Sim, Não, Abstenção, Sem voto.</Nota>}
      </Quadro>

      <Quadro
        id="sv-d9"
        variante="fio"
        numero={8}
        pergunta="Onde eu confiro?"
        className="sv-gl"
        prova={
          <>
            {id}. Fonte: texto oficial, {fontePauta}.
          </>
        }
      >
        {a?.sourceUrl || p.fichaUrl ? (
          <Resposta>
            {a?.sourceUrl && (
              <a href={a.sourceUrl} rel="noopener noreferrer">
                Texto oficial na {BODY_NAME[e.body]} <span aria-hidden="true">→</span>
              </a>
            )}
            {p.fichaUrl && (
              <a href={p.fichaUrl} rel="noopener noreferrer">
                {a?.sourceUrl ? "Ficha e tramitação" : `Texto oficial e tramitação na ${BODY_NAME[e.body]}`} <span aria-hidden="true">→</span>
              </a>
            )}
          </Resposta>
        ) : (
          <>
            <Lacuna>O endereço do texto oficial ainda não foi carregado.</Lacuna>
            <Fonte>Fonte: {BODY_NAME[e.body]}.</Fonte>
          </>
        )}
        {e.summary && (
          <details>
            <summary>Ler o resumo oficial (ementa), na linguagem da lei</summary>
            <p className="sv-t">{e.summary}</p>
          </details>
        )}
        <Nota>
          Por que esta proposta está aqui: {e.reason.theme ? `a Casa a classificou em “${e.reason.theme}” e ` : ""}o resumo oficial cita “{e.reason.term}”. <Link href="/v2/como-funciona#regras">Ver a regra</Link>
        </Nota>
        {aguardando && (
          <Nota>
            <Etiqueta>Aguardando conferência</Etiqueta> As respostas desta página só aparecem depois de conferidas com o texto oficial.
          </Nota>
        )}
      </Quadro>

      <Selo id="sv-d10" numero={9} lidoEm={p.readAt} resposta={a ? { em: a.reviewedAt, por: a.verifiedBy } : null} className="sv-gs" />

      <Proxima href="/v2/temas" pergunta="O que está em jogo no Congresso?" className="sv-gn" />
    </div>
  );
}
