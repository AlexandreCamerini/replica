import type { Metadata } from "next";
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
import { readPrefs } from "@/components/sv/prefs";
import { CONTEUDO_ID, Rodape, Topo } from "@/components/sv/shell";
import { data } from "@/lib/data";

// Protótipo do redesign "Segue o Voto", Direção 2 (decisão do dono em 10/11/2026). Vive em /v2 ao lado das páginas atuais,
// usa a mesma camada de dados e traz o próprio casco; o shell atual (e o link "pular" dele) somem aqui (components/sv/legacy-only).
// O topo mostra a UF do cookie sv_uf. Ler cookie tornaria a página dinâmica; o layout raiz já é force-dynamic, então nada muda.
export const metadata: Metadata = {
  title: { default: "Segue o Voto", template: "%s · Segue o Voto" },
  description: "O que está rolando, o que seus escolhidos estão fazendo e o que mexe com você. Cada resposta diz quem conferiu e quando; votos, presença e gastos vêm da fonte oficial, com a data da leitura quando a fonte a registra.",
  robots: { index: false, follow: false },
};

export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const prefs = await readPrefs();
  return (
    <div className="sv">
      <Topo uf={prefs.uf} ufFalhou={prefs.ufFalhou} />
      {data.isDemo && (
        <div className="sv-demo">
          <div className="sv-wrap">Versão de demonstração. Exemplo ilustrativo: pessoas, partidos e números são fictícios.</div>
        </div>
      )}
      <div className="sv-wrap sv-main" id={CONTEUDO_ID} tabIndex={-1}>
        {children}
      </div>
      <Rodape />
    </div>
  );
}
