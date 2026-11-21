// Bricolage Grotesque variável (Fontsource): standard.css traz os eixos opsz, wdth e wght no mesmo arquivo.
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@/styles/sv.css";
// CSS de cada tela da D2, depois da base. Cada arquivo tem um único dono (o agente daquela tela).
import "@/styles/sv-inicio.css";
import "@/styles/sv-escolhidos.css";
import "@/styles/sv-pessoa.css";
import "@/styles/sv-decisao.css";
import "@/styles/sv-temas.css";
import "@/styles/sv-ajustes.css";
import "@/styles/sv-mapa.css";
import { Suspense } from "react";
import { AvisoDeCarregamento } from "./carregando";
import { AVISO_MANUTENCAO, emManutencao } from "@/lib/manutencao";
import { readPrefs } from "./prefs";
import { CONTEUDO_ID, Rodape, Topo } from "./shell";
import { data } from "@/lib/data";

/**
 * Casco da Direção 2 (D316: é o desenho do site desde 14/11/2026). Usado pelo layout do grupo (sv) e pelo 404 da raiz,
 * que não passa por layout de grupo. O topo mostra a UF do cookie sv_uf; o layout raiz já é force-dynamic.
 * O <main> é só o conteúdo: topo e rodapé ficam fora dele, para valerem como cabeçalho e rodapé da página (no /v2 o
 * <main> do layout raiz envolvia os três, e o rodapé perdia o papel de rodapé).
 */
export async function Casco({ children }: { children: React.ReactNode }) {
  const prefs = await readPrefs();
  return (
    <div className="sv">
      <Topo uf={prefs.uf} ufFalhou={prefs.ufFalhou} />
      {data.isDemo && (
        <aside className="sv-demo" aria-label="Versão de demonstração">
          <div className="sv-wrap">Versão de demonstração. Exemplo ilustrativo: pessoas, partidos e números são fictícios.</div>
        </aside>
      )}
      {emManutencao(process.env) && (
        <aside className="sv-demo" role="status" aria-label="Manutenção">
          <div className="sv-wrap">{AVISO_MANUTENCAO}</div>
        </aside>
      )}
      <main className="sv-wrap sv-main" id={CONTEUDO_ID} tabIndex={-1}>
        {children}
      </main>
      <Rodape />
      {/* Aviso de troca de página (D330). Depois do rodapé no DOM: não entra na ordem de leitura do conteúdo. O Suspense é
          exigência do Next para ler os parâmetros do endereço no cliente; o componente não suspende e o HTML sai inteiro. */}
      <Suspense fallback={null}>
        <AvisoDeCarregamento />
      </Suspense>
    </div>
  );
}
