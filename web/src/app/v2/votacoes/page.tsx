import type { Metadata } from "next";
import Link from "next/link";
import { clip, fmtDate, fmtInt } from "@/components/sv/fmt";
import { Gap, Item, Label, List, Src, Tabs } from "@/components/sv/ui";
import { data, type Body } from "@/lib/data";

export const metadata: Metadata = { title: "Votações" };

const RESULT = { aprovado: "aprovado", rejeitado: "rejeitado" } as const;

export default async function Votacoes({ searchParams }: { searchParams: Promise<{ casa?: string; tudo?: string; n?: string }> }) {
  const sp = await searchParams;
  const body: Body = sp.casa === "senado" ? "senado" : "camara";
  const everything = sp.tudo === "1";
  const shown = Math.min(200, Math.max(30, Number.parseInt(sp.n ?? "30", 10) || 30));

  const page = await data.listVotingEvents({ body, limit: shown, scope: everything ? "tudo" : "lei" });
  const qs = (o: { casa?: Body; tudo?: boolean; n?: number }) => {
    const u = new URLSearchParams();
    if ((o.casa ?? body) === "senado") u.set("casa", "senado");
    if (o.tudo ?? everything) u.set("tudo", "1");
    if (o.n) u.set("n", String(o.n));
    const s = u.toString();
    return s ? `/v2/votacoes?${s}` : "/v2/votacoes";
  };

  return (
    <>
      <h1 className="sv-title">Votações</h1>
      <p className="sv-lead sv-mt-2">Cada votação nominal, com o voto de cada pessoa. Votação simbólica não registra voto individual e não aparece aqui.</p>
      <Tabs
        current={body}
        items={[
          { key: "camara", label: "Câmara", href: qs({ casa: "camara" }) },
          { key: "senado", label: "Senado", href: qs({ casa: "senado" }) },
        ]}
      />

      <div className="sv-mt-4">
        <Label>
          {fmtInt(page.total)} {everything ? "votações" : "votações que mudam o texto de uma proposta"}, da mais recente para a mais antiga
        </Label>
        {page.items.length === 0 ? (
          <Gap>Não consta. Nenhuma votação carregada para esta Casa.</Gap>
        ) : (
          <List>
            {page.items.map((v) => (
              <Item
                key={v.id}
                href={`/v2/votacao/${v.id}`}
                title={clip(v.proposal?.summary ?? v.description, 150)}
                note={`${v.proposal?.label ? `${v.proposal.label}. ` : ""}${v.yes} sim, ${v.no} não${v.result ? `. Resultado: ${RESULT[v.result]}` : ""}`}
                value={fmtDate(v.occurredAt)}
              />
            ))}
          </List>
        )}

        {page.items.length < page.total && (
          <Link className="sv-more" href={qs({ n: shown + 30 })}>
            Mostrar mais 30
          </Link>
        )}

        <p className="sv-meta sv-mt-3" style={{ fontWeight: 400 }}>
          {everything ? (
            <>
              Mostrando também requerimentos e pedidos de urgência. <Link href={qs({ tudo: false })}>Mostrar só o que muda o texto</Link>
            </>
          ) : (
            <>
              {page.hidden > 0 ? `${fmtInt(page.hidden)} votações de requerimento ou urgência estão fora desta lista. ` : ""}
              <Link href={qs({ tudo: true })}>Mostrar todas</Link>
            </>
          )}
        </p>
      </div>

      <Src>Fonte: {body === "camara" ? "Câmara dos Deputados" : "Senado Federal"}, votações nominais, dados abertos.</Src>
    </>
  );
}
