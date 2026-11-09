import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { BarBreakdown, NotPublished, SourceFooter, TopicTag, VoteBadge } from "@/components/ui/data";
import { CAMPAIGN_ORIGINS, data, type Amendment, type CampaignFinance, type Candidacy, type ElectionResult, type OfficeSlug, type Party, type SalaryAccrued, type SalaryStep, type VoteValue } from "@/lib/data";
import { count, date, money, monthYear } from "@/lib/format";
import { GlossaryFor } from "@/components/ui/glossary";
import { AskSource, BLOCOS } from "./ask-source";
import { correctCents, ipcaOf } from "./ipca";
import { Empty, LinkChip, MoreLink, SelectField, Section, fieldCls, hrefWith, type Params } from "./ui";

const STEP = 20;
// emendas de plenário/comissão (D38): não viram lei sozinhas; o tipo vem da casa, o rótulo é nosso
const EMENDA = new Set(["EMC", "EMP", "EMR", "ESB"]);
const shown = (v: string | undefined) => Math.min(Math.max(Number(v) || STEP, STEP), 500);

type Common = {
  personId: string;
  base: string;
  sp: Params;
  year: number | null;
  /** motivo, quando o dado consta como não carregado: mostra "—", nunca "nenhum" */
  notLoaded?: string;
  /** U02: /sugestoes?tipo=fonte&p=…&cidade=… (de askSourceHref). Só vem quando falta fonte de verdade, não quando a carga está na fila. */
  askHref?: string;
  /** U05: termos do glossário que outro bloco da mesma tela já explica (ids de ui/glossary) */
  skipGloss?: string[];
};

function NotLoaded({ reason, ask }: { reason: string; ask?: { href: string; bloco: keyof typeof BLOCOS } }) {
  return (
    <>
      <Empty>
        <span aria-label="não carregado">—</span> Ainda não carregado: {reason}.
      </Empty>
      {ask && <AskSource href={ask.href} bloco={ask.bloco} />}
    </>
  );
}

function HiddenKeep({ sp, keep }: { sp: Params; keep: string[] }) {
  return (
    <>
      {keep.map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
    </>
  );
}

const FILTER_BTN =
  "h-10 self-end rounded-pill bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** stamp: carimbo de outra casa (W3-A, ex.: "alesp.proposicoes"); onlyBills: a casa só tem projetos carregados (sem pedidos nem emendas). */
export async function Proposals({ personId, base, sp, year, f, body = "camara", notLoaded, askHref, stamp: stampDataset, onlyBills = false }: Common & { f: boolean; body?: "camara" | "senado"; stamp?: string; onlyBills?: boolean }) {
  if (notLoaded)
    return (
      <Section id="propostas" title="Propostas">
        <NotLoaded reason={notLoaded} ask={askHref ? { href: askHref, bloco: "propostas" } : undefined} />
      </Section>
    );
  const limit = shown(sp.np);
  const type = sp.tipo === "lei" || sp.tipo === "pedido" || sp.tipo === "emenda" ? sp.tipo : undefined;
  const role = sp.autoria === "autor" || sp.autoria === "coautor" ? sp.autoria : undefined;
  const [page, topics, stamp] = await Promise.all([
    data.listProposals(personId, { year: year ?? undefined, topic: sp.tema || undefined, type, role, q: sp.busca?.slice(0, 80) || undefined, limit }),
    data.listTopics(),
    data.getStamp(stampDataset ?? (body === "senado" ? "senado.autorias" : "camara.proposicoes")),
  ]);
  const topicName = Object.fromEntries(topics.map((t) => [t.slug, t.name]));
  const filtered = !!(sp.tema || type || role || sp.busca);
  return (
    <Section id="propostas" title="Propostas" count={`${count(page.total)}${year ? ` em ${year}` : ""}`}>
      <form action={`${base}#propostas`} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1fr_2fr_auto]">
        <HiddenKeep sp={sp} keep={["ano", "voto", "vtema", "gcat", "vtipo"]} />
        <SelectField label="Tema" name="tema" value={sp.tema} options={[{ value: "", label: "Todos" }, ...topics.map((t) => ({ value: t.slug, label: t.name }))]} />
        <SelectField
          label="Tipo"
          name="tipo"
          value={type}
          options={
            onlyBills
              ? [{ value: "", label: "Todos" }, { value: "lei", label: "Pode virar lei" }, { value: "pedido", label: "Resolução e decreto legislativo" }]
              : [{ value: "", label: "Todos" }, { value: "lei", label: "Pode virar lei" }, { value: "pedido", label: "Pedidos e requerimentos" }, { value: "emenda", label: "Emendas" }]
          }
        />
        <SelectField label="Autoria" name="autoria" value={role} options={[{ value: "", label: "Todas" }, { value: "autor", label: f ? "Autora principal" : "Autor principal" }, { value: "coautor", label: f ? "Coautora" : "Coautor" }]} />
        <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-fg md:col-span-1">
          Buscar no resumo
          <input type="search" name="busca" defaultValue={sp.busca} maxLength={80} className={fieldCls} />
        </label>
        <button type="submit" className={FILTER_BTN}>
          Filtrar
        </button>
      </form>
      <GlossaryFor texts={page.items.map((p) => `${p.type} ${p.summary}`)} className="mb-4" />
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
                {EMENDA.has(p.type) && <span className="rounded-pill bg-surface-sunken px-2 py-0.5 font-semibold text-fg">emenda</span>}
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
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
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

export async function Votes({ personId, base, sp, year, body, notLoaded, askHref, skipGloss }: Common & { body: "camara" | "senado" }) {
  if (notLoaded)
    return (
      <Section id="votos" title="Votos em plenário">
        <NotLoaded reason={notLoaded} ask={askHref ? { href: askHref, bloco: "votos" } : undefined} />
      </Section>
    );
  const limit = shown(sp.nv);
  const value = VOTE_OPTIONS.some((o) => o.value === sp.voto && o.value) ? (sp.voto as VoteValue) : undefined;
  // U11: o padrão é só o que muda lei; `vtipo=tudo` na URL mostra também requerimento e procedimento
  const everything = sp.vtipo === "tudo";
  const [page, topics, stamp, secret] = await Promise.all([
    data.listVotes(personId, { year: year ?? undefined, topic: sp.vtema || undefined, value, limit, scope: everything ? "tudo" : "lei" }),
    data.listTopics(),
    data.getStamp(`${body}.votacoes`),
    body === "senado" ? data.countSecretVotes(personId, year ?? undefined) : Promise.resolve(0),
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
      <GlossaryFor texts={page.items.map((v) => v.event.description)} skip={skipGloss} className="mb-4" />
      <nav aria-label="Que votações mostrar" className="mb-2">
        <ul className="flex flex-wrap gap-2">
          <li>
            <LinkChip tall href={hrefWith(base, sp, { vtipo: undefined, nv: undefined }, "votos")} active={!everything}>
              Só o que muda lei
            </LinkChip>
          </li>
          <li>
            <LinkChip tall href={hrefWith(base, sp, { vtipo: "tudo", nv: undefined }, "votos")} active={everything}>
              Tudo
            </LinkChip>
          </li>
        </ul>
      </nav>
      <p className="mb-4 text-sm text-muted" data-testid="votos-regra">
        {everything
          ? "Mostrando tudo, inclusive pedido de urgência e requerimento."
          : page.hidden > 0
            ? `${count(page.hidden)} ${page.hidden === 1 ? "votação de requerimento ou urgência está escondida" : "votações de requerimento ou urgência estão escondidas"}.`
            : "Nenhuma votação de requerimento ou urgência escondida."}{" "}
        <Link href="/como-escolhemos#votos-lei" className="underline underline-offset-2">
          A regra
        </Link>
      </p>
      <form action={`${base}#votos`} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_auto]">
        <HiddenKeep sp={sp} keep={["ano", "tema", "tipo", "autoria", "busca", "gcat", "vtipo"]} />
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
                        Resultado:{" "}
                        <span className="font-semibold text-fg">{v.event.result === "aprovado" ? "aprovado" : v.event.result === "rejeitado" ? "rejeitado" : "não informado"}</span>
                        {v.event.yes + v.event.no > 0 && ` (${count(v.event.yes)} sim · ${count(v.event.no)} não)`}
                      </span>
                      <time dateTime={v.event.occurredAt}>{date(v.event.occurredAt)}</time>
                      {v.event.topic && topicName[v.event.topic] && <TopicTag>{topicName[v.event.topic]}</TopicTag>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {secret > 0 && (
        <p className="mt-3 rounded-sm bg-surface-sunken px-4 py-3 text-sm text-fg" data-testid="votos-secretos">
          Mais {count(secret)} {secret === 1 ? "votação secreta" : "votações secretas"}
          {year ? ` em ${year}` : " no período carregado"} (escolha de autoridades e embaixadores, por exemplo). Nelas o Senado publica só o resultado, não o voto de cada
          senador: não aparecem acima e não contam como ausência.
        </p>
      )}
      <MoreLink href={hrefWith(base, sp, { nv: String(limit + STEP) }, "votos")} remaining={page.total - page.items.length} />
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

/** stamp/intro: carimbo e texto de outra casa (W3-A: verba de gabinete ou indenizatória da Assembleia). */
export async function Expenses({ personId, base, sp, year, body, notLoaded, askHref, stamp: stampDataset, title = "Gastos do gabinete", intro: introText }: Common & { body: "camara" | "senado"; stamp?: string; title?: string; intro?: string }) {
  if (notLoaded)
    return (
      <Section id="gastos" title={title}>
        <NotLoaded reason={notLoaded} ask={askHref ? { href: askHref, bloco: "gastos" } : undefined} />
      </Section>
    );
  const limit = shown(sp.ng);
  const [page, stamp] = await Promise.all([
    data.listExpenses(personId, { year: year ?? undefined, category: sp.gcat || undefined, limit }),
    data.getStamp(stampDataset ?? `${body}.despesas`),
  ]);
  const total = page.byCategory.reduce((s, c) => s + c.cents, 0);
  return (
    <Section id="gastos" title={title} count={money(total)} intro={`${introText ?? "Cota para exercício do mandato"}${year ? ` em ${year}` : ", toda a carreira"}. Valores negativos são estornos publicados pela fonte.`}>
      {page.byCategory.length === 0 ? (
        <Empty>Nenhum gasto registrado{year ? ` em ${year}` : ""}.</Empty>
      ) : (
        <>
          <BarBreakdown caption="Por categoria" rows={page.byCategory.slice(0, 8)} />
          <form action={`${base}#gastos`} className="mt-6 mb-3 flex flex-wrap items-end gap-3">
            <HiddenKeep sp={sp} keep={["ano", "tema", "tipo", "autoria", "busca", "voto", "vtema", "vtipo"]} />
            <SelectField label="Categoria" name="gcat" value={sp.gcat} options={[{ value: "", label: "Todas" }, ...page.byCategory.map((c) => ({ value: c.label, label: c.label }))]} />
            <button type="submit" className={FILTER_BTN}>
              Filtrar
            </button>
          </form>
          <div tabIndex={0} role="region" aria-label="Lançamentos de gastos" className="relative overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-focus">
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
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

type C = Candidacy & { party: Party; officeName: string; placeLabel: string };

export async function Assets({ candidacies }: { candidacies: C[] }) {
  const rows = candidacies.filter((c) => c.assetsCents !== null).sort((a, b) => a.year - b.year);
  const [stamp, ind] = await Promise.all([data.getStamp("tse.bens"), rows.length > 1 ? data.listYearlyIndicators() : Promise.resolve(null)]);
  const ipca = ind ? ipcaOf(ind.rows) : null;
  const ref = ind?.refs.find((r) => r.key === "ipca_acumulado")?.seriesRefs[0];
  // nominal e corrigido de cada declaração; variação sempre em R$ (nunca em %), entre declarações vizinhas
  const view = rows.map((r) => ({ year: r.year, nominal: r.assetsCents!, fixed: ipca ? correctCents(r.assetsCents!, r.year, ipca) : null }));
  const steps = view.slice(1).map((v, i) => {
    const prev = view[i];
    return { from: prev.year, to: v.year, nominal: v.nominal - prev.nominal, fixed: v.fixed !== null && prev.fixed !== null ? v.fixed - prev.fixed : null };
  });
  const signed = (c: number) => `${money(Math.abs(c))} ${c < 0 ? "a menos" : "a mais"}`;
  return (
    <Section id="patrimonio" title="Patrimônio declarado" intro="O que a pessoa declarou ao TSE a cada candidatura. É autodeclaração, sem auditoria.">
      {rows.length === 0 ? (
        <Empty>Nenhuma declaração de bens publicada.</Empty>
      ) : (
        <>
          <div tabIndex={0} role="region" aria-label="Patrimônio declarado por eleição" className="relative overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-focus">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">Patrimônio declarado por ano de eleição, em valor nominal{ipca ? " e corrigido pelo IPCA" : ""}</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">Eleição</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Declarado na época</th>
                  {ipca && <th scope="col" className="py-2 text-right font-semibold">Em reais de dez/{ipca.lastYear}</th>}
                </tr>
              </thead>
              <tbody>
                {view.map((v) => (
                  <tr key={v.year} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-mono font-semibold text-fg">{v.year}</th>
                    <td className="py-2 pr-3 text-right whitespace-nowrap tabular text-fg">{money(v.nominal)}</td>
                    {ipca && <td className="py-2 text-right whitespace-nowrap tabular text-fg">{v.fixed === null ? <NotPublished /> : money(v.fixed)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {steps.length > 0 && (
            <div className="mt-4" data-testid="patrimonio-variacao">
              <h3 className="text-sm font-semibold text-fg">Variação entre uma declaração e a seguinte</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-fg">
                {steps.map((st) => (
                  <li key={st.to}>
                    <span className="font-mono font-semibold">{st.from} a {st.to}:</span> {signed(st.nominal)} em valor nominal
                    {st.fixed !== null && <>; {signed(st.fixed)} corrigido pela inflação</>}.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ipca && (
            <div className="mt-4 max-w-[65ch] text-sm text-muted" data-testid="patrimonio-ipca">
              <p>Corrigido pela inflação (IPCA, o índice oficial do IBGE).</p>
              <p>Cada valor é refeito em reais de dez/{ipca.lastYear}. Usamos o IPCA de dezembro a dezembro, dos anos depois da declaração.</p>
              <p>O ano da eleição fica de fora. {rows.some((r) => r.year >= ipca.lastYear) && "Declaração recente não muda: ainda não há IPCA fechado depois dela."}</p>
              {ref && <p className="mt-1 font-mono text-xs">IPCA: {ref}.</p>}
            </div>
          )}
        </>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

const RESULT: Record<ElectionResult, [string, string]> = {
  eleito: ["Eleito", "Eleita"],
  eleito_qp: ["Eleito por quociente partidário", "Eleita por quociente partidário"],
  eleito_media: ["Eleito por média", "Eleita por média"],
  suplente: ["Suplente", "Suplente"],
  nao_eleito: ["Não eleito", "Não eleita"],
  segundo_turno: ["Foi ao 2º turno", "Foi ao 2º turno"],
  indeferido: ["Candidatura indeferida", "Candidatura indeferida"],
  renuncia: ["Renunciou à candidatura", "Renunciou à candidatura"],
};

export async function Elections({ candidacies, f }: { candidacies: C[]; f: boolean }) {
  const [stamp, loaded] = await Promise.all([data.getStamp("tse.candidatos"), data.listStampYears("tse.candidatos")]);
  return (
    <Section id="eleicoes" title="Eleições disputadas" count={String(candidacies.length)}>
      {candidacies.length === 0 ? (
        loaded.length ? (
          <Empty>Nenhuma candidatura encontrada no TSE nas eleições de {loaded[0]} a {loaded[loaded.length - 1]} (as que já carregamos).</Empty>
        ) : (
          <NotLoaded reason="as candidaturas do TSE ainda não foram carregadas" />
        )
      ) : (
        <div tabIndex={0} role="region" aria-label="Eleições disputadas" className="relative overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-focus">
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
              {candidacies.map((c, i) => (
                <tr key={`${c.year}-${c.office}-${c.placeIbge}-${i}`} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-mono font-semibold text-fg">{c.year}</th>
                  <td className="py-2 pr-3 text-fg">
                    {c.officeName} · {c.placeLabel}
                  </td>
                  <td className="py-2 pr-3 text-fg">{c.party.acronym}</td>
                  <td className="py-2 pr-3 text-fg">{((c.result && RESULT[c.result]) ?? ["Sem resultado publicado", "Sem resultado publicado"])[f ? 1 : 0]}</td>
                  <td className="py-2 text-right tabular text-fg">{c.votes === null ? <NotPublished /> : count(c.votes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

// ---------- seções R2: leis, comissões, discursos, contato, custo, dados ainda não carregados ----------

export async function Laws({ personId, f }: { personId: string; f: boolean }) {
  const [laws, stamp, loaded] = await Promise.all([data.getLaws(personId), data.getStamp("camara.proposicoes"), data.listStampYears("camara.proposicoes")]);
  const win = loaded.length ? `de ${loaded[0]} a ${loaded[loaded.length - 1]}` : "carregadas";
  return (
    <Section id="leis" title="Leis que vieram de propostas" count={String(laws.length)} intro={`Propostas com ${f ? "ela" : "ele"} entre os autores que viraram norma publicada no Diário Oficial.`}>
      {laws.length === 0 ? (
        <Empty>Nenhuma proposta de autoria virou lei entre as propostas {win === "carregadas" ? "carregadas" : `apresentadas ${win}`}.</Empty>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {laws.map((l) => (
            <li key={l.number} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="font-semibold text-fg">{l.number}</span>
                <time dateTime={l.sanctionedOn}>publicada em {date(l.sanctionedOn)}</time>
                <span>
                  veio do {l.proposal} · {l.role === "autor" ? (f ? "autora principal" : "autor principal") : f ? "coautora" : "coautor"}
                </span>
              </div>
              <p className="text-sm text-fg">{l.summary}</p>
              {l.url && (
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-accent-text underline underline-offset-2">
                  texto da lei <ExternalLink aria-hidden className="size-3" />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

export async function Committees({ personId }: { personId: string }) {
  const [rows, stamp] = await Promise.all([data.getCommittees(personId), data.getStamp("parlamento.extras")]);
  const today = new Date().toISOString().slice(0, 10);
  const now = rows.filter((r) => !r.to || r.to >= today);
  const before = rows.filter((r) => r.to && r.to < today);
  const item = (r: (typeof rows)[number], i: number) => (
    <li key={`${r.name}-${r.role}-${r.from}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border py-2 text-sm last:border-0">
      <span className="text-fg">
        {r.acronym && <span className="font-mono text-xs font-semibold">{r.acronym} · </span>}
        {r.name}
      </span>
      <span className="text-xs text-muted">
        {r.role} · desde {date(r.from)}
        {r.to && r.to < today ? ` até ${date(r.to)}` : ""}
      </span>
    </li>
  );
  return (
    <Section id="comissoes" title="Comissões" count={String(now.length)} intro="Onde as propostas são discutidas antes do plenário. Titular vota; suplente substitui.">
      {rows.length === 0 ? (
        <Empty>Nenhuma participação em comissão registrada pela casa no período carregado.</Empty>
      ) : (
        <>
          {now.length > 0 && <ul>{now.map(item)}</ul>}
          {before.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-fg">Participações encerradas ({before.length})</summary>
              <ul className="mt-2">{before.map(item)}</ul>
            </details>
          )}
        </>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

export async function Speeches({ personId, base, sp, year }: Common) {
  const limit = Math.min(Math.max(Number(sp.nd) || 10, 10), 200);
  const [page, stamp] = await Promise.all([data.listSpeeches(personId, { year: year ?? undefined, limit }), data.getStamp("parlamento.extras")]);
  return (
    <Section id="discursos" title="Discursos" count={`${count(page.total)}${year ? ` em ${year}` : ""}`} intro="Resumo oficial publicado pela casa. O texto integral fica no site oficial.">
      {page.items.length === 0 ? (
        <Empty>Nenhum discurso registrado{year ? ` em ${year}` : " no período carregado"}.</Empty>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {page.items.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 py-3">
              <time dateTime={s.occurredAt} className="text-xs text-muted">
                {date(s.occurredAt)}
              </time>
              <p className="text-sm text-fg">{s.summary ?? "Sem resumo publicado."}</p>
              {s.url && (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-accent-text underline underline-offset-2">
                  íntegra no site oficial <ExternalLink aria-hidden className="size-3" />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      <MoreLink href={hrefWith(base, sp, { nd: String(limit + 10) }, "discursos")} remaining={page.total - page.items.length} />
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

const CONTACT_LABEL: Record<string, string> = {
  email: "E-mail",
  telefone: "Telefone",
  gabinete: "Gabinete",
  site: "Página oficial",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  outra_rede: "Outra rede",
};

export async function Contact({ personId }: { personId: string }) {
  const [rows, stamp] = await Promise.all([data.getContacts(personId), data.getStamp("parlamento.extras")]);
  const href = (k: string, v: string) => (k === "email" ? `mailto:${v}` : k === "telefone" ? `tel:${v.replace(/[^\d+]/g, "")}` : /^https?:\/\//.test(v) ? v : null);
  return (
    <Section id="contato" title="Contato oficial" intro="Canais que a própria casa publica. Redes sociais pessoais só quando a casa as lista.">
      {rows.length === 0 ? (
        <Empty>A casa não publica contato para este mandato, ou ele ainda não foi carregado.</Empty>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {rows.map((c, i) => {
            const h = href(c.kind, c.value);
            return (
              <div key={`${c.kind}-${i}`} className="contents">
                <dt className="text-muted">{CONTACT_LABEL[c.kind]}</dt>
                <dd className="min-w-0 break-words text-fg">
                  {h ? (
                    <a href={h} {...(h.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="underline underline-offset-2">
                      {c.value}
                    </a>
                  ) : (
                    c.value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

/** Ato que institui a cota da Câmara (CEAP), conferido no texto oficial em 09/11/2026: Ato da Mesa nº 43, de 21/5/2009, hoje em texto consolidado
 * (alterado por atos posteriores, p. ex. nº 270/2023 e nº 246/2026; os valores por estado estão no Anexo). Senado: ato ainda não conferido. */
const ATO_COTA: Partial<Record<"camara" | "senado", { text: string; href: string }>> = {
  camara: { text: "Ato da Mesa nº 43, de 21/5/2009 (texto consolidado)", href: "https://www2.camara.leg.br/legin/int/atomes/2009/atodamesa-43-21-maio-2009-588364-normaatualizada-cd-mesa.html" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <dt className="min-w-0 text-fg">{label}</dt>
      <dd className="shrink-0 text-right tabular font-semibold text-fg">{children}</dd>
    </div>
  );
}
function Ato({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-xs text-muted">
      <span className="font-semibold text-fg">Ato legal:</span> {children}
    </p>
  );
}

/**
 * U12. Quanto custa o mandato: salário, cota (teto e gasto separados), verba de gabinete e moradia, cada um com o ato legal.
 * Valor sem fonte no banco não aparece: vira "—" com o motivo. O que o banco tem: degraus do subsídio (salaries, com o ato na fonte),
 * gasto da cota (expenses) e reajuste com data futura (selo). Teto da cota, verba de gabinete e auxílio-moradia ainda não estão carregados.
 */
export function MandateCost({
  body,
  schedule,
  salaryMonthlyCents,
  accrued,
  months,
  expensesCents,
  periodLabel,
}: {
  body: "camara" | "senado";
  schedule: SalaryStep[];
  salaryMonthlyCents: number | null;
  accrued?: SalaryAccrued | null;
  months: number;
  expensesCents: number | null;
  periodLabel: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const paid = schedule.filter((x) => !x.isCeiling);
  const current = [...paid].reverse().find((x) => x.validFrom <= today) ?? null;
  // reajuste com data futura: está na lei, mas ainda não vale. Fica de fora de toda soma.
  const pending = paid.filter((x) => x.validFrom > today);
  const monthly = current?.amountCents ?? salaryMonthlyCents;
  // com a série do subsídio carregada, soma mês a mês com o valor de cada época; sem ela, a aproximação (valor de hoje × meses)
  const salary = accrued ? accrued.cents : salaryMonthlyCents !== null ? salaryMonthlyCents * months : null;
  const total = salary !== null && expensesCents !== null ? salary + expensesCents : null;
  const ato = ATO_COTA[body];
  return (
    <Section id="custo" title={`Quanto custa o mandato · ${periodLabel}`} intro="Cada item mostra o que a fonte publica e o ato que o fixa. Onde não há valor carregado, aparece “—” e o motivo.">
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="custo-itens">
        <li className="border border-border p-4" data-item="salario">
          <h3 className="text-base font-semibold text-fg">Salário</h3>
          <dl className="mt-1 text-sm">
            <Row label="Por mês, bruto">{monthly === null ? <NotPublished /> : money(monthly, true)}</Row>
            <Row label={accrued ? "Recebido no período" : "No período (aproximado)"}>{salary === null ? <NotPublished /> : money(salary)}</Row>
          </dl>
          {!accrued && salary !== null && <p className="mt-1 text-xs text-muted">{months} {months === 1 ? "mês" : "meses"} × o valor mensal de hoje; reajustes anteriores eram menores.</p>}
          {accrued && accrued.coveredMonths < accrued.months && (
            <p className="mt-1 text-xs text-muted">Faltam {accrued.months - accrued.coveredMonths} meses sem valor carregado; eles não entram na soma.</p>
          )}
          {pending.map((x) => (
            <p key={x.validFrom} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg" data-testid="reajuste-pendente">
              <span className="stamp text-warning">Reajuste ainda não vale</span>
              {money(x.amountCents, true)} por mês a partir de {date(x.validFrom)}. Não entra nas somas.
            </p>
          ))}
          {current ? (
            <Ato>
              <a href={current.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {current.source.name}
              </a>
              , valor vigente desde {date(current.validFrom)}.
            </Ato>
          ) : (
            <Ato>ainda não conferido.</Ato>
          )}
        </li>
        <li className="border border-border p-4" data-item="cota">
          <h3 className="text-base font-semibold text-fg">Cota para exercício do mandato</h3>
          <dl className="mt-1 text-sm">
            <Row label="Teto por mês">
              <NotPublished />
            </Row>
            <Row label="Gasto no período">{expensesCents === null ? <NotPublished /> : money(expensesCents)}</Row>
          </dl>
          <p className="mt-1 text-xs text-muted">O teto de cada estado ainda não está no site. O gasto é o que a casa reembolsou.</p>
          <Ato>
            {ato ? (
              <a href={ato.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {ato.text}
              </a>
            ) : (
              "ainda não conferido."
            )}
          </Ato>
        </li>
        <li className="border border-border p-4" data-item="verba">
          <h3 className="text-base font-semibold text-fg">Verba de gabinete</h3>
          <dl className="mt-1 text-sm">
            <Row label="Verba por mês">
              <NotPublished />
            </Row>
          </dl>
          <p className="mt-1 text-xs text-muted">Ainda não está carregado: nem o valor da verba nem a folha de cada pessoa.</p>
          <Ato>ainda não conferido.</Ato>
        </li>
        <li className="border border-border p-4" data-item="moradia">
          <h3 className="text-base font-semibold text-fg">Auxílio-moradia</h3>
          <dl className="mt-1 text-sm">
            <Row label="Valor por mês">
              <NotPublished />
            </Row>
          </dl>
          <p className="mt-1 text-xs text-muted">Ainda não está carregado.</p>
          <Ato>ainda não conferido.</Ato>
        </li>
      </ul>
      <p className="mt-4 text-sm text-fg" data-testid="custo-soma">
        <span className="font-semibold">Soma do que está carregado</span> (salário e gasto da cota no período):{" "}
        <span className="font-display text-xl tabular">{total === null ? <NotPublished /> : money(total)}</span>
      </p>
      <p className="mt-1 text-xs text-muted">Não inclui verba de gabinete nem moradia, que ainda não têm valor no site.</p>
    </Section>
  );
}

export function NotLoadedYet({ items }: { items: { what: string; why: string }[] }) {
  return (
    <section aria-labelledby="pendentes-h" className="rounded-md border border-dashed border-border-input bg-surface p-4 md:p-6">
      <h2 id="pendentes-h" className="text-lg text-fg">
        Ainda não está aqui
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {items.map((i) => (
          <li key={i.what}>
            <span className="font-semibold text-fg">{i.what}:</span> <span className="text-muted">{i.why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Ouvidorias conferidas em 03/11/2026 (HTTP 200). Só canal oficial da casa ou do governo; nada de rede pessoal.
const OUVIDORIA: Partial<Record<OfficeSlug, { name: string; url: string; what: string }>> = {
  deputado_federal: { name: "Ouvidoria Parlamentar da Câmara dos Deputados", url: "https://www.camara.leg.br/ouvidoria", what: "recebe reclamação, denúncia, sugestão e pedido de informação sobre deputados e a Câmara" },
  senador: { name: "Ouvidoria do Senado Federal", url: "https://www12.senado.leg.br/institucional/ouvidoria", what: "recebe reclamação, denúncia, sugestão e pedido de informação sobre senadores e o Senado" },
  presidente: { name: "Fala.BR (Controladoria-Geral da União)", url: "https://falabr.cgu.gov.br/", what: "canal único de ouvidoria e de acesso à informação do Poder Executivo federal" },
  vice_presidente: { name: "Fala.BR (Controladoria-Geral da União)", url: "https://falabr.cgu.gov.br/", what: "canal único de ouvidoria e de acesso à informação do Poder Executivo federal" },
};
const LOCAL_HOUSE: Partial<Record<OfficeSlug, string>> = {
  deputado_estadual: "da Assembleia Legislativa",
  deputado_distrital: "da Câmara Legislativa do DF",
  vereador: "da Câmara Municipal",
  governador: "do governo do estado",
  vice_governador: "do governo do estado",
  prefeito: "da prefeitura",
  vice_prefeito: "da prefeitura",
};

/** W1 item 11b: como cobrar = escrever ao gabinete (contato oficial) + ouvidoria da casa. "—" com motivo quando não conferimos. */
export function HowToReach({ office, hasContact, f }: { office: OfficeSlug; hasContact: boolean; f: boolean }) {
  const ouv = OUVIDORIA[office];
  return (
    <Section id="como-cobrar" title="Como cobrar" intro="Canais oficiais para pedir explicação, reclamar ou sugerir. A resposta é obrigação do órgão, não favor.">
      <ol className="flex flex-col gap-3 text-sm">
        <li className="flex flex-col gap-0.5">
          <span className="font-semibold text-fg">1. Escreva ao gabinete</span>
          {hasContact ? (
            <span className="text-muted">
              Use o e-mail ou o telefone em{" "}
              <a href="#contato" className="font-semibold text-fg underline underline-offset-2">
                Contato oficial
              </a>
              . Diga quem você é, de onde escreve e o que pede {f ? "a ela" : "a ele"}; guarde a data do envio.
            </span>
          ) : (
            <span className="text-muted">
              <span aria-label="não carregado">—</span> a casa não publica contato deste mandato, ou ele ainda não foi carregado.
            </span>
          )}
        </li>
        <li className="flex flex-col gap-0.5" data-testid="ouvidoria">
          <span className="font-semibold text-fg">2. Sem resposta? Procure a ouvidoria</span>
          {ouv ? (
            <span className="text-muted">
              <a href={ouv.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-text underline underline-offset-2">
                {ouv.name} <ExternalLink aria-hidden className="size-3" />
                <span className="sr-only">(abre em nova aba)</span>
              </a>
              : {ouv.what}.
            </span>
          ) : (
            <span className="text-muted">
              <span aria-label="não conferido">—</span> ainda não conferimos o canal de ouvidoria {LOCAL_HOUSE[office] ?? "deste órgão"}; procure no site oficial dele. Se souber o
              endereço,{" "}
              <Link href="/sugestoes?tipo=dado" className="font-semibold text-fg underline underline-offset-2">
                conte para a gente
              </Link>
              .
            </span>
          )}
        </li>
      </ol>
    </Section>
  );
}

/** W2 item 13: de onde veio e com o que gastou, por eleição. Categorias oficiais do TSE; nenhum nome de doador. */
export async function CampaignMoney({ personId }: { personId: string }) {
  const [rows, stamp, loaded] = await Promise.all([data.getCampaignFinance(personId), data.getStamp("tse.contas"), data.listStampYears("tse.contas")]);
  const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);
  return (
    <Section
      id="campanha"
      title="Dinheiro das campanhas"
      count={rows.length ? `${rows.length} ${rows.length === 1 ? "eleição" : "eleições"}` : undefined}
      intro="De onde veio e com o que foi gasto, por eleição, nas categorias da prestação de contas ao TSE. Despesa = valor pago. Doações de pessoas aparecem só somadas, sem nome."
    >
      {rows.length === 0 ? (
        loaded.length ? (
          <Empty>
            Nenhuma prestação de contas encontrada no TSE nas eleições de {loaded[0]} a {loaded[loaded.length - 1]} (as que já carregamos).
          </Empty>
        ) : (
          <NotLoaded reason="a prestação de contas do TSE ainda não foi carregada" />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((c, i) => (
            <details key={c.year} open={i === 0} className="group rounded-sm border border-border p-3" data-testid={`campanha-${c.year}`}>
              <summary className="cursor-pointer text-sm font-semibold text-fg">
                {c.year} · {c.officeName} · {c.placeLabel}
                <span className="ml-2 font-normal tabular text-muted">
                  entrou {money(sum(c.income))} · saiu {money(sum(c.spending))}
                </span>
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2">
                {c.income.length ? <BarBreakdown caption="De onde veio" rows={c.income} /> : <Empty>Nenhuma receita publicada.</Empty>}
                {c.spending.length ? <BarBreakdown caption="Com o que gastou" rows={c.spending.slice(0, 10)} /> : <Empty>Nenhuma despesa publicada.</Empty>}
              </div>
              {c.spending.length > 10 && <p className="mt-2 text-xs text-muted">Mais {c.spending.length - 10} categorias menores somam {money(sum(c.spending.slice(10)))}.</p>}
              {c.origins.length > 0 && <CampaignOrigins origins={c.origins} donors={c.donors} year={c.year} />}
            </details>
          ))}
        </div>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}

/** Catálogo D11: composição da receita por origem, em ordem fixa (nunca pela maior parte). Fundo público e privado
 *  ficam lado a lado, sem destaque; doador com nome só partido ou pessoa jurídica (pessoa física só somada, D36). */
function CampaignOrigins({ origins, donors, year }: { origins: CampaignFinance["origins"]; donors: CampaignFinance["donors"]; year: number }) {
  const total = origins.reduce((s, o) => s + o.cents, 0);
  const label = new Map(CAMPAIGN_ORIGINS.map((o) => [o.origin, o.label]));
  const named = [...donors].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (
    <div className="mt-4 border-t border-border pt-3" data-testid={`campanha-origem-${year}`}>
      <h4 className="text-sm font-semibold text-fg">Por origem do dinheiro</h4>
      <p className="mt-1 text-xs text-muted">Fundo Eleitoral e Fundo Partidário são dinheiro público repassado pelo partido. Total: {money(total)}.</p>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {origins.map((o) => (
            <tr key={o.origin} className="border-b border-border last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg">{label.get(o.origin) ?? o.origin}</th>
              <td className="py-1.5 text-right tabular whitespace-nowrap text-fg">{money(o.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {named.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted">Partidos e pessoas jurídicas que doaram ({named.length}), A–Z</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {named.map((d) => (
              <li key={`${d.kind}:${d.name}`} className="flex justify-between gap-3">
                <span className="text-fg">{d.name} <span className="text-xs text-muted">· {d.kind === "partido" ? "partido" : "pessoa jurídica"}</span></span>
                <span className="tabular whitespace-nowrap text-fg">{money(d.cents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const AMENDMENT_KIND: Record<Amendment["kind"], string> = {
  individual: "individual",
  individual_pix: "individual, transferência especial (“Pix”)",
  bancada: "de bancada",
  comissao: "de comissão",
  relator: "de relator",
  outro: "outro tipo",
};

/** Catálogo D02: os três estágios lado a lado, porque o pago anda meses atrás do empenhado. Ordem: ano desc, destino A–Z. */
/** Soma de um estágio; null quando alguma emenda não tem o valor publicado (somar como 0 subcontaria: "—" com nota). */
function stageSum(rows: Amendment[], k: "committedCents" | "liquidatedCents" | "paidCents"): number | null {
  return rows.some((r) => r[k] == null) ? null : rows.reduce((s, r) => s + (r[k] ?? 0), 0);
}
const cents = (v: number | null) => (v == null ? "—" : money(v));

function AmendmentTotals({ rows }: { rows: Amendment[] }) {
  const stages = [
    ["reservado (empenhado)", stageSum(rows, "committedCents")],
    ["despesa reconhecida (liquidado)", stageSum(rows, "liquidatedCents")],
    ["pago", stageSum(rows, "paidCents")],
  ] as const;
  return (
    <>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {stages.map(([label, v]) => (
          <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="tabular font-semibold text-fg">{cents(v)}</dd></div>
        ))}
      </dl>
      {stages.some(([, v]) => v == null) && <p className="mt-1 text-xs text-muted">“—”: a fonte não publicou esse valor em pelo menos uma emenda do ano. Somar daria um total menor que o real.</p>}
    </>
  );
}

export async function Amendments({ personId, cityIbge, title = "Emendas que mandou" }: { personId?: string; cityIbge?: string; title?: string }) {
  const [rows, stamp, loaded] = await Promise.all([
    personId ? data.listAmendmentsByPerson(personId) : cityIbge ? data.listAmendmentsToPlace(cityIbge) : Promise.resolve([] as Amendment[]),
    data.getStamp("transparencia.emendas"),
    data.listStampYears("transparencia.emendas"),
  ]);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  return (
    <Section
      id="emendas"
      title={title}
      count={rows.length ? `${count(rows.length)} ${rows.length === 1 ? "emenda" : "emendas"}` : undefined}
      intro="Emenda é dinheiro do Orçamento da União que cada parlamentar indica para um lugar ou uma área. Empenhado é o dinheiro reservado; pago é o que saiu."
    >
      {!loaded.length ? (
        <NotLoaded reason="as emendas vêm do Portal da Transparência, que exige chave de acesso; a carga começa quando a chave for configurada" />
      ) : rows.length === 0 ? (
        <Empty>{personId ? "Nenhuma emenda com esta autoria" : "Nenhuma emenda com destino nesta cidade"} nos anos carregados ({loaded[0]} a {loaded[loaded.length - 1]}).</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {years.map((y, i) => {
            const ys = rows.filter((r) => r.year === y);
            return (
              <details key={y} open={i === 0} className="rounded-sm border border-border p-3" data-testid={`emendas-${y}`}>
                <summary className="cursor-pointer text-sm font-semibold text-fg">{y} · {count(ys.length)} {ys.length === 1 ? "emenda" : "emendas"}</summary>
                <div className="mt-3"><AmendmentTotals rows={ys} /></div>
                <ul className="mt-3 flex flex-col divide-y divide-border text-sm">
                  {ys.map((r, j) => (
                    <li key={j} className="py-2">
                      <p className="text-fg">
                        {personId ? (
                          r.place ? <Link href={`/representantes?cidade=${r.place.ibge}`} className="underline underline-offset-2">{r.place.name}{r.place.uf ? ` (${r.place.uf})` : ""}</Link> : (r.localityLabel ?? "destino não informado")
                        ) : r.authorSlug ? <Link href={`/p/${r.authorSlug}`} className="underline underline-offset-2">{r.authorLabel}</Link> : r.authorLabel}
                        {r.area && <span className="text-muted"> · {r.area}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        emenda {AMENDMENT_KIND[r.kind]} · empenhado {cents(r.committedCents)} · pago {cents(r.paidCents)}
                        {personId && !r.place && r.placeNote ? ` · ${r.placeNote}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
          <p className="text-xs text-muted">Emenda “Pix” (transferência especial) vai direto para o caixa da prefeitura ou do estado, sem objeto detalhado na fonte.</p>
        </div>
      )}
      {/* sem carga não há data: o carimbo de reserva (época 0) não pode virar "atualizado em 1969" */}
      {loaded.length > 0 && <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />}
    </Section>
  );
}

/** W2 item 14: equipe do gabinete. Câmara: secretários parlamentares (nome e nível). Senado: "—" com motivo. A–Z. */
export async function Staff({ personId, body }: { personId: string; body: "camara" | "senado" }) {
  if (body === "senado")
    return (
      <Section id="equipe" title="Equipe do gabinete">
        <NotLoaded reason="o Senado publica a lotação dos comissionados sem um vínculo estável com cada senador; ainda não ligamos as duas coisas" />
      </Section>
    );
  const [rows, stamp] = await Promise.all([data.listStaff(personId), data.getStamp("camara.equipe")]);
  const paid = rows.filter((r) => r.monthlySalaryCents !== null);
  return (
    <Section
      id="equipe"
      title="Equipe do gabinete"
      count={rows.length ? `${count(rows.length)} ${rows.length === 1 ? "pessoa" : "pessoas"}` : undefined}
      intro="Secretários parlamentares lotados no gabinete, como a Câmara publica. O nível (SP01 a SP25) define a faixa salarial do cargo."
    >
      {rows.length === 0 ? (
        <Empty>A Câmara não lista ninguém no gabinete deste mandato na data da última carga.</Empty>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2" data-testid="equipe">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border py-1.5 text-sm">
                <span className="min-w-0 break-words text-fg">{r.name}</span>
                <span className="shrink-0 text-xs text-muted">{r.role?.replace(/^Secretário parlamentar /, "") ?? "—"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted" data-testid="equipe-salario">
            {paid.length ? (
              `Salários somados: ${money(paid.reduce((s, r) => s + r.monthlySalaryCents!, 0))} por mês.`
            ) : (
              <>
                Salário de cada pessoa: <span aria-label="não carregado">—</span> o arquivo de lotação não traz remuneração; a folha mensal da Câmara é outra
                fonte, que ainda não carregamos. Lista de {date(rows[0].asOf)}.
              </>
            )}
          </p>
        </>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Section>
  );
}
