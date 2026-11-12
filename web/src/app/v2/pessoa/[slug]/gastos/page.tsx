import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { fmtDate, fmtInt } from "@/components/sv/fmt";
import { rotuloGastos } from "@/components/sv/mandato";
import { ESFERA } from "@/components/sv/pessoa/cargos";
import { carregarPessoa, contextoPessoa, inteiroPositivo, MOTIVO_COTA, texto } from "@/components/sv/pessoa/contexto";
import { brl, hojeBR, ler, statusLacuna } from "@/components/sv/pessoa/format";
import { Falha, Linha, Sem, SemCobertura, TabelaGastos, vmGastos } from "@/components/sv/pessoa/secoes";
import { CabecalhoSub, Paginacao } from "@/components/sv/pessoa/sub";
import { Lacuna, Nota, Selo } from "@/components/sv/ui";
import { data } from "@/lib/data";

// Gastos detalhados (nota por nota) da cota ou verba do gabinete. Ordem cronológica, da mais recente para a mais antiga;
// nunca por valor. Categorias em ordem alfabética. Fornecedor como a fonte publica, sem acréscimo.

const POR = 50;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await carregarPessoa((await params).slug);
  return { title: r ? `Gastos do gabinete · ${r.person.displayName}` : "Pessoa não encontrada" };
}

/** Só link http(s) da fonte vira link. */
const linkSeguro = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

/** A casa lança o gasto no dia 1 do mês quando só o mês é fato (Assembleias, câmaras): então mostra mm/aaaa. */
const soMes = (datas: string[]) => datas.length > 0 && datas.every((d) => /^\d{4}-\d{2}-01/.test(d));

export default async function GastosPessoa({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await carregarPessoa(slug);
  if (!r) notFound();
  if (r.redirectTo) permanentRedirect(`/v2/pessoa/${r.redirectTo}/gastos`);
  const ctx = await contextoPessoa(r.person);
  const id = ctx.person.id;
  const hoje = hojeBR();
  const rotulo = rotuloGastos(ctx.office);

  // anos do mandato (mais recente primeiro); sem leitura, o ano corrente e o anterior
  const anosR = await ler(data.getActiveYears(id));
  const anos = anosR.ok && anosR.v.length > 0 ? [...anosR.v].sort((a, b) => b - a) : [hoje.ano, hoje.ano - 1];
  const anoPedido = inteiroPositivo(sp.ano);
  const pagina = inteiroPositivo(sp.pagina) ?? 1;
  const catPedida = texto(sp.categoria);

  // ano padrão: o mais recente com nota (o ano corrente pode estar vazio no começo do ano)
  const lerAno = (ano: number, categoria: string | null) => ler(data.listExpenses(id, { year: ano, category: categoria ?? undefined, limit: POR, cursor: String((pagina - 1) * POR) }));
  let ano = anoPedido && anos.includes(anoPedido) ? anoPedido : anos[0];
  let res = ctx.legis && !ctx.posse ? await lerAno(ano, null) : null;
  if (!anoPedido && res && res.ok && res.v.byCategory.length === 0 && anos[1] !== undefined) {
    const r2 = await lerAno(anos[1], null);
    if (r2.ok && r2.v.byCategory.length > 0) {
      ano = anos[1];
      res = r2;
    }
  }
  // categoria só vale se existe no ano; inválida cai em "todas"
  const cats = res && res.ok ? [...res.v.byCategory].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")) : [];
  const categoria = catPedida && cats.some((c) => c.label === catPedida) ? catPedida : null;
  if (categoria && res && res.ok) res = await lerAno(ano, categoria);

  const sGastos = await ctx.stampDe(ctx.body ? `${ctx.body}.despesas` : null);
  const [stats, refresh] = await Promise.all([ler(data.getStats(id, "career")), ler(data.latestRefresh())]);
  const st = statusLacuna(stats.ok ? stats.v.missing : [], "gastos_gabinete");

  const v = res && res.ok ? res.v : null;
  const temDado = !!v && v.byCategory.length > 0;
  const vm = v ? vmGastos(v.byCategory, ano) : null;
  const itens = v?.items ?? [];
  const mes = soMes(itens.map((e) => e.occurredOn));
  const forma = ctx.main ? ESFERA[ctx.main.office] : null;
  const base = `/v2/pessoa/${ctx.person.slug}/gastos`;
  // nota sem carimbo da casa do mandato (fora da esfera federal e cobertura não lida): a origem não é afirmada
  const semOrigem = temDado && !sGastos && ctx.cob("gastos")?.estado !== "lido";

  return (
    <div className="sv-pg sv-pg--pessoa">
      <CabecalhoSub ctx={ctx} titulo={`Gastos do gabinete de ${ctx.person.displayName}`} esfera={forma} />

      <Linha id="g1" numero={1} pergunta={`Quanto gastou em ${ano}, por categoria?`} fonte={ctx.fonteConjunto("gastos", rotulo, sGastos, temDado)}>
        {vm ? (
          <div className="sv-bloco">
            <TabelaGastos vm={vm} />
            <Nota>
              <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo> Categorias em ordem alfabética. Valores negativos são estornos publicados pela fonte.
            </Nota>
          </div>
        ) : ctx.posse ? (
          <Sem motivo={ctx.posse} />
        ) : res && !res.ok ? (
          <Falha />
        ) : !ctx.legis ? (
          <SemCobertura cob={ctx.cob("gastos")} oQue="gasto do gabinete" motivo={MOTIVO_COTA} />
        ) : ctx.cob("gastos")?.estado === "lido" ? (
          <SemCobertura cob={ctx.cob("gastos")} oQue={`nota de gasto em ${ano}`} />
        ) : (
          <SemCobertura cob={ctx.cob("gastos")} oQue="gasto do gabinete" status={st.status} motivo={st.motivo ?? (ctx.body === "senado" ? "O Senado tem verba própria, com outra fonte." : null)} />
        )}
      </Linha>

      {temDado && v && (
        <Linha id="g2" numero={2} pergunta="Nota por nota" fonte={ctx.fonteConjunto("gastos", rotulo, sGastos, true)}>
          <div className="sv-bloco">
            <form className="sv-form-d2 sv-filtro" action={base} method="get" aria-label="Filtrar as notas">
              <label className="sv-sub" htmlFor="g-ano">
                Ano
              </label>
              <select className="sv-campo" id="g-ano" name="ano" defaultValue={String(ano)}>
                {anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <label className="sv-sub" htmlFor="g-cat">
                Categoria (em ordem alfabética)
              </label>
              <select className="sv-campo" id="g-cat" name="categoria" defaultValue={categoria ?? ""}>
                <option value="">Todas as categorias</option>
                {cats.map((c) => (
                  <option key={c.label} value={c.label}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="sv-enviar">
                Filtrar
              </button>
              {catPedida && !categoria && <Nota>A categoria pedida não tem nota em {ano}. Mostrando todas.</Nota>}
            </form>
            {itens.length > 0 ? (
              <>
                <ul className="sv-notas" aria-label={`Notas de ${ano}${categoria ? `, ${categoria}` : ""}, da mais recente para a mais antiga`}>
                  {itens.map((e) => {
                    const url = linkSeguro(e.receiptUrl);
                    const quando = mes ? fmtDate(e.occurredOn).slice(3) : fmtDate(e.occurredOn);
                    return (
                      <li key={e.id}>
                        <p className="sv-notas__d">
                          {quando} · {e.category}
                        </p>
                        <p className="sv-notas__f">{e.supplier && e.supplier !== "—" ? e.supplier : <Lacuna>A fonte não publicou o fornecedor.</Lacuna>}</p>
                        <p className="sv-notas__v">
                          {brl(e.amountCents)}
                          {e.amountCents < 0 && <span className="sv-sm">Estorno publicado pela fonte.</span>}
                        </p>
                        {url && (
                          <p className="sv-notas__l">
                            <a href={url} rel="noopener noreferrer">
                              Documento na fonte<span className="sv-vh"> da nota de {quando}</span>
                            </a>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Paginacao
                  base={base}
                  params={{ ano: String(ano), categoria }}
                  pagina={pagina}
                  por={POR}
                  total={v.total}
                  nome={{ um: "nota", varios: "notas" }}
                  ordem="da mais recente para a mais antiga"
                />
                {mes && <Nota>A fonte lança cada gasto no primeiro dia do mês: só o mês é informado.</Nota>}
                {semOrigem && <Nota>Estas notas estão ligadas a esta pessoa, mas a leitura não registra de que casa vieram: podem ser de outro mandato.</Nota>}
                <Nota>Fornecedor como a fonte publica. O link leva ao documento oficial quando a fonte o publica.</Nota>
              </>
            ) : (
              <>
                <Lacuna motivo={`Há ${fmtInt(v.total)} ${v.total === 1 ? "nota" : "notas"} neste filtro, em ${fmtInt(Math.max(1, Math.ceil(v.total / POR)))} ${Math.ceil(v.total / POR) === 1 ? "página" : "páginas"}.`}>Esta página da lista não existe.</Lacuna>
                <p className="sv-selo__l">
                  <Link href={`${base}?${new URLSearchParams({ ano: String(ano), ...(categoria ? { categoria } : {}) }).toString()}`}>Voltar à primeira página</Link>
                </p>
              </>
            )}
          </div>
        </Linha>
      )}

      <Selo lidoEm={refresh.ok ? refresh.v : null} />
    </div>
  );
}
