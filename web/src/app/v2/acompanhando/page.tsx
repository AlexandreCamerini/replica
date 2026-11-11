import type { Metadata } from "next";
import { cookies } from "next/headers";
import { EscolhidosNaoLidos, QuadroEscolhido, Recentes, SemEscolhidos } from "@/components/sv/escolhidos/quadro";
import { carregarEscolhidos } from "@/components/sv/escolhidos/carregar";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FOLLOW_COOKIE, FOLLOW_MAX, parseFollows } from "@/components/sv/follow-shared";
import { COOKIE_TEXTO } from "@/components/sv/prefs-shared";
import { simulacao } from "@/components/sv/simular";
import { Nota, Proxima, Selo } from "@/components/sv/ui";

export const metadata: Metadata = { title: "O que meus escolhidos estão fazendo?" };

export default async function Acompanhando({ searchParams }: { searchParams: Promise<{ simular?: string | string[] }> }) {
  const slugs = parseFollows((await cookies()).get(FOLLOW_COOKIE)?.value);
  // `?simular=erro|erro_dados` só vale na demonstração (simular.ts)
  const sim = simulacao((await searchParams).simular);
  const { pessoas, recentes, recentesFalhou, falhas, naoEncontradas, lidoEm } = await carregarEscolhidos(slugs, { pessoa: sim === "erro", dados: sim === "erro_dados" });
  // "Você ainda não marcou ninguém." só com o cookie vazio; quem marcou e não foi lido vira lacuna nomeada
  const semCookie = slugs.length === 0;
  const vazio = pessoas.length === 0;

  return (
    <div className="sv-pg sv-pg--esc">
      <div className="sv-topq sv-gu">
        <h1>O que meus escolhidos estão fazendo?</h1>
        <p className="sv-t">As pessoas em quem você votou, de A a Z.</p>
        <p className="sv-t">
          {COOKIE_TEXTO} Cabem até {FOLLOW_MAX} pessoas.
        </p>
        <Nota>
          <ExemploIlustrativo>Exemplo ilustrativo: pessoas, valores e status inventados para a demonstração.</ExemploIlustrativo> Não há nota nem ranking.
        </Nota>
      </div>

      {semCookie ? (
        <SemEscolhidos className="sv-gt" />
      ) : vazio ? (
        <EscolhidosNaoLidos className="sv-gt" falhas={falhas} naoEncontradas={naoEncontradas} />
      ) : (
        <div className="sv-esc__pessoas sv-gt">
          {pessoas.map((p) => (
            <QuadroEscolhido key={p.slug} p={p} />
          ))}
          {(falhas > 0 || naoEncontradas > 0) && <EscolhidosNaoLidos falhas={falhas} naoEncontradas={naoEncontradas} />}
        </div>
      )}

      {!vazio && <Recentes itens={recentes} falhou={recentesFalhou} lidoEm={lidoEm} className="sv-gf" />}
      <Selo className="sv-gs" lidoEm={lidoEm} />
      <Proxima className="sv-gn" href="/v2/decisoes" pergunta="O que mexe comigo?" />
    </div>
  );
}
