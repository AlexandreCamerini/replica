import { ExternalLink } from "lucide-react";
import { BarBreakdown, SourceFooter, TopicTag, VoteBadge } from "@/components/ui/data";
import { data, type Candidacy, type ElectionResult, type Party, type VoteValue } from "@/lib/data";
import { count, date, money, monthYear } from "@/lib/format";
import { Empty, MoreLink, SelectField, Section, fieldCls, hrefWith, type Params } from "./ui";

const STEP = 20;
const shown = (v: string | undefined) => Math.min(Math.max(Number(v) || STEP, STEP), 500);

type Common = { personId: string; base: string; sp: Params; year: number | null };

function HiddenKeep({ sp, keep }: { sp: Params; keep: string[] }) {
  return (
    <>
      {keep.map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
    </>
  );
}

const FILTER_BTN =
  "h-10 self-end rounded-pill bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export async function Proposals({ personId, base, sp, year, f }: Common & { f: boolean }) {
  const limit = shown(sp.np);
  const type = sp.tipo === "lei" || sp.tipo === "pedido" ? sp.tipo : undefined;
  const role = sp.autoria === "autor" || sp.autoria === "coautor" ? sp.autoria : undefined;
  const [page, topics, stamp] = await Promise.all([
    data.listProposals(personId, { year: year ?? undefined, topic: sp.tema || undefined, type, role, q: sp.busca?.slice(0, 80) || undefined, limit }),
    data.listTopics(),
    data.getStamp("camara.proposicoes"),
  ]);
  const topicName = Object.fromEntries(topics.map((t) => [t.slug, t.name]));
  const filtered = !!(sp.tema || type || role || sp.busca);
  return (
    <Section id="propostas" title="Propostas" count={`${count(page.total)}${year ? ` em ${year}` : ""}`}>
      <form action={`${base}#propostas`} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1fr_2fr_auto]">
        <HiddenKeep sp={sp} keep={["ano", "voto", "vtema", "gcat"]} />
        <SelectField label="Tema" name="tema" value={sp.tema} options={[{ value: "", label: "Todos" }, ...topics.map((t) => ({ value: t.slug, label: t.name }))]} />
        <SelectField label="Tipo" name="tipo" value={type} options={[{ value: "", label: "Todos" }, { value: "lei", label: "Pode virar lei" }, { value: "pedido", label: "Pedidos e requerimentos" }]} />
        <SelectField label="Autoria" name="autoria" value={role} options={[{ value: "", label: "Todas" }, { value: "autor", label: f ? "Autora principal" : "Autor principal" }, { value: "coautor", label: f ? "Coautora" : "Coautor" }]} />
        <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-fg md:col-span-1">
          Buscar no resumo
          <input type="search" name="busca" defaultValue={sp.busca} maxLength={80} className={fieldCls} />
        </label>
        <button type="submit" className={FILTER_BTN}>
          Filtrar
        </button>
      </form>
      {page.items.length === 0 ? (
        <Empty>{filtered ? "Nenhuma proposta com esses filtros." : `Nenhuma proposta registrada${year ? ` em ${year}` : ""}.`}</Empty>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {page.items.map((p) => (
            <li key={p.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="font-mono font-semibold text-fg">
                  {p.type} {p.number}/{p.year}
                </span>
                <time dateTime={p.presentedOn}>{date(p.presentedOn)}</time>
                <span>{p.role === "autor" ? (f ? "autora principal" : "autor principal") : f ? "coautora" : "coautor"}</span>
                <span>· {p.status}</span>
              </div>
              <p className="text-sm text-fg">{p.summary}</p>
              <div className="flex flex-wrap items-center gap-2">
                {p.topics.map((t) => (
                  <TopicTag key={t} href={hrefWith(base, sp, { tema: t, np: undefined }, "propostas")}>
                    {topicName[t]}
                  </TopicTag>
                ))}
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text underline underline-offset-2">
                  ver no site oficial <ExternalLink aria-hidden className="size-3" />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
      <MoreLink href={hrefWith(base, sp, { np: String(limit + STEP) }, "propostas")} remaining={page.total - page.items.length} />
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Section>
  );
}

const VOTE_OPTIONS: { value: VoteValue | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "abstencao", label: "Abstenção" },
  { value: "obstrucao", label: "Obstrução" },
  { value: "nao_votou", label: "Não votou" },
];

export async function Votes({ personId, base, sp, year, body }: Common & { body: "camara" | "senado" }) {
  const limit = shown(sp.nv);
  const value = VOTE_OPTIONS.some((o) => o.value === sp.voto && o.value) ? (sp.voto as VoteValue) : undefined;
  const [page, topics, stamp] = await Promise.all([
    data.listVotes(personId, { year: year ?? undefined, topic: sp.vtema || undefined, value, limit }),
    data.listTopics(),
    data.getStamp(`${body}.votacoes`),
  ]);
  const topicName = Object.fromEntries(topics.map((t) => [t.slug, t.name]));
  // agrupa por mês para a linha do tempo
  const groups: { month: string; items: typeof page.items }[] = [];
  for (const v of page.items) {
    const m = v.event.occurredAt.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === m) last.items.push(v);
    else groups.push({ month: m, items: [v] });
  }
  return (
    <Section id="votos" title="Votos em plenário" count={`${count(page.total)}${year ? ` em ${year}` : ""}`} intro="Só votações nominais: votação simbólica não registra voto de cada pessoa.">
      <form action={`${base}#votos`} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_auto]">
        <HiddenKeep sp={sp} keep={["ano", "tema", "tipo", "autoria", "busca", "gcat"]} />
        <SelectField label="Voto" name="voto" value={value} options={VOTE_OPTIONS} />
        <SelectField label="Tema" name="vtema" value={sp.vtema} options={[{ value: "", label: "Todos" }, ...topics.map((t) => ({ value: t.slug, label: t.name }))]} />
        <button type="submit" className={FILTER_BTN}>
          Filtrar
        </button>
      </form>
      {page.items.length === 0 ? (
        <Empty>{value || sp.vtema ? "Nenhum voto com esses filtros." : `Nenhuma votação nominal${year ? ` em ${year}` : ""}.`}</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.month}>
              <h3 className="mb-2 text-sm font-semibold capitalize text-muted">{monthYear(`${g.month}-01`)}</h3>
              <ol className="flex flex-col divide-y divide-border border-l-2 border-border pl-4">
                {g.items.map((v) => (
                  <li key={v.event.id} className="flex flex-col gap-1.5 py-2.5">
                    <p className="text-sm text-fg">{v.event.description}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="sr-only">Voto:</span>
                      <VoteBadge value={v.value} />
                      <span>
                        Resultado: <span className="font-semibold text-fg">{v.event.result === "aprovado" ? "aprovado" : "rejeitado"}</span> ({count(v.event.yes)} sim · {count(v.event.no)} não)
                      </span>
                      <time dateTime={v.event.occurredAt}>{date(v.event.occurredAt)}</time>
                      <TopicTag>{topicName[v.event.topic]}</TopicTag>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      <MoreLink href={hrefWith(base, sp, { nv: String(limit + STEP) }, "votos")} remaining={page.total - page.items.length} />
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Section>
  );
}

export async function Expenses({ personId, base, sp, year, body }: Common & { body: "camara" | "senado" }) {
  const limit = shown(sp.ng);
  const [page, stamp] = await Promise.all([
    data.listExpenses(personId, { year: year ?? undefined, category: sp.gcat || undefined, limit }),
    data.getStamp(`${body}.despesas`),
  ]);
  const total = page.byCategory.reduce((s, c) => s + c.cents, 0);
  return (
    <Section id="gastos" title="Gastos do gabinete" count={money(total)} intro={`Cota para exercício do mandato${year ? ` em ${year}` : ", toda a carreira"}. Valores negativos são estornos publicados pela fonte.`}>
      {page.byCategory.length === 0 ? (
        <Empty>Nenhum gasto registrado{year ? ` em ${year}` : ""}.</Empty>
      ) : (
        <>
          <BarBreakdown caption="Por categoria" rows={page.byCategory.slice(0, 8)} />
          <form action={`${base}#gastos`} className="mt-6 mb-3 flex flex-wrap items-end gap-3">
            <HiddenKeep sp={sp} keep={["ano", "tema", "tipo", "autoria", "busca", "voto", "vtema"]} />
            <SelectField label="Categoria" name="gcat" value={sp.gcat} options={[{ value: "", label: "Todas" }, ...page.byCategory.map((c) => ({ value: c.label, label: c.label }))]} />
            <button type="submit" className={FILTER_BTN}>
              Filtrar
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Lançamentos, do mais recente ao mais antigo</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">Data</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Categoria</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Fornecedor</th>
                  <th scope="col" className="py-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap tabular text-muted">{date(e.occurredOn)}</td>
                    <td className="py-2 pr-3 text-fg">{e.category}</td>
                    <td className="py-2 pr-3 text-fg">{e.supplier}</td>
                    <td className="py-2 text-right whitespace-nowrap tabular text-fg">{money(e.amountCents, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreLink href={hrefWith(base, sp, { ng: String(limit + STEP) }, "gastos")} remaining={page.total - page.items.length} />
        </>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Section>
  );
}

type C = Candidacy & { party: Party; officeName: string; placeLabel: string };

export async function Assets({ candidacies }: { candidacies: C[] }) {
  const rows = candidacies.filter((c) => c.assetsCents !== null).sort((a, b) => a.year - b.year);
  const stamp = await data.getStamp("tse.bens");
  const max = Math.max(...rows.map((r) => r.assetsCents!), 1);
  return (
    <Section id="patrimonio" title="Patrimônio declarado" intro="O que a pessoa declarou ao TSE a cada candidatura. É autodeclaração, sem auditoria.">
      {rows.length === 0 ? (
        <Empty>Nenhuma declaração de bens publicada.</Empty>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Patrimônio declarado por ano de eleição</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Ano</th>
              <th scope="col">Proporção</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <th scope="row" className="w-14 py-1.5 pr-3 text-left font-mono font-semibold text-fg">
                  {r.year}
                </th>
                <td className="w-full py-1.5">
                  <div aria-hidden className="h-3 rounded-xs bg-surface-sunken">
                    <div className="h-3 rounded-xs bg-accent" style={{ width: `${(r.assetsCents! / max) * 100}%` }} />
                  </div>
                </td>
                <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular text-fg">{money(r.assetsCents!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Section>
  );
}

const RESULT: Record<ElectionResult, [string, string]> = {
  eleito: ["Eleito", "Eleita"],
  eleito_qp: ["Eleito por quociente partidário", "Eleita por quociente partidário"],
  eleito_media: ["Eleito por média", "Eleita por média"],
  suplente: ["Suplente", "Suplente"],
  nao_eleito: ["Não eleito", "Não eleita"],
};

export async function Elections({ candidacies, f }: { candidacies: C[]; f: boolean }) {
  const stamp = await data.getStamp("tse.candidatos");
  return (
    <Section id="eleicoes" title="Eleições disputadas" count={String(candidacies.length)}>
      {candidacies.length === 0 ? (
        <Empty>Nenhuma candidatura encontrada no TSE.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Ano</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Cargo</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Partido</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Resultado</th>
                <th scope="col" className="py-2 text-right font-semibold">Votos</th>
              </tr>
            </thead>
            <tbody>
              {candidacies.map((c) => (
                <tr key={`${c.year}-${c.office}`} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-mono font-semibold text-fg">{c.year}</th>
                  <td className="py-2 pr-3 text-fg">
                    {c.officeName} · {c.placeLabel}
                  </td>
                  <td className="py-2 pr-3 text-fg">{c.party.acronym}</td>
                  <td className="py-2 pr-3 text-fg">{RESULT[c.result][f ? 1 : 0]}</td>
                  <td className="py-2 text-right tabular text-fg">{count(c.votes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Section>
  );
}
