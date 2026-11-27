import Link from "next/link";
import type { Prefs } from "./prefs-shared";
import { FALHOU_LEITURA, SELO } from "./estados";
import { BotaoFacil, NavLink } from "./shell-client";

// Casco da D2: link "pular", topo (marca + UF + "trocar estado"), navegação, rodapé. Server component, sem JS essencial: a
// navegação fica sempre visível (sem menu hambúrguer). O layout lê o cookie e passa a UF por prop.
// F1 do roteiro do eleitor (replica/roteiro-eleitor-2026-11.md; revisa as D324 a D326 só no menu): uma linha só, com quatro
// destinos de rótulo curto, que cabe em 390px sem rolar. As perguntas longas continuam como título de cada página (h1).
// "Custo" entra quando o dado do custo das casas existir (fatia F10); até lá o menu tem quatro destinos.

/** Menu principal: os quatro destinos de sempre. Ordem do DOM = ordem visual. */
const PRINCIPAIS = [
  { href: "/", label: "Início" },
  { href: "/acompanhando", label: "Meus escolhidos" },
  { href: "/votacoes", label: "Votações" },
  { href: "/pessoas", label: "Pessoas" },
] as const;

/** Rodapé: o que saiu do topo (as duas rotas de temas e decisões, ajustes) e "Como funciona". As rotas seguem as mesmas. */
const ROTAS = [
  { href: "/decisoes", label: "O que mexe comigo?" },
  { href: "/temas", label: "O que está em jogo?" },
  { href: "/ajustes", label: "Ajustes" },
  { href: "/como-funciona", label: "Como funciona" },
] as const;

export const CONTEUDO_ID = "sv-conteudo";

/** Topo: "pular", marca, UF escolhida (ou "Escolha seu estado") e a navegação. Ordem do DOM = ordem visual. */
export function Topo({ uf, ufFalhou = false, facil = false }: { uf: Prefs["uf"]; ufFalhou?: boolean; /** modo leitura fácil ligado */ facil?: boolean }) {
  return (
    <>
      <a className="sv-skip" href={`#${CONTEUDO_ID}`}>
        Pular para o conteúdo
      </a>
      <header className="sv-wrap sv-topo">
        <div className="sv-id">
          <Link className="sv-marca" href="/">
            segue o voto
          </Link>
          <div className="sv-id__r">
            <p className="sv-uf">
              {uf ? (
                <>
                  {/* no celular só a sigla aparece; o nome completo continua no texto (leitor de tela) */}
                  <span className="sv-uf__n">{uf.nome} (</span>
                  {uf.sigla}
                  <span className="sv-uf__n">)</span> · <Link href="/ajustes">trocar estado</Link>
                </>
              ) : ufFalhou ? (
                <>
                  Seu estado: {FALHOU_LEITURA.charAt(0).toLowerCase()}
                  {FALHOU_LEITURA.slice(1)} · <Link href="/ajustes">Ajustes</Link>
                </>
              ) : (
                <Link href="/ajustes">Escolha seu estado</Link>
              )}
            </p>
            <BotaoFacil ligada={facil} />
          </div>
        </div>
        <nav className="sv-nav" aria-label="Navegação principal">
          <ul className="sv-nv">
            {PRINCIPAIS.map((n) => (
              <li key={n.href}>
                <NavLink href={n.href}>{n.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
    </>
  );
}

/** Rodapé: fontes, quem conferiu, links (inclusive as rotas não redesenhadas) e a assinatura. */
export function Rodape() {
  return (
    <footer className="sv-rod">
      <div className="sv-wrap">
        <p>Fontes: Câmara dos Deputados, Senado Federal (pauta e votos) e Justiça Eleitoral (TSE), para cargos e cadeiras. Cada página diz de onde veio cada dado e quando foi lido.</p>
        <p>
          <strong>{SELO.regra}</strong>
        </p>
        <ul className="sv-rod__l">
          {ROTAS.map((n) => (
            <li key={n.href}>
              <NavLink href={n.href}>{n.label}</NavLink>
            </li>
          ))}
          <li>
            <Link href="/como-funciona#correcoes">{SELO.apontarErro}</Link>
          </li>
          <li>
            <Link href="/no-seu-bolso" rel="nofollow">Páginas do desenho anterior</Link>
          </li>
        </ul>
        <p className="sv-ass">Seu voto não termina na urna.</p>
      </div>
    </footer>
  );
}
