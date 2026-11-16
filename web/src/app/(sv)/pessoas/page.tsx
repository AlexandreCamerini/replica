import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import "@/styles/sv-pessoas.css";
import { fraseLida, lidoEm } from "@/components/sv/carimbo";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { fmtInt } from "@/components/sv/fmt";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { contarMarcados } from "@/components/sv/marcados";
import { ListaPessoas, Marcados } from "@/components/sv/pessoas-lista";
import { readPrefs } from "@/components/sv/prefs";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { Lacuna, Nota, Proxima, Quadro, Resposta, Selo } from "@/components/sv/ui";
import { data, type OfficeSlug } from "@/lib/data";

export const metadata: Metadata = { title: "Quem está no cargo?" };

const SLUGS: OfficeSlug[] = ["presidente", "vice_presidente", "senador", "deputado_federal", "governador", "vice_governador", "deputado_estadual", "deputado_distrital", "prefeito", "vice_prefeito", "vereador"];
const isOffice = (s: string | undefined): s is OfficeSlug => !!s && (SLUGS as string[]).includes(s);
const POR_PAGINA = 60;
const FONTE = "TSE, dados abertos, e as casas legislativas";

export default async function PessoasPage({ searchParams }: { searchParams: Promise<{ nome?: string; cargo?: string; uf?: string; cidade?: string; grupo?: string; pagina?: string; simular?: string | string[] }> }) {
  const raw = await searchParams;
  // parâmetro repetido chega como array: só string vale, o resto é ignorado (nunca erro 500)
  const so = (v: unknown) => (typeof v === "string" ? v : undefined);
  const sp = { nome: so(raw.nome), cargo: so(raw.cargo), uf: so(raw.uf), cidade: so(raw.cidade), grupo: so(raw.grupo), pagina: so(raw.pagina) };
  // `pagina` é o deslocamento da lista: só inteiro de até 6 dígitos chega à consulta. O resto (Infinity, 1e308, fração,
  // texto) é entrada inválida, dita como tal, e não "falha da fonte".
  const pagina = sp.pagina && /^\d{1,6}$/.test(sp.pagina) ? sp.pagina : undefined;
  const paginaInvalida = !!sp.pagina && !pagina;
  const q = (sp.nome ?? "").trim().slice(0, 80);
  const office = isOffice(sp.cargo) ? sp.cargo : undefined;
  // Estado (D324). Com `uf` no endereço vale o do endereço; `uf=` vazio é o pedido explícito de "todos os estados".
  // Sem `uf` no endereço, a lista abre no estado guardado em Ajustes (cookie sv_uf), e a tela diz isso.
  const [prefs, jar] = await Promise.all([readPrefs(), cookies()]);
  const ufPedida = sp.uf !== undefined;
  const ufDoCookie = !ufPedida && prefs.uf ? prefs.uf : null;
  const uf = sp.uf && /^[A-Za-z]{2}$/.test(sp.uf) ? sp.uf.toUpperCase() : (ufDoCookie?.sigla ?? undefined);
  // quem a pessoa já marcou (cookie sv_sigo, lido só aqui no servidor): define o estado de cada botão da lista
  const marcados = parseFollows(jar.get(FOLLOW_COOKIE)?.value);
  // `?simular=erro` só vale na demonstração (simular.ts): é como a leitura que falha é testada
  const falhar = simulacao(raw.simular) === "erro";
  // quantas dessas marcações são pessoas que existem hoje (D327): slug de pessoa que sumiu ou foi fundida não conta
  const [stamp, marcacoes] = await Promise.all([data.getStamp("tse.candidatos").catch(() => null), contarMarcados(marcados, (fn) => lerOuFalhar(falhar, fn))]);
  const fonte = `Fonte: ${FONTE}${fraseLida(stamp)}.`;

  // Vindo de um lugar: as pessoas de um grupo (ex.: vereadores) de uma cidade.
  let grupoFalhou = false;
  if (sp.cidade && /^\d{7}$/.test(sp.cidade)) {
    const place = await lerOuFalhar(falhar, () => data.getPlace(sp.cidade!)).catch(() => undefined);
    const groups = place ? await data.getRepresentatives(place).catch(() => null) : null;
    // leitura que falhou (lugar ou grupo) não vira a lista geral em silêncio: a tela diz que falhou
    grupoFalhou = place === undefined || (!!place && groups === null);
    const group = groups?.find((g) => g.key === sp.grupo) ?? null;
    if (place && group) {
      const onde = `${place.name}${place.uf ? `, ${place.uf}` : ""}`;
      return (
        <div className="sv-pg sv-pg--pps">
          <div className="sv-folio sv-folio--dom">
            <h1>{group.title}</h1>
            <p className="sv-intro">
              {onde}. {group.where}.
            </p>
          </div>
          <Quadro id="pp-1" variante="dom" numero={1} pergunta={`Quantas pessoas estão no cargo em ${place.name}?`} className="sv-c5" prova={fonte}>
            {group.seats ? (
              <>
                <Resposta tamanho="dom">
                  {fmtInt(group.seats.loaded)} de {fmtInt(group.seats.total)} cadeiras carregadas.
                </Resposta>
                <p className="sv-t">{group.seats.why}</p>
              </>
            ) : (
              <Resposta tamanho="dom">{group.people.length === 1 ? "1 pessoa no cargo hoje." : `${fmtInt(group.people.length)} pessoas no cargo hoje.`}</Resposta>
            )}
          </Quadro>
          <Quadro
            id="pp-2"
            variante={group.people.length ? "padrao" : "lacuna"}
            numero={2}
            pergunta="Quem são, em ordem alfabética?"
            className="sv-c7"
            prova={
              <>
                <ExemploIlustrativo>Exemplo ilustrativo: pessoas inventadas para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética. {fonte}
              </>
            }
          >
            {group.people.length === 0 ? (
              <Lacuna motivo="Ninguém foi carregado para este grupo.">Ainda não temos esse dado.</Lacuna>
            ) : (
              <>
                <Marcados guardadas={marcacoes.guardadas} pessoas={marcacoes.pessoas} sobrando={marcacoes.sobrando} />
                <ListaPessoas items={group.people} marcados={marcados} porPessoa={marcacoes.porPessoa} />
              </>
            )}
          </Quadro>
          {group.gaps && group.gaps.length > 0 && (
            <Quadro id="pp-gaps" variante="lacuna" numero={3} pergunta="O que ainda não consta?" prova={fonte}>
              {group.gaps.map((g) => (
                <Lacuna key={g.what} motivo={g.why}>
                  {g.what}: ainda não temos esse dado.
                </Lacuna>
              ))}
            </Quadro>
          )}
          <Selo id="pp-selo" numero={group.gaps?.length ? 4 : 3} lidoEm={lidoEm(stamp)} className="sv-c7" />
          <Proxima href="/pessoas" pergunta="Quem mais está no cargo?" className="sv-c5" />
        </div>
      );
    }
  }

  const [offices, ufs, page] = await Promise.all([
    data.listOffices().catch(() => null),
    data.listUfs().catch(() => null),
    lerOuFalhar(falhar, () => data.listPeople({ q: q || undefined, office, uf, cursor: pagina, limit: POR_PAGINA })).catch(() => null),
  ]);
  const next = new URLSearchParams();
  if (q) next.set("nome", q);
  if (office) next.set("cargo", office);
  // o pedido explícito segue para a próxima página, inclusive o `uf=` vazio ("todos"): sem isso a página 2 cairia no estado do cookie
  if (ufPedida) next.set("uf", uf ?? "");
  if (page?.nextCursor) next.set("pagina", page.nextCursor);
  const filtrou = !!(q || office || uf);
  // Sigla de duas letras que não é de nenhum estado (D327): a tela diz que a sigla não existe, em vez de "nenhuma pessoa".
  // Só dá para afirmar isso com a lista de estados lida; sem ela, a tela segue como antes.
  const ufInexistente = ufPedida && !!uf && ufs !== null && !ufs.some((u) => u.uf === uf) ? uf : null;
  // só o estado guardado filtra a lista: a tela nomeia o estado em vez de dizer "com esses filtros"
  const soEstadoGuardado = ufDoCookie !== null && !q && !office;
  // "ver todos os estados": tira só o estado, mantém nome e cargo
  const todos = new URLSearchParams();
  if (q) todos.set("nome", q);
  if (office) todos.set("cargo", office);
  todos.set("uf", "");
  const n = page?.items.length ?? 0;

  return (
    <div className="sv-pg sv-pg--pps">
      <div className="sv-folio sv-folio--dom">
        <h1>Quem está no cargo?</h1>
        <p className="sv-intro">Quem ocupa cargo eletivo hoje, em ordem alfabética. Procure pelo nome ou filtre por cargo e estado.</p>
      </div>

      {grupoFalhou && (
        <Quadro id="pp-lugar" variante="lacuna" pergunta="Quem são as pessoas deste lugar?" prova={fonte}>
          <Lacuna motivo="As pessoas deste lugar não puderam ser lidas. Abaixo, a lista geral.">{FALHOU_LEITURA}</Lacuna>
        </Quadro>
      )}
      <Quadro id="pp-1" numero={1} pergunta="Quem você procura?">
        {/* key: os campos não são controlados; sem remontar, uma navegação no cliente ("ver todos os estados", "limpar") deixaria o valor antigo no campo */}
        <form key={`${q}|${office ?? ""}|${uf ?? ""}`} className="sv-filtro" action="/pessoas" method="get" role="search" aria-label="Procurar pessoas">
          <label htmlFor="pp-nome">Nome</label>
          <input className="sv-campo" id="pp-nome" name="nome" type="text" defaultValue={q} maxLength={80} autoComplete="off" />
          <label htmlFor="pp-cargo">Cargo</label>
          <select className="sv-campo" id="pp-cargo" name="cargo" defaultValue={office ?? ""}>
            <option value="">Todos os cargos</option>
            {(offices ?? []).map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.nameM}
              </option>
            ))}
          </select>
          <label htmlFor="pp-uf">Estado</label>
          <select className="sv-campo" id="pp-uf" name="uf" defaultValue={uf ?? ""}>
            <option value="">Todos os estados</option>
            {(ufs ?? []).map((u) => (
              <option key={u.ibge} value={u.uf ?? ""}>
                {u.name}
              </option>
            ))}
          </select>
          <span className="sv-filtro__b" aria-hidden="true" />
          <button className="sv-enviar" type="submit">
            Procurar
          </button>
        </form>
        {(!offices || !ufs) && (
          <Lacuna motivo="O filtro fica sem essas opções até a leitura voltar.">
            Não conseguimos ler a lista de {!offices && !ufs ? "cargos e de estados" : !offices ? "cargos" : "estados"} agora.
          </Lacuna>
        )}
        {ufDoCookie ? (
          <p className="sv-t" id="pp-estado">
            A lista abre em {ufDoCookie.nome} ({ufDoCookie.sigla}), o estado guardado em Ajustes.{" "}
            <Link className="sv-lk" href={`/pessoas?${todos.toString()}`}>
              Ver todos os estados
            </Link>
          </p>
        ) : !ufPedida && prefs.ufFalhou ? (
          // há estado guardado, mas ele não pôde ser lido: a lista não abre nele, e a tela diz por quê
          <Lacuna motivo="A lista abaixo é do país inteiro.">Não conseguimos ler o estado guardado agora.</Lacuna>
        ) : (
          !uf &&
          !prefs.uf && (
            <p className="sv-t" id="pp-estado">
              Sem estado escolhido, a lista é do país inteiro. Para ela abrir sempre no seu estado,{" "}
              <Link className="sv-lk" href="/comecar">
                escolha seu estado
              </Link>
              .
            </p>
          )
        )}
        {/* com estado guardado, "limpar" volta ao padrão, que é o estado guardado; só o estado do cookie não é filtro a limpar */}
        {(q || office || (uf && !ufDoCookie)) && (
          <Link className="sv-lk" href="/pessoas">
            Limpar os filtros
          </Link>
        )}
      </Quadro>

      <Quadro
        id="pp-2"
        variante={page && n > 0 ? "padrao" : "lacuna"}
        numero={2}
        pergunta={soEstadoGuardado ? `Quem está no cargo em ${ufDoCookie.nome}, em ordem alfabética?` : filtrou ? "Quem está no cargo, com esses filtros?" : "Quem está no cargo, em ordem alfabética?"}
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: pessoas inventadas para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética. {fonte}
          </>
        }
      >
        {!page ? (
          <Lacuna motivo="A lista de pessoas não pôde ser lida. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
        ) : n === 0 && pagina && page.total > 0 ? (
          <Lacuna motivo={`A lista tem ${fmtInt(page.total)} pessoas.`}>Esta página fica depois do fim da lista.</Lacuna>
        ) : ufInexistente ? (
          <>
            <Lacuna motivo="Nenhuma pessoa foi listada. Escolha um estado no campo acima ou veja todos os estados.">A sigla “{ufInexistente}” não é de nenhum estado.</Lacuna>
            <Link className="sv-lk" href={`/pessoas?${todos.toString()}`}>
              Ver todos os estados <span aria-hidden="true">&nbsp;→</span>
            </Link>
          </>
        ) : n === 0 ? (
          <Lacuna>{filtrou ? "Nenhuma pessoa encontrada com esses filtros." : "Ninguém carregado ainda."}</Lacuna>
        ) : (
          <>
            {paginaInvalida && <p className="sv-t">O endereço pedia uma página que não existe. Mostramos o começo da lista.</p>}
            <Resposta tamanho="m">
              {page.total === 1 ? "1 pessoa" : `${fmtInt(page.total)} pessoas`}
              {soEstadoGuardado ? ` no cargo hoje em ${ufDoCookie.nome}` : filtrou ? " com esses filtros" : " no cargo hoje"}, em ordem alfabética.
            </Resposta>
            {n < page.total && (
              <p className="sv-t">
                Esta página mostra {fmtInt(n)} de {fmtInt(page.total)}.
              </p>
            )}
            <Marcados guardadas={marcacoes.guardadas} pessoas={marcacoes.pessoas} sobrando={marcacoes.sobrando} />
            <ListaPessoas items={page.items} marcados={marcados} porPessoa={marcacoes.porPessoa} />
            {page.nextCursor && (
              <Link className="sv-lk" href={`/pessoas?${next.toString()}`}>
                Próximas {POR_PAGINA} <span aria-hidden="true">→</span>
              </Link>
            )}
            <Nota>Partido: o da filiação vigente quando a fonte a registra; sem esse registro, o do mandato. Nenhuma lista tem ordem de mérito.</Nota>
          </>
        )}
      </Quadro>

      <Selo id="pp-selo" numero={3} lidoEm={lidoEm(stamp)} className="sv-c7" />
      <Proxima href="/acompanhando" pergunta="O que meus escolhidos estão fazendo?" className="sv-c5" />
    </div>
  );
}
