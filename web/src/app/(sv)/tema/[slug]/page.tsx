import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/styles/sv-tema.css";
import { fraseLida, lidoEm } from "@/components/sv/carimbo";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { fmtDate, fmtInt } from "@/components/sv/fmt";
import { FalhaDeLeitura } from "@/components/sv/falha-leitura";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { loadThemes } from "@/components/sv/temas";
import { Nota, Proxima, Quadro, Resposta, Selo } from "@/components/sv/ui";
import { VotacaoItem } from "@/components/sv/votacao-item";
import { data } from "@/lib/data";

const SLUG = /^[a-z0-9-]{1,60}$/;
const MOSTRA = 40;

async function load(slug: string) {
  if (!SLUG.test(slug)) return null;
  const p = await loadThemes();
  const t = p.themes.find((x) => x.slug === slug) ?? null;
  return t ? { t, p } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug).catch(() => null);
  return { title: r ? `O que o Congresso votou sobre ${r.t.name}?` : "Tema não encontrado" };
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${fmtInt(n)} ${varios}`);

export default async function Tema({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ simular?: string | string[] }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // null = tema que não existe (404); undefined = a leitura falhou (lacuna, nunca 500). `?simular=erro` só vale na demonstração.
  const r = await lerOuFalhar(simulacao(sp.simular) === "erro", () => load(slug)).catch(() => undefined);
  if (r === null) notFound();
  if (r === undefined) return <FalhaDeLeitura titulo="O que o Congresso votou sobre este tema?" pergunta="Quantas votações recentes sobre este tema?" oQue="as votações deste tema" proxima={{ href: "/temas", pergunta: "O que está em jogo no Congresso?" }} />;
  const { t, p } = r;
  const [stC, stS] = await Promise.all([data.getStamp("camara.votacoes").catch(() => null), data.getStamp("senado.votacoes").catch(() => null)]);
  const lida = [lidoEm(stC), lidoEm(stS)].filter((x): x is string => !!x).sort()[0] ?? null; // a leitura mais antiga das duas
  const fonte = `Fonte: Câmara dos Deputados (votações nominais${fraseLida(stC, "as")}) e Senado Federal (votações nominais${fraseLida(stS, "as")}). O tema é o atribuído pela própria Casa.`;
  const camara = t.events.filter((e) => e.body === "camara").length;
  const senado = t.events.length - camara;
  const semResultado = t.events.length - t.approved - t.rejected;
  const mostradas = t.events.slice(0, MOSTRA);

  return (
    <div className="sv-pg sv-pg--tm1">
      <div className="sv-folio sv-folio--dom">
        <h1>O que o Congresso votou sobre {t.name}?</h1>
        <p className="sv-intro">Votações nominais que mudam o texto de uma proposta, com o tema que a própria Casa atribui.</p>
      </div>

      <Quadro id="tm1-1" variante="dom" numero={1} pergunta={`Quantas votações recentes sobre ${t.name}?`} className="sv-c7" prova={fonte}>
        <Resposta tamanho="dom">{plural(t.events.length, "votação", "votações")}.</Resposta>
        <p className="sv-t">
          {plural(camara, "na Câmara", "na Câmara")} e {plural(senado, "no Senado", "no Senado")}. A mais recente foi em {fmtDate(t.last)}.
        </p>
        <p className="sv-t">
          Contamos entre as {fmtInt(p.loaded)} votações mais recentes que lemos das duas Casas, de um total de {fmtInt(p.total)}. Votações mais antigas ficam fora desta conta{p.untagged > 0 ? `, e também ${plural(p.untagged, "votação sem tema atribuído", "votações sem tema atribuído")}` : ""}.
        </p>
      </Quadro>

      <Quadro id="tm1-2" numero={2} pergunta="Como terminaram?" className="sv-c5" prova={fonte}>
        <ul className="sv-tm1-res">
          <li>
            Aprovadas: {fmtInt(t.approved)}
          </li>
          <li>
            Rejeitadas: {fmtInt(t.rejected)}
          </li>
          <li>
            Sem resultado publicado pela fonte: {fmtInt(semResultado)}
          </li>
        </ul>
        <Nota>Entre as {fmtInt(p.loaded)} votações mais recentes que lemos, não em toda a história. Aprovar ou rejeitar um texto não diz se a decisão foi boa. Abra cada votação para ver o que foi decidido e quem votou.</Nota>
      </Quadro>

      <Quadro
        id="tm1-3"
        numero={3}
        pergunta="Quais foram, da mais recente para a mais antiga?"
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: votações inventadas para a demonstração</ExemploIlustrativo> {fonte}
          </>
        }
      >
        {t.events.length > MOSTRA && (
          <p className="sv-t">
            Mostrando as {MOSTRA} mais recentes de {fmtInt(t.events.length)}.
          </p>
        )}
        <ol className="sv-vls">
          {mostradas.map((v) => (
            <VotacaoItem key={v.id} v={v} />
          ))}
        </ol>
        <Nota>O placar da lista é o total que a fonte publicou, Sim e Não. Abstenção e Sem voto estão na página de cada votação. Sem voto não é voto contra.</Nota>
      </Quadro>

      <Selo id="tm1-selo" numero={4} lidoEm={lida} className="sv-c7" />
      <Proxima href="/temas" pergunta="O que está em jogo no Congresso?" className="sv-c5" />
    </div>
  );
}
