import type { Metadata } from "next";
import "./globals.css";

// Layout RAIZ da central (build da central: `pageExtensions` só com `.admin.*`; o layout do site, `layout.tsx`, não entra nesse build, e este não entra no build do site). AC-29.
// Importa (sem alterar) os estilos do site: globals.css (Tailwind e tokens) e as fontes empacotadas do Fontsource, as mesmas que os tokens --ds-font-* nomeiam. Não importa nenhum componente do site.
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

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Central de coleta" },
  robots: { index: false, follow: false, nocache: true },
};

// Tema salvo antes da primeira pintura. O TEXTO é idêntico ao `themeScript` do layout do site de propósito: o hash de cabecalhos.ts (HASH_SCRIPT_TEMA) vale para os dois e um teste o confere
// contra ESTE arquivo (a CSP da central não tem 'unsafe-inline' em script; o inline não leva nonce).
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

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
