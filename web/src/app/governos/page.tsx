import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/page/page-header";
import { Dash, Notice, TableRegion } from "@/components/page/w4";
import { SourceFooter } from "@/components/ui/data";
import { data } from "@/lib/data";
import type { IndicatorKey } from "@/lib/data";
import { date } from "@/lib/format";
import { isPartialYear, presidentsOfYear, TERMS } from "@/lib/governos";

export const metadata: Metadata = {
  title: "Governos",
  description: "Quem foi presidente desde 1985 e, ano a ano, PIB, inflação, juros e desemprego de fontes oficiais abertas.",
};
export const dynamic = "force-dynamic";

const FIRST = 1985;
const num = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: "negative" });

const COLS: { key: IndicatorKey; head: string; sub: string }[] = [
  { key: "pib_variacao", head: "PIB", sub: "variação real, % no ano" },
  { key: "ipca_acumulado", head: "Inflação (IPCA)", sub: "% acumulado em dezembro, 12 meses" },
  { key: "selic_meta_fim_ano", head: "Selic", sub: "meta, % ao ano, em 31/12" },
  { key: "desemprego_media", head: "Desemprego", sub: "% da força de trabalho, taxa média anual (IBGE)" },
];

/** Motivo do “—” de cada coluna e ano. A regra é a mesma publicada na seção “Como cada número é feito”. */
function why(key: IndicatorKey, year: number, current: number): string {
  if (year >= current) return `${year} ainda não terminou; a fonte só fecha o ano depois`;
  if (key === "pib_variacao" && year < 1996) return "a série anual do IBGE que usamos começa em 1996";
  if (key === "selic_meta_fim_ano" && year < 1999) return "a meta da Selic definida pelo Copom só existe desde março de 1999";
  if (key === "desemprego_media" && year < 2012) return "a PNAD Contínua, que mede o desemprego, começa em 2012";
  return "a fonte não publicou ou ainda não carregamos este valor";
}

export default async function Page() {
  const { rows } = await data.listYearlyIndicators();
  const stamp = await data.getStamp("governos.indicadores");
  const current = new Date().getFullYear();
  const by = new Map(rows.map((r) => [r.year, r.values]));
  const years = Array.from({ length: current - FIRST + 1 }, (_, i) => FIRST + i);

  return (
    <Container>
      <PageHeader
        title="Governos"
        lead="Quem ocupou a Presidência desde 1985 e, ao lado, como andaram quatro números da economia ano a ano. Os números não são nota de ninguém: muita coisa os move além de quem governa."
      />

      <section aria-labelledby="man-h">
        <h2 id="man-h" className="mb-3 font-display text-2xl text-fg">Mandatos presidenciais</h2>
        <ol className="grid gap-3 md:grid-cols-2" data-testid="mandatos">
          {TERMS.map((t) => (
            <li key={t.slug} data-term={t.slug} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
              <h3 className="text-base font-semibold text-fg">{t.name}</h3>
              <p className="tabular-nums text-sm text-fg">
                <time dateTime={t.start}>{date(t.start)}</time> a {t.end ? <time dateTime={t.end}>{date(t.end)}</time> : "em curso"}
              </p>
              <p className="text-sm text-muted">{t.how}</p>
              <p className="text-sm text-muted">{t.note}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">
          Datas conforme a Presidência da República (galeria de ex-presidentes) e o TSE. Em ano de troca, a tabela abaixo lista todos que exerceram o cargo.
        </p>
      </section>

      <section aria-labelledby="ind-h" className="mt-10">
        <h2 id="ind-h" className="mb-3 font-display text-2xl text-fg">Ano a ano</h2>
        <TableRegion label="Indicadores por ano e presidente">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm" data-testid="indicadores">
            <caption className="sr-only">Presidente e indicadores econômicos de cada ano, do mais antigo ao mais recente</caption>
            <thead className="bg-surface-sunken text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Ano</th>
                <th scope="col" className="px-3 py-2 font-semibold">Presidente no ano</th>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2 text-right font-semibold">
                    {c.head}
                    <span className="block font-normal">{c.sub}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const ps = presidentsOfYear(y);
                const v = by.get(y) ?? {};
                return (
                  <tr key={y} data-year={y} className="border-t border-border align-top">
                    <th scope="row" className="px-3 py-2 tabular-nums">{y}</th>
                    <td className="px-3 py-2">
                      {ps.map((p, i) => (
                        <span key={p.slug} className="block">
                          {p.name}
                          {ps.length > 1 && isPartialYear(p, y) ? <span className="text-muted"> ({i === 0 ? "até" : "a partir de"} {date(i === 0 ? p.end! : p.start).slice(0, 5)})</span> : null}
                        </span>
                      ))}
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right tabular-nums" data-ind={c.key}>
                        {v[c.key] !== undefined ? num.format(v[c.key]!) : <Dash why={why(c.key, y, current)} />}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      </section>

      <section aria-labelledby="regra-h" className="mt-10 grid gap-4 md:grid-cols-2">
        <Notice title="Como cada número é feito" id="como">
          <p id="regra-h"><strong>PIB:</strong> variação anual do volume, IBGE (Contas Nacionais, SIDRA tabela 6784, de 1996). Onde a tabela anual ainda não chegou, o 4º trimestre acumulado em quatro trimestres (tabela 5932), que pode ser revisado.</p>
          <p><strong>Inflação:</strong> IPCA acumulado em 12 meses até dezembro, IBGE (SIDRA 1737), desde 1980.</p>
          <p><strong>Selic:</strong> meta definida pelo Copom que vigorava em 31 de dezembro, Banco Central (SGS 432), desde março de 1999.</p>
          <p><strong>Desemprego:</strong> taxa de desocupação da PNAD Contínua, IBGE (SIDRA 10379), taxa média anual publicada pelo IBGE, desde 2012. Não é a média simples dos quatro trimestres: a média simples de 2024 daria 6,85, e o IBGE publica 6,6.</p>
          <p>Ano em andamento fica em “—” até a fonte fechar. Valores nominais, sem ajuste; nenhum é média por mandato.</p>
        </Notice>
        <Notice title="O que esta tabela não faz">
          <p>Não soma, não compara mandatos e não diz quem foi melhor. Juros, inflação e emprego respondem a decisões de muitos governos, ao mundo e ao que veio antes.</p>
          <p>Antes de 1996 (PIB), 1999 (Selic) e 2012 (desemprego) o “—” é falta de série comparável nas fontes que usamos, não zero.</p>
        </Notice>
      </section>

      <SourceFooter source={`${stamp.source} e Banco Central (SGS)`} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Container>
  );
}
