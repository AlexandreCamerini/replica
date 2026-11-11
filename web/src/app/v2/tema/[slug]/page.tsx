import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clip, fmtDate } from "@/components/sv/fmt";
import { loadThemes } from "@/components/sv/temas";
import { Bar, Item, Label, List, Src } from "@/components/sv/ui";

const SLUG = /^[a-z0-9-]{1,60}$/;

async function load(slug: string) {
  if (!SLUG.test(slug)) return null;
  const p = await loadThemes();
  return p.themes.find((t) => t.slug === slug) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = await load((await params).slug);
  return { title: t ? t.name : "Tema não encontrado" };
}

export default async function Tema({ params }: { params: Promise<{ slug: string }> }) {
  const t = await load((await params).slug);
  if (!t) notFound();
  const open = t.events.length - t.approved - t.rejected;
  const camara = t.events.filter((e) => e.body === "camara").length;

  return (
    <>
      <div className="sv-grid is-5-7">
        <div>
          <Label>
            <Link href="/v2/temas">Temas nacionais</Link>
          </Label>
          <h1 className="sv-title sv-mt-1">{t.name}</h1>
          <p className="sv-lead sv-mt-2">
            {t.events.length} votações recentes sobre este assunto: {camara} na Câmara e {t.events.length - camara} no Senado. A mais recente foi em {fmtDate(t.last)}.
          </p>

          <div className="sv-mt-4" role="img" aria-label={`${t.approved} aprovadas, ${t.rejected} rejeitadas, ${open} sem resultado publicado`}>
            <Label>Como terminaram</Label>
            <Bar label="Aprovadas" kind="is-sim" weight={800} n={t.approved} total={t.events.length} />
            <Bar label="Rejeitadas" kind="is-nao" weight={500} n={t.rejected} total={t.events.length} />
            <Bar label="Sem resultado" weight={200} n={open} total={t.events.length} />
          </div>
          <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
            Aprovar ou rejeitar um texto não diz se a decisão foi boa. Abra cada votação para ver o que foi decidido e quem votou.
          </p>
        </div>

        <div>
          <Label>Votações, da mais recente para a mais antiga</Label>
          <List>
            {t.events.slice(0, 40).map((v) => (
              <Item key={v.id} href={`/v2/votacao/${v.id}`} title={clip(v.proposal?.summary ?? v.description, 140)} note={`${v.body === "camara" ? "Câmara" : "Senado"}. ${v.yes} sim, ${v.no} não${v.result ? `. Resultado: ${v.result}` : ""}`} value={fmtDate(v.occurredAt)} />
            ))}
          </List>
          {t.events.length > 40 && (
            <p className="sv-meta sv-mt-2" style={{ fontWeight: 400 }}>
              Mostrando 40 de {t.events.length}.
            </p>
          )}
        </div>
      </div>
      <Src>Fonte: Câmara dos Deputados e Senado Federal, votações nominais. O tema é o atribuído pela própria Casa.</Src>
    </>
  );
}
