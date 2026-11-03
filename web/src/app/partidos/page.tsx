import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/page/page-header";
import { Dash, Notice, TableRegion } from "@/components/page/w4";
import { SourceFooter } from "@/components/ui/data";
import { data } from "@/lib/data";
import { count } from "@/lib/format";

export const metadata: Metadata = {
  title: "Partidos",
  description: "Partidos em ordem alfabética, com número, cadeiras hoje na Câmara e no Senado e quanto votaram com a orientação do governo.",
};
export const dynamic = "force-dynamic";

/** Abaixo disso a porcentagem engana: mostra “—” com o motivo e o número de votações. */
const MIN_VOTINGS = 30;
const GOV_LABEL = { bolsonaro: "Governo Bolsonaro", lula: "Governo Lula" } as const;

export default async function Page() {
  const [{ rows, windows }, camara, senado] = await Promise.all([data.listPartyRows(), data.getChamber("camara"), data.getChamber("senado")]);
  const stamp = await data.getStamp("camara.votacoes");
  const sumC = rows.reduce((s, r) => s + r.seatsCamara, 0);
  const sumS = rows.reduce((s, r) => s + r.seatsSenado, 0);
  const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

  return (
    <Container>
      <PageHeader
        title="Partidos"
        lead="Os partidos que têm gente em mandato hoje, em ordem alfabética. Mostramos o número, as cadeiras na Câmara e no Senado e quantas vezes votaram como o governo pediu. Não ordenamos, não pontuamos e não classificamos em esquerda ou direita."
      />

      <TableRegion label="Partidos em ordem alfabética">
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm" data-testid="partidos">
          <caption className="sr-only">Partidos com número, cadeiras e coincidência com a orientação do governo</caption>
          <thead className="bg-surface-sunken text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Partido</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Número</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Câmara</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Senado</th>
              {windows.map((w) => (
                <th key={w.gov} scope="col" className="px-3 py-2 text-right font-semibold">
                  {GOV_LABEL[w.gov]}
                  <span className="block font-normal">{w.firstYear === w.lastYear ? w.firstYear : `${w.firstYear}–${w.lastYear}`} · {count(w.votings)} votações</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-party={r.acronym} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2">
                  <span className="font-semibold">{r.acronym}</span>
                  {r.name.toLowerCase() !== r.acronym.toLowerCase() && <span className="block text-xs font-normal text-muted">{r.name}</span>}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{r.number ?? <Dash why="número eleitoral não carregado" />}</td>
                <td className="px-3 py-2 text-right tabular-nums">{count(r.seatsCamara)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{count(r.seatsSenado)}</td>
                {windows.map((w) => {
                  const a = r.alignment.find((x) => x.gov === w.gov);
                  return (
                    <td key={w.gov} className="px-3 py-2 text-right tabular-nums" data-gov={w.gov}>
                      {!a ? (
                        <Dash why="sem orientação própria do partido nas votações em que o governo orientou (muitas vezes ele orienta por bloco ou federação, que não entra nesta conta)" />
                      ) : a.n < MIN_VOTINGS ? (
                        <Dash why={`só ${a.n} ${a.n === 1 ? "votação" : "votações"} com orientação dos dois; abaixo de ${MIN_VOTINGS} a porcentagem engana`} />
                      ) : (
                        <>
                          {pct.format((a.same / a.n) * 100)}%<span className="block text-xs text-muted">{count(a.same)} de {count(a.n)}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      <p className="mt-2 text-xs text-muted" data-testid="soma">
        Cadeiras somadas: {count(sumC)} de {count(camara.length)} deputados em exercício e {count(sumS)} de {count(senado.length)} senadores.
        {sumC !== camara.length || sumS !== senado.length ? " A diferença é de quem está sem partido vigente no cadastro." : ""}
      </p>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <Notice title="Como lemos “votou com o governo”" id="alinhamento">
          <p>
            Pegamos as votações nominais da Câmara em que o governo e o partido deram orientação “sim” ou “não” (liberar, obstruir e ausência ficam de fora). Contamos
            em quantas as duas orientações foram iguais e dividimos pelo total. É o que o partido <em>orientou</em>, não como cada deputado votou.
          </p>
          <p>
            Os governos são separados pela data da votação (antes de 2023, Bolsonaro; de 2023 em diante, Lula) e nunca somados. A Câmara só traz orientação do governo
            nos anos mostrados no cabeçalho; nos demais, não há dado. Quando o partido orienta por bloco ou federação, a orientação é do bloco e este número fica em “—”. O Senado não publica essa orientação, então a coluna só vale para a Câmara.
          </p>
        </Notice>
        <Notice title="O que não está aqui, de propósito">
          <p>
            Sem espectro esquerda–centro–direita: não existe critério público e aceito por todos, e escolher um seria opinião nossa. Sem ordem por tamanho,
            sem cor por partido e sem nota.
          </p>
          <p>Cadeiras são as de hoje (mandatos em exercício, partido atual da pessoa). “—” quer dizer que a fonte não permite o número, com o motivo ao lado.</p>
        </Notice>
      </section>

      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Container>
  );
}
