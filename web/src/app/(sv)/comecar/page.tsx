import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import "@/styles/sv-pessoas.css";
import "@/styles/sv-comecar.css";
import { fraseLida } from "@/components/sv/carimbo";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { fmtInt } from "@/components/sv/fmt";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { contarMarcados } from "@/components/sv/marcados";
import { escolherPartido, opcoesDePartido, rotuloPartido } from "@/components/sv/partidos";
import { ListaPessoas, Marcados } from "@/components/sv/pessoas-lista";
import { COOKIE_TEXTO, readPrefs, ufOptions, type Prefs } from "@/components/sv/prefs";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { Lacuna, Nota, Notice, Quadro, Resposta } from "@/components/sv/ui";
import { data, type OfficeSlug, type Place } from "@/lib/data";
import { salvarUf } from "../ajustes/actions";
import { salvarCidadeDoComeco } from "./actions";

// Começo em dois passos (D324): 1) estado e, se quiser, cidade; 2) marcar em quem votou. Sem conta e sem banco: só os
// cookies que já existiam (sv_uf, sv_esferas, sv_sigo), gravados pelas mesmas ações dos Ajustes e da página da pessoa.
// Tudo funciona sem JavaScript. Página pessoal: fora de busca. Ninguém é mandado para cá: a home só convida.
export const metadata: Metadata = { title: "Por onde eu começo?", robots: { index: false, follow: false } };

const PASSO_2 = "/comecar?passo=2";
const SLUGS: OfficeSlug[] = ["presidente", "vice_presidente", "senador", "deputado_federal", "governador", "vice_governador", "deputado_estadual", "deputado_distrital", "prefeito", "vice_prefeito", "vereador"];
const isOffice = (s: string | undefined): s is OfficeSlug => !!s && (SLUGS as string[]).includes(s);
const POR_PAGINA = 60;

/** Onde a pessoa está no começo: dois passos, o atual marcado com `aria-current="step"`. */
function Passos({ atual }: { atual: 1 | 2 }) {
  return (
    <ol className="sv-passos" aria-label="Passos">
      <li aria-current={atual === 1 ? "step" : undefined}>Passo 1 de 2: seu estado</li>
      <li aria-current={atual === 2 ? "step" : undefined}>Passo 2 de 2: em quem você votou</li>
    </ol>
  );
}

async function Passo1({ prefs, erro, falhar }: { prefs: Prefs; erro: boolean; /** `?simular=erro` (só na demonstração): a leitura das cidades falha */ falhar: boolean }) {
  const { uf, esferas } = prefs;
  // null = a leitura das cidades falhou; lista vazia = a fonte respondeu e não traz cidade desse estado. São avisos diferentes (D327).
  const [stampIbge, ufsLidas, cidades] = await Promise.all([
    uf ? data.getStamp("ibge.places").catch(() => null) : null,
    ufOptions().catch(() => null),
    uf ? lerOuFalhar(falhar, () => data.listMunicipalities(uf.sigla)).catch((): Place[] | null => null) : Promise.resolve<Place[] | null>([]),
  ]);
  return (
    <div className="sv-pg sv-pg--comecar">
      <div className="sv-folio sv-folio--dom">
        <h1>Por onde eu começo?</h1>
        <p className="sv-intro">Dois passos, sem conta: seu estado e as pessoas em quem você votou. Você pode pular qualquer um.</p>
      </div>
      <Passos atual={1} />
      {erro && <Notice label="Nada foi guardado">Não conseguimos ler a lista de estados agora, então sua escolha não foi guardada. Tente de novo em alguns minutos.</Notice>}

      <Quadro id="cm-estado" pergunta="Qual é o seu estado?">
        {uf ? (
          <Resposta tamanho="m">
            {uf.nome} ({uf.sigla}).
          </Resposta>
        ) : prefs.ufFalhou ? (
          <Lacuna motivo="O estado guardado neste navegador depende da lista de estados, que não pôde ser lida.">{FALHOU_LEITURA}</Lacuna>
        ) : (
          <p className="sv-t">Com o estado, o site mostra quem representa você e a Assembleia da sua região.</p>
        )}
        <form action={salvarUf} className="sv-form-d2 sv-cm-f">
          {/* volta para este passo, já com o estado guardado: a lista de cidades depende dele (sem JavaScript não há como carregá-la antes) */}
          <input type="hidden" name="voltar" value="/comecar#cm-cidade" />
          <label className="sv-aj-rot" htmlFor="cm-uf">
            Estado
          </label>
          {ufsLidas === null && <Lacuna motivo="A lista de estados não pôde ser lida agora.">{FALHOU_LEITURA}</Lacuna>}
          <select id="cm-uf" name="uf" className="sv-campo" defaultValue={uf?.sigla ?? ""} required aria-describedby="cm-uf-d">
            <option value="">Escolha um estado</option>
            {(ufsLidas ?? []).map((o) => (
              <option key={o.sigla} value={o.sigla}>
                {o.nome} ({o.sigla})
              </option>
            ))}
          </select>
          <button type="submit" className="sv-enviar">
            {uf ? "Trocar estado" : "Guardar estado"}
          </button>
          <p className="sv-nota" id="cm-uf-d">
            {COOKIE_TEXTO}
          </p>
        </form>
      </Quadro>

      {uf && (
        <Quadro id="cm-cidade" pergunta="E a sua cidade? (opcional)" prova={cidades !== null && cidades.length === 0 ? `Fonte: IBGE, lista de municípios${fraseLida(stampIbge)}.` : undefined}>
          <p className="sv-t">Com a cidade, você também acompanha a Câmara Municipal. Só lemos as câmaras que publicam num sistema aberto.</p>
          {cidades === null ? (
            <Lacuna motivo="A lista de cidades não pôde ser lida. Tente de novo em alguns minutos ou escolha a cidade depois, em Ajustes.">Não conseguimos listar as cidades de {uf.sigla} agora.</Lacuna>
          ) : cidades.length > 0 ? (
            <form action={salvarCidadeDoComeco} className="sv-form-d2 sv-cm-f">
              <label className="sv-aj-rot" htmlFor="cm-cid">
                Cidade
              </label>
              <select id="cm-cid" name="cidade" className="sv-campo" defaultValue={esferas.cidade ?? ""}>
                <option value="">Nenhuma cidade</option>
                {cidades.map((c) => (
                  <option key={c.ibge} value={c.ibge}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="sv-enviar">
                Guardar cidade e continuar
              </button>
            </form>
          ) : (
            <Lacuna motivo={`A lista de municípios que o site carregou não traz nenhum de ${uf.sigla}. Sem cidade, você segue com o estado e o Congresso.`}>Ainda não temos cidades de {uf.sigla} para escolher.</Lacuna>
          )}
        </Quadro>
      )}

      <p className="sv-cm-nav">
        {uf ? (
          <Link className="sv-lk" href={PASSO_2}>
            Continuar sem escolher cidade <span aria-hidden="true">&nbsp;→</span>
          </Link>
        ) : (
          <Link className="sv-lk" href={PASSO_2}>
            Pular este passo <span aria-hidden="true">&nbsp;→</span>
          </Link>
        )}
      </p>
    </div>
  );
}

async function Passo2({ prefs, marcados, sp, erro, falhar }: { prefs: Prefs; marcados: string[]; /** `?simular=erro` (só na demonstração): a conferência das marcações falha */ falhar: boolean; sp: { nome?: string; cargo?: string; partido?: string; pagina?: string }; /** a cidade do passo 1 não pôde ser guardada */ erro: boolean }) {
  const { uf } = prefs;
  // mesmas regras de entrada de /pessoas: `pagina` só inteiro de até 6 dígitos; cargo só da lista; nome até 80 caracteres
  const pagina = sp.pagina && /^\d{1,6}$/.test(sp.pagina) ? sp.pagina : undefined;
  const q = (sp.nome ?? "").trim().slice(0, 80);
  const office = isOffice(sp.cargo) ? sp.cargo : undefined;
  const [marcacoes, offices, partidosLidos, stamp] = await Promise.all([
    contarMarcados(marcados, (fn) => lerOuFalhar(falhar, fn)),
    data.listOffices().catch(() => null),
    data.listParties().catch(() => null),
    data.getStamp("tse.candidatos").catch(() => null),
  ]);
  // D328: o partido é sempre um dos filtros, e a lista só aparece depois que o eleitor filtra (partido, cargo ou nome).
  // O estado guardado só estreita: sem filtro, a tela diz quantas pessoas há e pede o filtro, sem despejar a lista.
  const partidos = partidosLidos ? opcoesDePartido(partidosLidos) : null;
  const partido = escolherPartido(sp.partido, partidos);
  const filtrou = !!(q || office || partido);
  const page = await data.listPeople({ q: q || undefined, office, party: partido?.id, uf: uf?.sigla, cursor: filtrou ? pagina : undefined, limit: filtrou ? POR_PAGINA : 1 }).catch(() => null);
  const next = new URLSearchParams({ passo: "2" });
  if (partido) next.set("partido", partido.id);
  if (q) next.set("nome", q);
  if (office) next.set("cargo", office);
  if (page?.nextCursor) next.set("pagina", page.nextCursor);
  const n = page?.items.length ?? 0;

  return (
    <div className="sv-pg sv-pg--comecar">
      <div className="sv-folio sv-folio--dom">
        <h1>Em quem você votou?</h1>
        <p className="sv-intro">Marque as pessoas em quem você votou para acompanhar o que elas fazem. Dá para mudar depois, e para pular.</p>
      </div>
      <Passos atual={2} />
      {erro && <Notice label="Nada foi guardado">Não conseguimos ler a lista de estados agora, então a cidade não foi guardada. Você pode escolher de novo no passo 1 ou depois, em Ajustes.</Notice>}

      <Quadro
        id="cm-pessoas"
        variante={page && (n > 0 || !filtrou) ? "padrao" : "lacuna"}
        pergunta={uf ? `Quem está no cargo em ${uf.nome}, em ordem alfabética?` : "Quem está no cargo, em ordem alfabética?"}
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: pessoas inventadas para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética. Fonte: TSE, dados abertos, e as casas legislativas{fraseLida(stamp)}.
          </>
        }
      >
        {!uf &&
          (prefs.ufFalhou ? (
            <Lacuna motivo="A lista abaixo é do país inteiro.">Não conseguimos ler o estado guardado agora.</Lacuna>
          ) : (
            <p className="sv-t">
              Sem estado escolhido, a lista é do país inteiro.{" "}
              <Link className="sv-lk" href="/comecar">
                Escolher estado
              </Link>
            </p>
          ))}
        {/* key: campos não controlados; remonta quando o filtro muda por navegação no cliente ("limpar os filtros") */}
        <form key={`${q}|${office ?? ""}|${partido?.id ?? ""}`} className="sv-filtro" action="/comecar" method="get" role="search" aria-label="Procurar pessoas">
          <input type="hidden" name="passo" value="2" />
          <label htmlFor="cm-partido">Partido</label>
          <select className="sv-campo" id="cm-partido" name="partido" defaultValue={partido?.id ?? ""}>
            <option value="">Todos os partidos</option>
            {(partidos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {rotuloPartido(p)}
              </option>
            ))}
          </select>
          <label htmlFor="cm-cargo">Cargo</label>
          <select className="sv-campo" id="cm-cargo" name="cargo" defaultValue={office ?? ""}>
            <option value="">Todos os cargos</option>
            {(offices ?? []).map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.nameM}
              </option>
            ))}
          </select>
          <label htmlFor="cm-nome">Nome</label>
          <input className="sv-campo" id="cm-nome" name="nome" type="text" defaultValue={q} maxLength={80} autoComplete="off" />
          <span className="sv-filtro__b" aria-hidden="true" />
          <button className="sv-enviar" type="submit">
            Procurar
          </button>
        </form>
        {(!offices || !partidos) && (
          <Lacuna motivo="O filtro fica sem essas opções até a leitura voltar.">Não conseguimos ler a lista de {!offices && !partidos ? "partidos e de cargos" : !partidos ? "partidos" : "cargos"} agora.</Lacuna>
        )}
        {filtrou && (
          <Link className="sv-lk" href={PASSO_2}>
            Limpar os filtros
          </Link>
        )}

        {!page ? (
          <Lacuna motivo="A lista de pessoas não pôde ser lida. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
        ) : !filtrou ? (
          // D328: sem filtro do eleitor, só o total; a lista espera o partido, o cargo ou o nome
          <>
            <Resposta tamanho="m">
              {page.total === 1 ? "1 pessoa" : `${fmtInt(page.total)} pessoas`} no cargo hoje{uf ? ` em ${uf.nome}` : " no país"}.
            </Resposta>
            <p className="sv-t" id="cm-pede">
              Escolha o partido em que você votou (ou o cargo, ou procure pelo nome). A lista aparece depois, em ordem alfabética, para você marcar.
            </p>
            <Marcados guardadas={marcacoes.guardadas} pessoas={marcacoes.pessoas} sobrando={marcacoes.sobrando} />
          </>
        ) : n === 0 && pagina && page.total > 0 ? (
          <Lacuna motivo={`A lista tem ${fmtInt(page.total)} pessoas.`}>Esta página fica depois do fim da lista.</Lacuna>
        ) : n === 0 ? (
          <Lacuna>{filtrou ? "Nenhuma pessoa encontrada com esses filtros." : "Ninguém carregado ainda."}</Lacuna>
        ) : (
          <>
            <Marcados guardadas={marcacoes.guardadas} pessoas={marcacoes.pessoas} sobrando={marcacoes.sobrando} />
            {n < page.total && (
              <p className="sv-t">
                Esta página mostra {fmtInt(n)} de {fmtInt(page.total)}. Use o partido, o cargo ou o nome para achar mais rápido.
              </p>
            )}
            <ListaPessoas items={page.items} marcados={marcados} porPessoa={marcacoes.porPessoa} />
            {page.nextCursor && (
              <Link className="sv-lk" href={`/comecar?${next.toString()}`}>
                Próximas {POR_PAGINA} <span aria-hidden="true">→</span>
              </Link>
            )}
            {uf && (
              <Nota>
                Presidente e vice-presidente não são de um estado e não entram nesta lista. <Link href="/pessoas?cargo=presidente&uf=">Ver quem está na Presidência</Link>
              </Nota>
            )}
            <Nota>Partido: o da filiação vigente quando a fonte a registra; sem esse registro, o do mandato. Nenhuma lista tem ordem de mérito.</Nota>
          </>
        )}
      </Quadro>

      <p className="sv-cm-nav">
        {marcados.length > 0 ? (
          <Link className="sv-btn" href="/">
            Concluir <span aria-hidden="true">&nbsp;→</span>
          </Link>
        ) : (
          <Link className="sv-lk" href="/">
            Pular este passo <span aria-hidden="true">&nbsp;→</span>
          </Link>
        )}
        <Link className="sv-lk" href="/comecar">
          <span aria-hidden="true">←&nbsp;</span> Voltar ao passo 1
        </Link>
      </p>
    </div>
  );
}

export default async function Comecar({ searchParams }: { searchParams: Promise<{ passo?: string | string[]; nome?: string | string[]; cargo?: string | string[]; partido?: string | string[]; pagina?: string | string[]; erro?: string | string[]; simular?: string | string[] }> }) {
  const raw = await searchParams;
  // parâmetro repetido chega como array: só string vale, o resto é ignorado (nunca erro 500)
  const so = (v: unknown) => (typeof v === "string" ? v : undefined);
  const [prefs, jar] = await Promise.all([readPrefs(), cookies()]);
  // `?simular=erro` só vale na demonstração (simular.ts): é como a leitura que falha é testada
  const falhar = simulacao(raw.simular) === "erro";
  if (so(raw.passo) === "2") return <Passo2 falhar={falhar} prefs={prefs} marcados={parseFollows(jar.get(FOLLOW_COOKIE)?.value)} sp={{ nome: so(raw.nome), cargo: so(raw.cargo), partido: so(raw.partido), pagina: so(raw.pagina) }} erro={raw.erro === "leitura"} />;
  return <Passo1 prefs={prefs} erro={raw.erro === "leitura"} falhar={falhar} />;
}
