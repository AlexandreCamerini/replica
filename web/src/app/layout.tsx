import type { Metadata } from "next";
import "./globals.css";

// Design v1 (design/v1/DIRECAO.md): Newsreader para títulos e frases, IBM Plex Sans no corpo, IBM Plex Mono em rótulos,
// datas e códigos, Barlow Condensed nos números grandes. Fontes empacotadas (Fontsource, subset latin, só os pesos usados):
// o build não depende de rede nem do Google Fonts. As famílias já estão em --ds-font-* no tokens.css.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-500-italic.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/newsreader/latin-600-italic.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";

// Tudo dinâmico: os dois cascos leem dado ao vivo (UF do cookie; "Pauta lida em", Regra 2) e nenhuma página consulta o banco no build.
// Na Vercel o build roda com DATA_SOURCE=pg e sem DATABASE_URL; o prerender de qualquer rota com dados quebraria.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // URL absoluta do og:image e do canonical (WhatsApp exige). SITE_URL na publicação; sem ela, o Next usa a origem local.
  ...(process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL) ? { metadataBase: new URL(process.env.SITE_URL) } : {}),
  title: { default: "Segue o Voto", template: "%s · Segue o Voto" },
  description: "O que está rolando, o que seus escolhidos estão fazendo e o que mexe com você. Cada resposta diz quem conferiu e quando; votos, presença e gastos vêm da fonte oficial, com a data da leitura quando a fonte a registra.",
};

// aplica o tema salvo antes da primeira pintura (sem piscar)
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// Dois cascos, um por grupo de rotas: (sv) é a Direção 2, o desenho do site desde a D316; (v1) é o desenho anterior, que
// segue no ar nas páginas que a Direção 2 ainda não cobre. Cada grupo traz o próprio "pular", cabeçalho, <main> e rodapé.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
