import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { LinkChip, Notice, qs, TableRegion } from "@/components/page/w4";
import { SourceFooter } from "@/components/ui/data";
import { data } from "@/lib/data";
import { money } from "@/lib/format";

export const metadata: Metadata = {
  title: "Impostos",
  description: "Quanto a União arrecadou, por estado e por mês, nos dados abertos da Receita Federal.",
};
export const dynamic = "force-dynamic";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dec = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Valor curto (R$ 12,3 bi / R$ 450,0 mi) com o exato no title; centavos de real na entrada. */
function Brl({ cents }: { cents: number }) {
  const reais = cents / 100;
  const short = Math.abs(reais) >= 1e9 ? `R$ ${dec.format(reais / 1e9)} bi` : Math.abs(reais) >= 1e6 ? `R$ ${dec.format(reais / 1e6)} mi` : money(cents);
  return <data value={cents} title={money(cents, true)}>{short}</data>;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { years, lastMonth } = await data.listTaxYears();
  const year = years.find((y) => y === Number(one(sp.ano))) ?? years[0];
  const stamp = await data.getStamp("receita.arrecadacao");
  if (year === undefined) {
    return (
      <Container>
        <PageHeader title="Impostos" lead="Arrecadação federal por estado e por mês." />
        <p className="text-muted"><span aria-hidden>—</span> Ainda não carregamos a arrecadação. Fonte: Receita Federal, dados abertos.</p>
      </Container>
    );
  }
  const byUf = await data.getTaxByUf(year);
  const ufSel = byUf.find((u) => u.uf === one(sp.uf));
  const months = await data.getTaxByMonth(year, ufSel?.uf);
  const lines = await data.getTaxLines(year, ufSel?.uf);
  const total = byUf.reduce((s, u) => s + u.totalCents, 0);
  const last = lastMonth[year] ?? 12;
  const scope = ufSel ? ufSel.ufName : "Brasil";
  const lineTotal = lines.reduce((s, l) => s + l.totalCents, 0);

  return (
    <Container>
      <PageHeader
        title="Impostos"
        lead="Quanto a União arrecadou em tributos federais, por estado e por mês. É o que a Receita Federal publica; não é gasto e não é quanto cada morador pagou."
      />

      <nav aria-label="Ano" className="mb-4 flex flex-wrap gap-2" data-testid="anos">
        {years.map((y) => (
          <LinkChip key={y} href={`/impostos${qs({ ano: y, uf: ufSel?.uf })}`} current={y === year}>{y}</LinkChip>
        ))}
      </nav>

      <section aria-labelledby="tot-h" className="rounded-md border border-border bg-surface p-4">
        <h2 id="tot-h" className="text-sm font-semibold text-muted">
          Arrecadação federal em {year}{last < 12 ? `, de janeiro a ${MONTHS[last - 1]}` : ""}
        </h2>
        <p className="font-display text-hero tabular text-fg" data-testid="total-ano">
          <Brl cents={total} />
        </p>
        <p className="text-sm text-muted">Soma dos 27 estados (Distrito Federal incluído). Valores nominais, sem correção pela inflação.</p>
      </section>

      <section aria-labelledby="uf-h" className="mt-8">
        <h2 id="uf-h" className="mb-3 font-display text-2xl text-fg">Por estado em {year}</h2>
        <TableRegion label="Arrecadação por estado">
          <table className="w-full min-w-[26rem] border-collapse text-left text-sm" data-testid="por-uf">
            <caption className="sr-only">Arrecadação federal por estado em ordem alfabética</caption>
            <thead className="bg-surface-sunken text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Estado</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Arrecadado no ano</th>
              </tr>
            </thead>
            <tbody>
              {byUf.map((u) => (
                <tr key={u.uf} data-uf={u.uf} aria-current={u.uf === ufSel?.uf ? "true" : undefined} className={`border-t border-border ${u.uf === ufSel?.uf ? "bg-surface-sunken" : ""}`}>
                  <th scope="row" className="px-3 py-2 font-semibold">
                    <Link href={`/impostos${qs({ ano: year, uf: u.uf })}#mes-h`} className="text-accent-text underline underline-offset-2">{u.ufName}</Link>
                    <span className="text-muted"> · {u.uf}</span>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums"><Brl cents={u.totalCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </section>

      <section aria-labelledby="mes-h" className="mt-10">
        <h2 id="mes-h" className="mb-1 font-display text-2xl text-fg">Por mês · {scope} · {year}</h2>
        {ufSel && (
          <p className="mb-2 text-sm">
            <Link href={`/impostos${qs({ ano: year })}`} className="font-semibold text-accent-text underline underline-offset-2">Ver o Brasil inteiro</Link>
          </p>
        )}
        <TableRegion label={`Arrecadação por mês, ${scope}`}>
          <table className="w-full min-w-[22rem] border-collapse text-left text-sm" data-testid="por-mes">
            <caption className="sr-only">Arrecadação federal mês a mês, {scope}, {year}</caption>
            <thead className="bg-surface-sunken text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Mês</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Arrecadado</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m, i) => {
                const v = months.find((x) => x.month === i + 1);
                return (
                  <tr key={m} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 font-semibold capitalize">{m}</th>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {v ? <Brl cents={v.totalCents} /> : (
                        <span className="text-muted" title="o mês ainda não foi publicado pela Receita">
                          <span aria-hidden>—</span>
                          <span className="sr-only">o mês ainda não foi publicado pela Receita</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      </section>

      <section aria-labelledby="trib-h" className="mt-10">
        <details>
          <summary id="trib-h" className="cursor-pointer rounded-xs font-display text-2xl text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
            Por tributo · {scope} · {year}
          </summary>
          <TableRegion label={`Arrecadação por tributo, ${scope}`}>
            <table className="mt-3 w-full min-w-[26rem] border-collapse text-left text-sm" data-testid="por-tributo">
              <caption className="sr-only">Tributos como a Receita os nomeia, em ordem alfabética</caption>
              <thead className="bg-surface-sunken text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Tributo (nome da Receita)</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Arrecadado no ano</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.tax} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 font-normal">{l.tax}</th>
                    <td className="px-3 py-2 text-right tabular-nums"><Brl cents={l.totalCents} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-sunken">
                  <th scope="row" className="px-3 py-2 font-semibold">Soma dos tributos</th>
                  <td className="px-3 py-2 text-right tabular-nums"><Brl cents={lineTotal} /></td>
                </tr>
              </tfoot>
            </table>
          </TableRegion>
        </details>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Notice title="O que “por estado” quer dizer" id="regra">
          <p>
            A Receita registra cada tributo no estado onde ele foi <strong>recolhido</strong>, em geral a sede da empresa. Por isso um estado com muitas sedes aparece com
            mais, mesmo que o consumo e o trabalho estejam em outro lugar. Não é “quanto os moradores pagaram” nem “quanto voltou para o estado”.
          </p>
          <p>Não mostramos ranking nem valor por habitante; a lista é alfabética.</p>
        </Notice>
        <Notice title="De onde vêm os números">
          <p>
            Cada tributo é uma coluna do arquivo da Receita e entra com o nome dela. Onde um tributo vem dividido em partes (COFINS, PIS/Pasep, CSLL, receita
            previdenciária), conferimos que o total e as partes nunca aparecem juntos, para não somar em dobro.
          </p>
          <p>
            Só aparecem anos a partir de <strong>2013</strong>: antes disso o arquivo não traz a receita previdenciária e o total não seria comparável. Mês vazio é mês
            que a Receita ainda não publicou.
          </p>
        </Notice>
      </section>

      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Container>
  );
}
