import { NotPublished, SourceFooter } from "@/components/ui/data";
import { data, type YearStats } from "@/lib/data";
import { count, money } from "@/lib/format";
import { LinkChip, Section, hrefWith, type Params } from "./ui";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const pct = (p: number, t: number) => Math.round((p / t) * 100);

/**
 * W1 item 5: presença por mês em gráfico, "{ano} em números" e a tabela ano a ano (da presença à cota).
 * O gráfico é decorativo (aria-hidden); a mesma informação está numa tabela logo atrás dele, para leitor de tela.
 * Ordem das linhas: por ano, nunca por valor.
 */
export async function YearByYear({
  personId,
  yearly,
  year,
  base,
  sp,
  senado,
  presenceReason,
}: {
  personId: string;
  yearly: YearStats[];
  year: number | null;
  base: string;
  sp: Params;
  senado: boolean;
  presenceReason?: string;
}) {
  if (!yearly.length) return null;
  const withData = yearly.filter((y) => y.presenceTotal !== null || y.votesRegistered !== null || y.proposalsPrincipal !== null || y.expensesCents !== null);
  if (!withData.length) return null;
  // ano do gráfico: o escolhido na página, ou o mais recente com dado
  const chosen = year && withData.some((y) => y.year === year) ? year : withData[withData.length - 1].year;
  const row = withData.find((y) => y.year === chosen)!;
  const [months, stamp] = await Promise.all([
    senado ? Promise.resolve([]) : data.getPresenceByMonth(personId, chosen),
    data.getStamp(senado ? "senado.votacoes" : "camara.presenca"),
  ]);
  const presenceCell = (y: YearStats) =>
    y.presenceTotal ? (
      <>
        {pct(y.presencePresent ?? 0, y.presenceTotal)}% <span className="text-xs text-muted">({count(y.presencePresent ?? 0)} de {count(y.presenceTotal)})</span>
      </>
    ) : (
      <NotPublished />
    );

  return (
    <Section id="ano-a-ano" title="Ano a ano" intro="Cada número sai da mesma fonte oficial, ano por ano, desde o primeiro ano carregado.">
      <nav aria-label="Ano do gráfico de presença" className="mb-4">
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {withData.map((y) => (
            <li key={y.year}>
              <LinkChip href={hrefWith(base, sp, { ano: String(y.year), np: undefined, nv: undefined, ng: undefined }, "ano-a-ano")} active={y.year === chosen}>
                {y.year}
              </LinkChip>
            </li>
          ))}
        </ul>
      </nav>

      <h3 className="text-base font-semibold text-fg" id="ano-numeros-h">
        {chosen} em números
      </h3>
      <dl aria-labelledby="ano-numeros-h" className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="ano-em-numeros">
        {[
          ["presença em sessões deliberativas", presenceCell(row)],
          ["propostas como autor(a)", row.proposalsPrincipal === null ? <NotPublished /> : count(row.proposalsPrincipal)],
          ["votos em plenário", row.votesRegistered === null ? <NotPublished /> : count(row.votesRegistered)],
          ["gastos do gabinete (cota)", row.expensesCents === null ? <NotPublished /> : money(row.expensesCents)],
        ].map(([label, v]) => (
          <div key={String(label)} className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-border p-3">
            <dt className="order-2 text-xs text-muted">{label}</dt>
            <dd className="order-1 font-display text-xl tabular text-fg">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <h3 className="text-base font-semibold text-fg">Presença por mês em {chosen}</h3>
        {senado ? (
          <p className="mt-2 rounded-sm bg-surface-sunken px-4 py-3 text-sm text-muted">
            <NotPublished /> {presenceReason ?? "o Senado não publica a lista de presença por senador"}.
          </p>
        ) : months.length === 0 ? (
          <p className="mt-2 rounded-sm bg-surface-sunken px-4 py-3 text-sm text-muted">
            <NotPublished /> nenhuma sessão deliberativa com a pessoa em exercício em {chosen}.
          </p>
        ) : (
          <>
            <div aria-hidden className="mt-3 grid grid-cols-12 items-end gap-1" data-testid="grafico-presenca">
              {MONTHS.map((m, i) => {
                const r = months.find((x) => x.month === i + 1);
                const h = r ? pct(r.present, r.total) : 0;
                return (
                  <div key={m} className="flex min-w-0 flex-col items-center gap-1">
                    <span className="text-[length:var(--ds-text-xs)] leading-none tabular text-muted">{r ? `${h}%` : ""}</span>
                    <div className="flex h-28 w-full items-end rounded-xs bg-surface-sunken">
                      {r && <div className="w-full rounded-xs bg-accent" style={{ height: `${Math.max(h, 2)}%` }} />}
                    </div>
                    <span className="text-[length:var(--ds-text-xs)] leading-none text-muted">{m}</span>
                  </div>
                );
              })}
            </div>
            {/* sr-only no invólucro: tabela ignora width: 1px e alargaria a página no celular */}
            <div className="sr-only">
            <table>
              <caption>Presença em sessões deliberativas por mês, {chosen}</caption>
              <thead>
                <tr>
                  <th scope="col">Mês</th>
                  <th scope="col">Presente</th>
                  <th scope="col">Sessões</th>
                  <th scope="col">Presença</th>
                </tr>
              </thead>
              <tbody>
                {months.map((r) => (
                  <tr key={r.month}>
                    <th scope="row">{MONTHS_LONG[r.month - 1]}</th>
                    <td>{r.present}</td>
                    <td>{r.total}</td>
                    <td>{pct(r.present, r.total)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="mt-2 text-xs text-muted">Mês sem barra: nenhuma sessão deliberativa com a pessoa em exercício. Ausência justificada conta como ausência na fonte.</p>
          </>
        )}
      </div>

      <div className="mt-6">
        <div tabIndex={0} role="region" aria-label="Tabela ano a ano, rolável" className="relative overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-focus">
          <table className="w-full min-w-[560px] text-sm" data-testid="tabela-ano-a-ano">
            <caption className="mb-2 text-left text-base font-semibold text-fg">Da presença à cota, ano por ano</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Ano</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Presença</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">Propostas (autor + coautor)</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">Votos em plenário</th>
                <th scope="col" className="py-2 text-right font-semibold">Cota do gabinete</th>
              </tr>
            </thead>
            <tbody>
              {[...withData].reverse().map((y) => (
                <tr key={y.year} className="border-b border-border last:border-0" aria-current={y.year === chosen ? "true" : undefined}>
                  <th scope="row" className="py-2 pr-3 text-left font-mono font-semibold text-fg">{y.year}</th>
                  <td className="py-2 pr-3 tabular text-fg">{presenceCell(y)}</td>
                  <td className="py-2 pr-3 text-right tabular text-fg">
                    {y.proposalsPrincipal === null ? <NotPublished /> : `${count(y.proposalsPrincipal)} + ${count(y.proposalsCosigned ?? 0)}`}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-fg">{y.votesRegistered === null ? <NotPublished /> : count(y.votesRegistered)}</td>
                  <td className="py-2 text-right whitespace-nowrap tabular text-fg">{y.expensesCents === null ? <NotPublished /> : money(y.expensesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {senado && <p className="mt-2 text-xs text-muted">Presença “—”: {presenceReason ?? "o Senado não publica a lista de presença por senador"}.</p>}
      </div>
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Section>
  );
}
