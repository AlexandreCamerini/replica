import type { Metadata } from "next";
import { fmtDate, fmtInt } from "@/components/sv/fmt";
import { loadThemes } from "@/components/sv/temas";
import { Gap, Item, Label, List, Src } from "@/components/sv/ui";
import { data } from "@/lib/data";

export const metadata: Metadata = { title: "Temas nacionais" };

export default async function Temas() {
  const [p, overview] = await Promise.all([loadThemes(), data.getPautaOverview().catch(() => null)]);
  const half = Math.ceil(p.themes.length / 2);

  // O que está na pauta desta semana, pelo tema que a própria Câmara atribui à proposta.
  const pauta = new Map<string, number>();
  for (const e of overview ? [...overview.plenary, ...overview.committees] : []) if (e.reason.theme) pauta.set(e.reason.theme, (pauta.get(e.reason.theme) ?? 0) + 1);
  const pautaRows = [...pauta.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  return (
    <>
      <div className="sv-grid is-5-7">
        <div>
          <Label>Panorama nacional</Label>
          <h1 className="sv-title sv-mt-1">Os temas que o Congresso está decidindo</h1>
          <p className="sv-lead sv-mt-2">Uma visão de conjunto: o que foi votado em cada assunto, na Câmara e no Senado. Toque num tema para ver as decisões uma a uma.</p>
          <p className="sv-meta sv-mt-3" style={{ fontWeight: 400 }}>
            Entram as {fmtInt(p.loaded)} votações mais recentes que mudam o texto de uma proposta, de um total de {fmtInt(p.total)}. O tema é o que a própria Casa atribui; {fmtInt(p.untagged)} votações não têm tema e ficam fora.
          </p>

          <div className="sv-mt-5">
            <Label>Na pauta desta semana, por tema</Label>
            {pautaRows.length === 0 ? (
              <Gap>Nenhuma proposta com tema na pauta desta semana.</Gap>
            ) : (
              <List>
                {pautaRows.map(([theme, n]) => (
                  <Item key={theme} href="/v2/decisoes" title={theme} value={n === 1 ? "1 proposta" : `${n} propostas`} />
                ))}
              </List>
            )}
          </div>
        </div>

        <div>
          <Label>Votações recentes por tema, do que andou por último</Label>
          {p.themes.length === 0 ? (
            <Gap>Não consta. Nenhuma votação com tema classificado foi carregada.</Gap>
          ) : (
            <div className="sv-cols is-2" style={{ marginTop: 6 }}>
              {[p.themes.slice(0, half), p.themes.slice(half)].map((col, i) => (
                <List key={i}>
                  {col.map((t) => (
                    <Item
                      key={t.slug}
                      href={`/v2/tema/${t.slug}`}
                      title={t.name}
                      note={`${t.approved} aprovadas, ${t.rejected} rejeitadas${t.events.length - t.approved - t.rejected > 0 ? `, ${t.events.length - t.approved - t.rejected} sem resultado publicado` : ""}. Última em ${fmtDate(t.last)}.`}
                      value={t.events.length}
                    />
                  ))}
                </List>
              ))}
            </div>
          )}
        </div>
      </div>
      <Src>Fonte: Câmara dos Deputados e Senado Federal, votações nominais e pauta, dados abertos. A ordem é de data, não de importância.</Src>
    </>
  );
}
