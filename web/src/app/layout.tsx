import type { Metadata } from "next";
import "./globals.css";
import { DemoBanner } from "@/components/shell/bars";
import { CompareProvider } from "@/components/shell/compare";
import { AppFooter } from "@/components/shell/footer";
import { AppHeader } from "@/components/shell/header";
import { LegacyOnly } from "@/components/sv/legacy-only";
import { data } from "@/lib/data";

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

// Tudo dinâmico: o cabeçalho mostra "Pauta lida em" ao vivo (Regra 2) e nenhuma página consulta o banco no build.
// Na Vercel o build roda com DATA_SOURCE=pg e sem DATABASE_URL; o prerender de qualquer rota com dados quebraria.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // URL absoluta do og:image (WhatsApp exige). SITE_URL na publicação; sem ela, o Next usa a origem local.
  ...(process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL) ? { metadataBase: new URL(process.env.SITE_URL) } : {}),
  title: { default: "O que estão decidindo em Brasília que mexe no seu bolso", template: "%s · Segue o Voto" },
  description: "O que estão decidindo em Brasília que mexe no seu bolso, com o texto oficial e sem opinião.",
};

// aplica o tema salvo antes da primeira pintura (sem piscar)
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // "Pauta lida em" fica no cabeçalho de toda página (Regra 2): a hora da leitura nunca sai de vista.
  const readAt = await data.getPautaOverview().then((o) => o.week.readAt, () => null);
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        {/* o /v2 tem o próprio "pular", que salta o casco novo (components/sv/shell) */}
        <LegacyOnly>
          <a
            href="#conteudo"
            className="sr-only z-50 bg-surface-inverse px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            Pular para o conteúdo
          </a>
        </LegacyOnly>
        <CompareProvider>
          <LegacyOnly>
            <DemoBanner />
            <AppHeader readAt={readAt} />
          </LegacyOnly>
          <main id="conteudo" tabIndex={-1} className="pb-16 outline-none">
            {children}
          </main>
          <LegacyOnly>
            <AppFooter />
          </LegacyOnly>
        </CompareProvider>
      </body>
    </html>
  );
}
