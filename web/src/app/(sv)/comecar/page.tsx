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
import { ListaPessoas, Marcados } from "@/components/sv/pessoas-lista";
import { COOKIE_TEXTO, readPrefs, ufOptions, type Prefs } from "@/components/sv/prefs";
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

async function Passo1({ prefs, erro }: { prefs: Prefs; erro: boolean }) {
  const { uf, esferas } = prefs;
  const [ufsLidas, cidades] = await Promise.all([ufOptions().catch(() => null), uf ? data.listMunicipalities(uf.sigla).catch((): Place[] => []) : Promise.resolve([] as Place[])]);
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
        <Quadro id="cm-cidade" pergunta="E a sua cidade? (opcional)">
          <p className="sv-t">Com a cidade, você também acompanha a Câmara Municipal. Só lemos as câmaras que publicam num sistema aberto.</p>
          {cidades.length > 0 ? (
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
            <Lacuna motivo="Você pode escolher a cidade depois, em Ajustes.">Não conseguimos listar as cidades de {uf.sigla} agora.</Lacuna>
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

async function Passo2({ prefs, marcados, sp, erro }: { prefs: Prefs; marcados: string[]; sp: { nome?: string; cargo?: string; pagina?: string }; /** a cidade do passo 1 não pôde ser guardada */ erro: boolean }) {
  const { uf } = prefs;
  // mesmas regras de entrada de /pessoas: `pagina` só inteiro de até 6 dígitos; cargo só da lista; nome até 80 caracteres
  const pagina = sp.pagina && /^\d{1,6}$/.test(sp.pagina) ? sp.pagina : undefined;
  const q = (sp.nome ?? "").trim().slice(0, 80);
  const office = isOffice(sp.cargo) ? sp.cargo : undefined;
  const [offices, page, stamp] = await Promise.all([
    data.listOffices().catch(() => null),
    data.listPeople({ q: q || undefined, office, uf: uf?.sigla, cursor: pagina, limit: POR_PAGINA }).catch(() => null),
    data.getStamp("tse.candidatos").catch(() => null),
  ]);
  const next = new URLSearchParams({ passo: "2" });
  if (q) next.set("nome", q);
  if (office) next.set("cargo", office);
  if (page?.nextCursor) next.set("pagina", page.nextCursor);
  const filtrou = !!(q || office);
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
        variante={page && n > 0 ? "padrao" : "lacuna"}
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
              Sem estado escolhido, a lista é do país inteiro: procure pelo nome.{" "}
              <Link className="sv-lk" href="/comecar">
                Escolher estado
              </Link>
            </p>
          ))}
        {/* key: campos não controlados; remonta quando o filtro muda por navegação no cliente ("limpar os filtros") */}
        <form key={`${q}|${office ?? ""}`} className="sv-filtro" action="/comecar" method="get" role="search" aria-label="Procurar pessoas">
          <input type="hidden" name="passo" value="2" />
          <label htmlFor="cm-nome">Nome</label>
          <input className="sv-campo" id="cm-nome" name="nome" type="text" defaultValue={q} maxLength={80} autoComplete="off" />
          <label htmlFor="cm-cargo">Cargo</label>
          <select className="sv-campo" id="cm-cargo" name="cargo" defaultValue={office ?? ""}>
            <option value="">Todos os cargos</option>
            {(offices ?? []).map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.nameM}
              </option>
            ))}
          </select>
          <span className="sv-filtro__b" aria-hidden="true" />
          <button className="sv-enviar" type="submit">
            Procurar
          </button>
        </form>
        {!offices && <Lacuna motivo="O filtro fica sem essa opção até a leitura voltar.">Não conseguimos ler a lista de cargos agora.</Lacuna>}
        {filtrou && (
          <Link className="sv-lk" href={PASSO_2}>
            Limpar os filtros
          </Link>
        )}

        {!page ? (
          <Lacuna motivo="A lista de pessoas não pôde ser lida. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
        ) : n === 0 && pagina && page.total > 0 ? (
          <Lacuna motivo={`A lista tem ${fmtInt(page.total)} pessoas.`}>Esta página fica depois do fim da lista.</Lacuna>
        ) : n === 0 ? (
          <Lacuna>{filtrou ? "Nenhuma pessoa encontrada com esses filtros." : "Ninguém carregado ainda."}</Lacuna>
        ) : (
          <>
            <Marcados n={marcados.length} />
            {n < page.total && (
              <p className="sv-t">
                Esta página mostra {fmtInt(n)} de {fmtInt(page.total)}. Use o nome ou o cargo para achar mais rápido.
              </p>
            )}
            <ListaPessoas items={page.items} marcados={marcados} />
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

export default async function Comecar({ searchParams }: { searchParams: Promise<{ passo?: string | string[]; nome?: string | string[]; cargo?: string | string[]; pagina?: string | string[]; erro?: string | string[] }> }) {
  const raw = await searchParams;
  // parâmetro repetido chega como array: só string vale, o resto é ignorado (nunca erro 500)
  const so = (v: unknown) => (typeof v === "string" ? v : undefined);
  const [prefs, jar] = await Promise.all([readPrefs(), cookies()]);
  if (so(raw.passo) === "2") return <Passo2 prefs={prefs} marcados={parseFollows(jar.get(FOLLOW_COOKIE)?.value)} sp={{ nome: so(raw.nome), cargo: so(raw.cargo), pagina: so(raw.pagina) }} erro={raw.erro === "leitura"} />;
  return <Passo1 prefs={prefs} erro={raw.erro === "leitura"} />;
}
