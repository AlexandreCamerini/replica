import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { SEM_DADO } from "@/components/sv/estados";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { BODY_NAME, billLabel, clip, fmtDate, fmtDateTime, fmtWeekday } from "@/components/sv/fmt";
import { COOKIE_TEXTO, readPrefs } from "@/components/sv/prefs";
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
import { data, type AnswerClaim, type Body, type PautaStatus, type VoteValue, type VotingEventDetail } from "@/lib/data";
import { deciders } from "@/lib/pauta";

const KEY = /^[a-z0-9-]{3,80}$/;
const load = (key: string) => (KEY.test(key) ? data.getPautaProposal(key) : Promise.resolve(null));

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

type Escolhido = { slug: string; nome: string; cargo: string; esfera: Esfera };

/** Pessoas do cookie sv_sigo, em ordem alfabética. Slug que não existe mais é ignorado. */
async function carregarEscolhidos(slugs: string[]): Promise<Escolhido[]> {
  const rows = await Promise.all(
    slugs.map(async (slug) => {
      const r = await data.getPerson(slug);
      if (!r) return null;
      const ms = await data.getMandates(r.person.id);
      const m = ms.find((x) => x.status === "em_exercicio") ?? ms[0] ?? null;
      if (!m) return null;
      return { slug: r.person.slug, nome: r.person.displayName, cargo: m.officeName, esfera: esferaDe(m.office) } satisfies Escolhido;
    }),
  );
  return rows.filter((r): r is Escolhido => r !== null).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Obstrução é ato deliberado: não entra em "Sem voto"; sai numa nota própria, como no Início.
const SEM_VOTO_DE: VoteValue[] = ["nao_votou", "art17"];
const semVoto = (c: Record<VoteValue, number>) => SEM_VOTO_DE.reduce((s, v) => s + (c[v] ?? 0), 0);

/** O que a fonte diz do voto de uma pessoa numa votação. */
function votoNaVotacao(ev: VotingEventDetail, slug: string) {
  const v = ev.votes.find((x) => x.slug === slug);
  if (v) return <VotoMarca voto={v.value} />;
  if (ev.isSecret) return <>Votação secreta: a fonte não publica o voto de cada pessoa.</>;
  if (ev.openNoVotes) return <>A fonte não publicou o voto de cada pessoa nesta votação.</>;
  return <>Não consta o voto desta pessoa nesta votação.</>;
}

export default async function Decisao({ params }: { params: Promise<{ key: string }> }) {
  const p = await load((await params).key);
  if (!p) notFound();
  const e = p.entry;
  const a = p.answers;
  const campos = a?.fields ?? null;
  const prefs = await readPrefs();
  const follows = parseFollows((await cookies()).get(FOLLOW_COOKIE)?.value);

  const [escolhidosTodos, eventosRaw] = await Promise.all([carregarEscolhidos(follows), Promise.all(p.votes.map((v) => data.getVotingEvent(v.id)))]);
  const eventos = p.votes.map((v, i) => ({ v, ev: eventosRaw[i] }));
  // Esferas ligadas nos Ajustes: federal sempre; estadual e municipal só se ligadas. As desligadas ficam de fora, com aviso.
  const escolhidos = escolhidosTodos.filter((x) => x.esfera.nivel === "federal" || (x.esfera.nivel === "estadual" ? prefs.esferas.estadual : prefs.esferas.municipal));
  const ocultos = escolhidosTodos.length - escolhidos.length;

  const id = identificacao(e);
  const onde = e.stage === "plenario" ? "plenário" : e.committee ? (/^comiss/i.test(e.committee) ? e.committee : `comissão ${e.committee}`) : "comissão";
  const reuniao = fmtWeekday(e.scheduledFor);
  const lida = p.readAt ? `lida em ${fmtDateTime(p.readAt)}` : "ainda não lida";
  const fontePauta = `${BODY_NAME[e.body]}, pauta, ${lida}`;
  const quem = deciders(e);
  const status = statusLinha(p.status);
  const aguardando = !a;

  const semConta = !temResposta(campos?.quem_paga) && !temResposta(campos?.dinheiro) && !temResposta(campos?.estimativa_impacto) && p.authors.length === 0;
  const dir = campos?.dinheiro.state === "diz" ? campos.dinheiro.direction : undefined;
  const casasVotos = [...new Set(eventos.map(({ v, ev }) => ev?.body ?? (v.id.startsWith("senado") ? "senado" : "camara")))] as Body[];

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
        <Afirmacao claim={campos?.o_que_propoe ?? null} conferidaEm={a?.reviewedAt ?? null} tamanho="m" />
        <p className="sv-t">
          <b>Onde se decide?</b> Federal · {BODY_NAME[e.body]} · {onde}. Reunião {reuniao}.
        </p>
      </Quadro>

      <Quadro id="sv-d2" numero={2} pergunta="Já vale?" className="sv-gb" prova={`Fonte: ${fontePauta}.`}>
        <Resposta tamanho="xl">
          <JaVale estado="ainda" />
        </Resposta>
        <p className="sv-t">É uma proposta. Ainda não é lei.</p>
        {status && <p className="sv-t">{status}</p>}
        <JaValeLegenda />
      </Quadro>

      <Quadro id="sv-d3" variante="dom" numero={3} vida pergunta="O que muda para mim?" className="sv-gc" prova={a ? `Texto oficial, ${BODY_NAME[e.body]}. Conferido por agentes de IA em ${fmtDate(a.reviewedAt)}.` : `Texto oficial, ${BODY_NAME[e.body]}. Ainda sem resposta conferida.`}>
        <div className="sv-hs">
          <div className="sv-hs__m sv-hs__m--hoje">
            <h3 className="sv-hs__t">Hoje</h3>
            <Lacuna motivo="Falta uma resposta conferida para este ponto.">Ainda não conseguimos conferir como é hoje.</Lacuna>
          </div>
          <div className="sv-hs__m sv-hs__m--se">
            <div className="sv-hs__liso">
              <h3 className="sv-hs__t">Se aprovado</h3>
              <p className="sv-tipo">Do texto oficial</p>
              <Afirmacao claim={campos?.o_que_muda ?? null} conferidaEm={a?.reviewedAt ?? null} tamanho="fala" />
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
        <p className="sv-t">A reunião é {reuniao}.</p>
        {e.rapporteur && <p className="sv-t">Relator, que sugere a versão final: {e.rapporteur}.</p>}
        <p className="sv-t">Leis estaduais e municipais sobre o mesmo assunto são outras decisões. Esta é só a federal.</p>
      </Quadro>

      <Quadro id="sv-d5" variante="fio" numero={5} pergunta="Quem é afetado?" className="sv-ge" prova={a ? `Texto oficial, ${BODY_NAME[e.body]}. Conferido por agentes de IA em ${fmtDate(a.reviewedAt)}.` : `Texto oficial, ${BODY_NAME[e.body]}.`}>
        <Afirmacao claim={campos?.quem_recebe ?? null} conferidaEm={a?.reviewedAt ?? null} tamanho="m" />
      </Quadro>

      <Quadro id="sv-d6" variante={semConta ? "lacuna" : "padrao"} rotulo="Dinheiro, quem paga e autoria" className="sv-gf" prova={p.readAt ? `Leitura das fontes: ${fmtDateTime(p.readAt)}.` : "Fontes ainda não lidas."}>
        <div className="sv-nc__l">
          <Pergunta id="sv-d6a">Quanto muda na conta?</Pergunta>
          <div className="sv-nc__r">
            <p className="sv-tipo">Dinheiro envolvido</p>
            <Afirmacao claim={campos?.dinheiro ?? null} conferidaEm={a?.reviewedAt ?? null} tamanho="r" />
            {dir && DIRECAO[dir] && <p className="sv-t">Direção do dinheiro: {DIRECAO[dir]}</p>}
            <p className="sv-tipo sv-nc__s">Estimativa de impacto</p>
            <Afirmacao claim={campos?.estimativa_impacto ?? null} conferidaEm={a?.reviewedAt ?? null} tamanho="r" />
          </div>
          <Fonte>Fonte: texto oficial, {BODY_NAME[e.body]}.</Fonte>
        </div>
        <div className="sv-nc__l">
          <Pergunta id="sv-d6b">Quem paga?</Pergunta>
          <div className="sv-nc__r">
            <Afirmacao claim={campos?.quem_paga ?? null} conferidaEm={a?.reviewedAt ?? null} tamanho="r" />
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
          </div>
          <Fonte>Fonte: {BODY_NAME[e.body]}, ficha da proposta.</Fonte>
        </div>
      </Quadro>

      <Quadro id="sv-d7" variante="fio" numero={6} pergunta="Onde está?" className="sv-gj" prova={`Fonte: ${fontePauta}.`}>
        <Resposta>{e.stage === "plenario" ? "No plenário." : "Na comissão."}</Resposta>
        <ol className="sv-etapas">
          <li>
            <b>Feito:</b> a proposta foi apresentada{p.presentedOn ? ` em ${fmtDate(p.presentedOn)}` : ""}.
          </li>
          <li className="sv-aqui">
            <b>Está aqui:</b> {onde}, na {BODY_NAME[e.body]}. Reunião {reuniao}.
          </li>
          <li>
            <b>Falta:</b> {e.stage === "comissao" ? "votação no plenário, depois " : ""}a outra Casa do Congresso, depois a assinatura do presidente (sanção). Só então vale.
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
        <Resposta>{p.votes.length === 0 ? "Ainda não houve votação." : p.votes.length === 1 ? "Houve 1 votação desta proposta." : `Houve ${p.votes.length} votações desta proposta.`}</Resposta>

        {escolhidos.length === 0 ? (
          <>
            <p className="sv-t">{escolhidosTodos.length > 0 ? "As pessoas que você escolheu estão em esferas desligadas nos Ajustes." : "Você ainda não escolheu ninguém."}</p>
            <p className="sv-t">
              <Link className="sv-lk" href={escolhidosTodos.length > 0 ? "/v2/ajustes" : "/v2/pessoas"}>
                {escolhidosTodos.length > 0 ? "Ligar as esferas nos Ajustes" : "Escolher em quem eu votei"} <span aria-hidden="true">→</span>
              </Link>
            </p>
          </>
        ) : (
          <>
            <ul className="sv-pes">
              {escolhidos.map((x) => {
                const dela = x.esfera.casa ? eventos.filter(({ ev }) => ev?.body === x.esfera.casa) : [];
                return (
                  <li key={x.slug}>
                    <b>
                      <Link href={`/v2/pessoa/${x.slug}`}>{x.nome}</Link>, {x.cargo}
                    </b>
                    <span className="sv-esf">{x.esfera.texto}</span>
                    {x.esfera.naoVota ? (
                      <span className="sv-pes__v">{x.esfera.naoVota}</span>
                    ) : dela.length === 0 ? (
                      <span className="sv-pes__v">Ainda não houve votação.</span>
                    ) : (
                      dela.map(({ v, ev }) => (
                        <span className="sv-pes__v" key={v.id}>
                          {ev ? votoNaVotacao(ev, x.slug) : <>Não consta o voto desta pessoa nesta votação.</>} · votação de {fmtDate(v.occurredAt)}
                        </span>
                      ))
                    )}
                  </li>
                );
              })}
            </ul>
            <Nota>Pessoas em ordem alfabética. Aparece mais texto em quem tem dado publicado. {COOKIE_TEXTO}</Nota>
            {ocultos > 0 && <Nota>{ocultos === 1 ? "1 pessoa que você escolheu não aparece" : `${ocultos} pessoas que você escolheu não aparecem`}: a esfera dela está desligada nos Ajustes.</Nota>}
          </>
        )}

        {eventos.map(({ v, ev }) => {
          const titulo = `${billLabel(e)}, votação de ${fmtDate(v.occurredAt)}`;
          const c = ev?.counts;
          return (
            <div className="sv-vt" key={v.id}>
              <h3 className="sv-sub">
                <Link href={`/v2/votacao/${v.id}`}>{clip(v.description, 150)}</Link>
              </h3>
              <p className="sv-t">
                Votação de {fmtDate(v.occurredAt)}
                {v.result ? `. Resultado: ${v.result}` : ""}.
              </p>
              {c ? (
                <>
                  <Placar titulo={titulo} sim={c.sim} nao={c.nao} abs={c.abstencao} sem={semVoto(c)} total={Object.values(c).reduce((s, n) => s + n, 0)} />
                  {c.obstrucao > 0 && <p className="sv-nota">Obstrução: {c.obstrucao}. É um registro próprio da Casa e não entra nas quatro linhas acima.</p>}
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

      <Selo id="sv-d10" numero={9} lidoEm={p.readAt} className="sv-gs" />

      <Proxima href="/v2/temas" pergunta="O que está em jogo no Congresso?" className="sv-gn" />
    </div>
  );
}
