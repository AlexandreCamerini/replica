import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/archivo/wdth.css";
import "@/styles/sv.css";
import { SvHeader } from "@/components/sv/shell";
import { data } from "@/lib/data";

// Protótipo do redesign "Segue o Voto" (direção aprovada em 10/11/2026). Vive em /v2 ao lado das páginas atuais,
// usa a mesma camada de dados e traz o próprio cabeçalho e rodapé; o shell atual se esconde aqui (components/sv/legacy-only).
export const metadata: Metadata = {
  title: { default: "Segue o Voto", template: "%s · Segue o Voto" },
  description: "Entenda o que acontece. Saiba quem decide. Acompanhe quem representa você. Forme sua própria opinião.",
  robots: { index: false, follow: false },
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sv">
      <SvHeader />
      {data.isDemo && (
        <div className="sv-demo">
          <div className="sv-wrap">Versão de demonstração. Pessoas, partidos e números são fictícios.</div>
        </div>
      )}
      <div className="sv-wrap sv-main">{children}</div>
      <footer className="sv-foot">
        <div className="sv-wrap">
          <span>Seu voto não termina na urna.</span>
          <span>
            <Link href="/v2/acompanhando">Quem você votou</Link> · <Link href="/v2/como-funciona">Como funciona</Link> · <Link href="/v2/como-funciona#correcoes">Apontar um erro</Link> · <Link href="/">Versão atual do site</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
