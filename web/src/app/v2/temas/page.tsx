import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { BODY_NAME, billLabel, clip, fmtDate, fmtDateTime, fmtInt, fmtWeekday } from "@/components/sv/fmt";
import { NotaRegra } from "@/components/sv/inicio/semana";
import { aguardaPosse, casaDoMandato, fraseDesde, mandatoPrincipal, motivoPosse } from "@/components/sv/mandato";
import { readPrefs } from "@/components/sv/prefs";
import { vigenciaDe } from "@/components/sv/vigencia";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { loadThemes } from "@/components/sv/temas";
import { Cobertura, JaVale, JaValeLegenda, Lacuna, Nota, Proxima, Quadro, Resposta, Selo, VotoMarca } from "@/components/sv/ui";
import { data, type OfficeSlug, type PautaEntry, type PautaOverview } from "@/lib/data";
import { deciders, isUrgent, ofBody, reasonText, typeName, uniqueByKey } from "@/lib/pauta";

export const metadata: Metadata = { title: "O que está em jogo no Congresso?" };

const ptSort = (a: string, b: string) => a.localeCompare(b, "pt-BR");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${fmtInt(n)} ${varios}`);
const FONTE_PAUTA = "Câmara dos Deputados e Senado Federal (pauta e votos)";

/** Esfera em palavra, a partir do cargo do mandato. Sem estilo próprio. */
function esferaDe(m: { office: string; placeLabel: string } | null): string {
  if (!m) return "Ainda não temos esse dado.";
  switch (m.office) {
    case "presidente":
    case "vice_presidente":
      return "Federal · Presidência da República";
    case "senador":
      return "Federal · Senado Federal";
    case "deputado_federal":
      return "Federal · Câmara dos Deputados";
    case "governador":
    case "vice_governador":
      return `Estadual · Governo (${m.placeLabel})`;
    case "deputado_estadual":
    case "deputado_distrital":
      return `Estadual · Assembleia Legislativa (${m.placeLabel})`;
    case "prefeito":
    case "vice_prefeito":
      return `Municipal · Prefeitura (${m.placeLabel})`;
    case "vereador":
      return `Municipal · Câmara Municipal (${m.placeLabel})`;
    default:
      return "Ainda não temos esse dado.";
  }
}

const EXECUTIVO = new Set<OfficeSlug>(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);

type Escolhida =
  | {
      ok: true;
      slug: string;
      name: string;
      cargo: string;
      esfera: string;
      /** casa do mandato, citada como fonte do voto (Câmara Municipal para vereador, nunca Câmara/Senado) */
      fonte: string;
      /** motivo de não haver voto: ainda não tomou posse, ou cargo que não vota em plenário */
      semVotoPorque: string | null;
      voto: Awaited<ReturnType<typeof data.listVotes>>["items"][number] | null;
    }
  | { ok: false; slug: string; name: string };

async function carregarEscolhidos(slugs: string[]): Promise<Escolhida[]> {
  const rows = await Promise.all(
    slugs.map(async (slug): Promise<Escolhida | null> => {
      try {
        const r = await data.getPerson(slug);
        if (!r) return null;
        const [mandates, votes] = await Promise.all([data.getMandates(r.person.id), data.listVotes(r.person.id, { scope: "lei", limit: 1 })]);
        const m = mandatoPrincipal(mandates);
        const posse = m && aguardaPosse(m) ? fraseDesde(m, r.person.gender === "f" ? true : r.person.gender === "m" ? false : null) : null;
        return {
          ok: true,
          slug: r.person.slug,
          name: r.person.displayName,
          cargo: m ? `${m.officeName}${posse ? ` · ${posse}` : ""}` : "Sem mandato carregado",
          esfera: esferaDe(m),
          fonte: m ? casaDoMandato(m.office, null, m.placeLabel) : "fonte do mandato",
          semVotoPorque: m && aguardaPosse(m) ? motivoPosse(m) : m && EXECUTIVO.has(m.office) ? "Este cargo não vota em sessões de plenário." : null,
          voto: m && aguardaPosse(m) ? null : (votes.items[0] ?? null),
        };
      } catch {
        return { ok: false, slug, name: slug };
      }
    }),
  );
  return rows.filter((r): r is Escolhida => r !== null).sort((a, b) => ptSort(a.name, b.name));
}

function quando(e: PautaEntry): string {
  const onde = e.stage === "comissao" ? `em comissão ${ofBody(e.body)}${e.committee ? ` (${e.committee})` : ""}` : `no plenário ${ofBody(e.body)}`;
  return `${cap(fmtWeekday(e.scheduledFor))}, ${onde}${isUrgent(e.regime) ? ", em regime de urgência" : ""}.`;
}

export default async function Temas({ searchParams }: { searchParams: Promise<{ simular?: string | string[] }> }) {
  const falhar = simulacao((await searchParams).simular) === "erro_pagina";
  // p null = a leitura dos assuntos falhou: o quadro dos assuntos vira lacuna nomeada, o resto da página segue (nunca 500)
  const [prefs, p, overview, follows] = await Promise.all([
    readPrefs(),
    lerOuFalhar(falhar, loadThemes).catch(() => null),
    data.getPautaOverview().catch(() => null) as Promise<PautaOverview | null>,
    cookies().then((jar) => parseFollows(jar.get(FOLLOW_COOKIE)?.value)),
  ]);
  const escolhidos = await carregarEscolhidos(follows);

  // Pauta desta semana: plenário e comissões, uma vez por proposta. O tema é o OFICIAL da Câmara (null no Senado e em parte da Câmara).
  // `committees` não vem filtrado pela semana (pg.ts): o corte é aqui, antes de chamar de "desta semana".
  const naSemana = (e: PautaEntry) => !!overview && e.scheduledFor >= overview.week.weekStarts && e.scheduledFor < overview.week.weekEnds;
  const itens = overview ? uniqueByKey([...overview.plenary, ...overview.committees.filter(naSemana)]) : [];
  const porTema = new Map<string, PautaEntry[]>();
  const semTema: PautaEntry[] = [];
  for (const e of itens) {
    if (e.reason.theme) porTema.set(e.reason.theme, [...(porTema.get(e.reason.theme) ?? []), e]);
    else semTema.push(e);
  }
  const temasOficiais = [...porTema.keys()].sort(ptSort);

  // Assuntos do produto: outra lista, em ordem alfabética. Não são mapeados ao tema oficial.
  const assuntos = [...(p?.themes ?? [])].sort((a, b) => ptSort(a.name, b.name));

  const readAt = overview ? (overview.week.readAt ?? [overview.reads.camara.readAt, overview.reads.senado.readAt].filter(Boolean).sort().at(-1) ?? null) : null;
  const falhas = overview ? overview.reads.camara.failed + overview.reads.senado.failed : 0;
  const reunioes = overview ? overview.reads.camara.total + overview.reads.senado.total : 0;
  const lidoEm = readAt ? `lidos em ${fmtDateTime(readAt)}` : "ainda não lidos";
  const proveFonte = `Fonte: ${FONTE_PAUTA}, ${lidoEm}.`;

  let n = 1; // número do quadro
  let legendaFeita = false;

  const renderItem = (e: PautaEntry) => {
    const d = deciders(e);
    const mostrarLegenda = !legendaFeita;
    legendaFeita = true;
    return (
      <div className="sv-tm-item" key={`${e.key}-${e.scheduledFor}-${e.committee ?? ""}`}>
        <p className="sv-esf">Esfera: Federal · {BODY_NAME[e.body]}</p>
        <Resposta tamanho="m">
          <Link href={`/v2/decisao/${e.key}`}>
            {e.plain ?? clip(e.summary ?? "Resumo não publicado pela fonte", 150)} <span aria-hidden="true">→</span>
          </Link>
        </Resposta>
        <p className="sv-t">
          {quando(e)} Quem decide: {low(d.who)} {d.needs}
        </p>
        <p className="sv-vale-l">
          Já vale? <JaVale estado={vigenciaDe(e.type).estado} frase={vigenciaDe(e.type).frase} />
        </p>
        {mostrarLegenda && <JaValeLegenda />}
        <Nota>
          {billLabel(e)} ({typeName(e.type)}). {reasonText(e)}
        </Nota>
      </div>
    );
  };

  // ---- Quadro 1: frase gerada do dado ----
  const temItens = itens.length > 0;
  let resposta: string;
  if (!overview) resposta = "Não conseguimos ler a pauta agora.";
  else if (!temItens && !readAt) resposta = "A pauta desta semana ainda não foi lida.";
  else if (!temItens) resposta = "Nenhum item que acompanhamos na pauta lida desta semana.";
  else resposta = `Na pauta desta semana há ${plural(itens.length, "item", "itens")} que acompanhamos.`;

  const ufNome = prefs.uf?.sigla === "DF" ? "Câmara Legislativa do DF" : prefs.uf ? `Assembleia de ${prefs.uf.sigla}` : null;

  const quadro1 = (
    <Quadro
      id="tm-1"
      variante="dom"
      numero={n++}
      pergunta="O que está em jogo no Congresso esta semana?"
      className="sv-ga"
      prova={`Tema oficial como está no dado da Câmara; o Senado não informa tema. ${proveFonte}`}
    >
      <Resposta tamanho="dom">{resposta}</Resposta>
      {temItens && (
        <p className="sv-t">
          {temasOficiais.length > 0 ? (
            <>
              Pelo tema oficial da Câmara: {temasOficiais.join("; ")}.
              {semTema.length > 0 && <> Sem tema oficial no dado: {fmtInt(semTema.length)}.</>}
            </>
          ) : (
            <>Nenhum item tem tema oficial da Câmara no dado.</>
          )}
        </p>
      )}
      {(!overview || !temItens) && <p className="sv-t">Isso não quer dizer que nada vai acontecer. Só lemos o que a Câmara e o Senado publicaram.</p>}
      {overview && overview.reads.camara.readAt && !overview.reads.senado.readAt && <p className="sv-t">A pauta do Senado Federal ainda não foi lida.</p>}
      {overview && !overview.reads.camara.readAt && overview.reads.senado.readAt && <p className="sv-t">A pauta da Câmara dos Deputados ainda não foi lida.</p>}
      {overview && <NotaRegra />}
      {falhas > 0 && (
        <p className="sv-t">
          Leitura incompleta: {fmtInt(falhas)} de {fmtInt(reunioes)} reuniões não carregaram. Pode haver mais itens.
        </p>
      )}
      <p className="sv-t">
        {!p ? "Não conseguimos ler os assuntos do produto agora." : assuntos.length > 0 ? `Os ${fmtInt(assuntos.length)} assuntos do produto estão abaixo, em ordem alfabética.` : "Os assuntos do produto ainda não foram carregados."} Eles são outra lista: não são o tema oficial da Câmara.
      </p>
      <p className="sv-t">
        {prefs.uf ? (
          <>
            {prefs.esferas.estadual ? (
              <>
                <b>{ufNome}:</b> a pauta {prefs.uf.sigla === "DF" ? "da Câmara Legislativa" : "da Assembleia"} de {prefs.uf.sigla} não faz parte do que lemos hoje.
              </>
            ) : (
              <>
                <b>Esfera estadual:</b> desligada.
              </>
            )}{" "}
            <b>Câmara Municipal:</b> {prefs.esferas.municipal ? "ligada. A pauta da Câmara Municipal não faz parte do que lemos hoje." : "desligada."}
          </>
        ) : (
          <>
            <Link className="sv-lk" href="/v2/ajustes">
              Escolha seu estado
            </Link>{" "}
            para ver a esfera estadual. <b>Câmara Municipal:</b> {prefs.esferas.municipal ? "ligada. A pauta da Câmara Municipal não faz parte do que lemos hoje." : "desligada."}
          </>
        )}
      </p>
    </Quadro>
  );

  // ---- Quadros 2: um por tema oficial presente ----
  const quadrosTema = temasOficiais.map((tema) => (
    <Quadro key={tema} id={`tm-tema-${n}`} numero={n++} pergunta={`Na pauta desta semana, pelo tema oficial da Câmara: ${tema}`} className="sv-tira" prova={proveFonte}>
      <div className="sv-tm-meio">{(porTema.get(tema) ?? []).map(renderItem)}</div>
    </Quadro>
  ));

  // ---- Quadro 3: sem tema oficial no dado ----
  const quadroSemTema =
    semTema.length > 0 ? (
      <Quadro
        id="tm-sem-tema"
        variante="fio"
        numero={n++}
        pergunta="Sem tema oficial no dado"
        className="sv-tira"
        prova={`${semTema.some((e) => e.body === "senado") ? "O Senado não informa tema oficial. " : ""}${semTema.some((e) => e.body === "camara") ? "Nos itens da Câmara, o dado não traz tema. " : ""}${proveFonte}`}
      >
        <div className="sv-tm-meio">{semTema.map(renderItem)}</div>
      </Quadro>
    ) : null;

  // ---- Quadro 4: assuntos do produto ----
  const quadroAssuntos = (
    <Quadro
      id="tm-assuntos"
      variante={assuntos.length === 0 ? "lacuna" : "padrao"}
      numero={n++}
      pergunta={assuntos.length === 0 ? "Os assuntos do produto" : `Os ${fmtInt(assuntos.length)} assuntos do produto`}
      className="sv-tira sv-ge"
      prova={`Assuntos em ordem alfabética. Fonte: ${FONTE_PAUTA}, votações nominais. A contagem é de votações, não de importância.`}
    >
      <div className="sv-tm-meio">
        {!p ? (
          <Lacuna motivo="Não conseguimos ler os assuntos agora. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
        ) : assuntos.length === 0 ? (
          <Lacuna>Ainda não temos esse dado. Nenhuma votação com assunto classificado foi carregada.</Lacuna>
        ) : (
          <>
            <ol className="sv-14">
              {assuntos.map((t) => (
                <li key={t.slug}>
                  <Link href={`/v2/tema/${t.slug}`}>
                    {t.name} <small>{plural(t.events.length, "votação", "votações")}</small>
                  </Link>
                </li>
              ))}
            </ol>
            <Nota>
              Entram as {fmtInt(p.loaded)} votações mais recentes que mudam o texto de uma proposta, de um total de {fmtInt(p.total)}. O assunto é o que a própria Casa atribui; {fmtInt(p.untagged)} votações não têm assunto e ficam fora.
            </Nota>
          </>
        )}
      </div>
    </Quadro>
  );

  // ---- Quadro 5: quem eu elegi ----
  const quadroEscolhidos =
    escolhidos.length === 0 ? (
      <Quadro id="tm-escolhidos" variante="lacuna" numero={n++} pergunta="Qual desses mexe com quem eu elegi?" className="sv-gf" prova="Escolha guardada num cookie neste navegador; o servidor lê o cookie para montar a página.">
        <Resposta>Você ainda não escolheu ninguém.</Resposta>
        <p className="sv-t">Escolha em quem você votou para ver aqui o último voto de cada pessoa.</p>
        <Link className="sv-lk" href="/v2/pessoas">
          Escolher em quem votei <span aria-hidden="true">→</span>
        </Link>
      </Quadro>
    ) : (
      <Quadro
        id="tm-escolhidos"
        numero={n++}
        pergunta="Qual desses mexe com quem eu elegi?"
        className="sv-gf"
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: pessoas e votos inventados para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética. Sem voto não é voto contra. Fonte: votações nominais da casa de cada pessoa; a casa e a data de cada voto estão na linha.
          </>
        }
      >
        <Resposta tamanho="fala">Não cruzamos a pauta com os votos de quem você escolheu. Veja o último voto de cada pessoa.</Resposta>
        <ul className="sv-pes">
          {escolhidos.map((e) =>
            e.ok ? (
              <li key={e.slug}>
                <b>
                  <Link href={`/v2/pessoa/${e.slug}`}>{e.name}</Link>, {e.cargo}
                </b>
                <span className="sv-esf">Esfera: {e.esfera}</span>
                {e.voto ? (
                  <>
                    Último voto em lei: <VotoMarca voto={e.voto.value} /> em “{clip(e.voto.event.description, 110)}”, {fmtDate(e.voto.event.occurredAt)}. Fonte: {e.fonte}, votações nominais.
                  </>
                ) : e.semVotoPorque ? (
                  <Lacuna>{e.semVotoPorque}</Lacuna>
                ) : (
                  <Cobertura fonte={`${e.fonte}, votações nominais`} />
                )}
              </li>
            ) : (
              <li key={e.slug}>
                <b>{e.name}</b>
                <Lacuna>Não conseguimos ler esta pessoa agora.</Lacuna>
              </li>
            ),
          )}
        </ul>
      </Quadro>
    );

  const quadroSelo = <Selo id="tm-selo" numero={n++} lidoEm={readAt} className="sv-gs" />;

  const temPauta = quadrosTema.length > 0 || quadroSemTema !== null;

  return (
    <div className={`sv-pg sv-pg--temas${temPauta ? "" : " sv-pg--sem-itens"}`}>
      <div className="sv-folio sv-gh">
        <h1>O que está em jogo no Congresso?</h1>
        <p className="sv-so-larga">
          {assuntos.length > 0 ? `${fmtInt(assuntos.length)} assuntos em ordem alfabética · ` : ""}
          {fmtDate(new Date().toISOString())}
        </p>
      </div>
      {quadro1}
      {temPauta && (
        <div className="sv-tm-sec sv-gc">
          {quadrosTema}
          {quadroSemTema}
        </div>
      )}
      {quadroAssuntos}
      {quadroEscolhidos}
      {quadroSelo}
      <Proxima href="/v2" pergunta="O que está rolando?" className="sv-gn" />
    </div>
  );
}
