import type { Metadata } from "next";
import { billLabel, clip, fmtDate, fmtDateTime, fmtWeekday } from "@/components/sv/fmt";
import { Gap, Item, Label, List, Notice, Src, Tabs } from "@/components/sv/ui";
import { data, type PautaEntry } from "@/lib/data";

export const metadata: Metadata = { title: "Decisões" };

const TABS = [
  { key: "pauta", label: "Em pauta", href: "/v2/decisoes" },
  { key: "leis", label: "Viraram lei", href: "/v2/decisoes?aba=leis" },
];

const byDate = (a: PautaEntry, b: PautaEntry) => a.scheduledFor.localeCompare(b.scheduledFor) || a.key.localeCompare(b.key);

function Entries({ items }: { items: PautaEntry[] }) {
  return (
    <List>
      {[...items].sort(byDate).map((e) => (
        <Item
          key={`${e.key}-${e.scheduledFor}-${e.committee ?? ""}`}
          href={`/v2/decisao/${e.key}`}
          title={e.plain ?? clip(e.summary ?? "Resumo não publicado pela fonte", 150)}
          note={`${billLabel(e)}. ${e.body === "camara" ? "Câmara" : "Senado"}${e.committee ? `, comissão ${e.committee}` : ", plenário"}.${e.reviewedAt ? "" : " Explicação ainda não conferida."}`}
          value={fmtWeekday(e.scheduledFor)}
        />
      ))}
    </List>
  );
}

export default async function Decisoes({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const sp = await searchParams;
  const tab = sp.aba === "leis" ? "leis" : "pauta";

  return (
    <>
      <h1 className="sv-title">Decisões</h1>
      <p className="sv-lead sv-mt-2">O que está marcado para ser decidido e o que já virou lei. Proposta não é lei: cada item diz em que etapa está.</p>
      <Tabs items={TABS} current={tab} />
      <div className="sv-mt-4">{tab === "pauta" ? <Pauta /> : <Leis />}</div>
    </>
  );
}

async function Pauta() {
  const o = await data.getPautaOverview().catch(() => null);
  if (!o) {
    return <Notice label="Fonte fora do ar">Não conseguimos ler a pauta agora. Tente de novo em alguns minutos.</Notice>;
  }
  const failed = o.reads.camara.failed + o.reads.senado.failed;
  const total = o.reads.camara.total + o.reads.senado.total;
  return (
    <>
      {failed > 0 && (
        <div style={{ marginBottom: 22 }}>
          <Notice label="Leitura incompleta">
            {failed} de {total} reuniões não carregaram. Pode haver mais decisões do que as mostradas. Última leitura: {fmtDateTime(o.week.readAt)}.
          </Notice>
        </div>
      )}
      <div className="sv-cols is-2">
        <div>
          <Label>No plenário, até {fmtDate(o.week.weekEnds)}</Label>
          {o.plenary.length === 0 ? <Gap>Nenhuma decisão marcada no plenário nesta semana.</Gap> : <Entries items={o.plenary} />}
        </div>
        <div>
          <Label>Em comissão</Label>
          {o.committees.length === 0 ? <Gap>Nenhuma proposta marcada em comissão.</Gap> : <Entries items={o.committees} />}
          <p className="sv-meta sv-mt-2" style={{ fontWeight: 400 }}>
            Comissão é uma etapa. A decisão final costuma vir depois, no plenário.
          </p>
        </div>
      </div>
      {o.exits.length > 0 && (
        <div className="sv-mt-5">
          <Label>Saíram da pauta</Label>
          <List>
            {o.exits.map((e) => (
              <Item key={`${e.key}-${e.leftAt}`} href={`/v2/decisao/${e.key}`} title={e.plain ?? clip(e.summary ?? billLabel(e), 150)} note={`${billLabel(e)}. A fonte não informa o motivo.`} value={fmtDate(e.leftAt)} />
            ))}
          </List>
        </div>
      )}
      <Src>
        Fonte: pauta da Câmara dos Deputados e do Senado Federal{o.week.readAt ? `, lida em ${fmtDateTime(o.week.readAt)}` : ", ainda não lida"}. Hoje mostramos propostas sobre dinheiro, trabalho e benefícios; a regra está em Como funciona.
      </Src>
    </>
  );
}

async function Leis() {
  const laws = await data.listLaws({ limit: 30 });
  return (
    <>
      <Label>Leis sancionadas, da mais recente para a mais antiga</Label>
      {laws.items.length === 0 ? (
        <Gap>Não consta. Nenhuma lei carregada ainda.</Gap>
      ) : (
        <List>
          {laws.items.map((l) => (
            <Item key={l.number} href={l.url ?? undefined} title={clip(l.summary, 170)} note={`Lei ${l.number}${l.proposal ? `, veio de ${l.proposal}` : ""}`} value={fmtDate(l.sanctionedOn)} />
          ))}
        </List>
      )}
      {laws.total > laws.items.length && (
        <p className="sv-meta sv-mt-2">
          Mostrando {laws.items.length} de {laws.total}.
        </p>
      )}
      <Src>Fonte: Câmara dos Deputados, dados abertos.</Src>
    </>
  );
}
