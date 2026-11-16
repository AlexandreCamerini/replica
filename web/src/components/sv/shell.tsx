import Link from "next/link";
import type { Prefs } from "./prefs-shared";
import { FALHOU_LEITURA, SELO } from "./estados";
import { NavLink } from "./shell-client";

// Casco da D2: link "pular", topo (marca + UF + "trocar estado"), navegação em duas camadas, rodapé. Server component, sem JS
// essencial: a navegação fica sempre visível (sem menu hambúrguer). O layout lê o cookie e passa a UF por prop.
// Abaixo de 900px as duas camadas viram uma linha só, que rola na horizontal (sv.css, bloco "casco"): o topo cabe em 130px.

/** As duas perguntas principais. */
const PRINCIPAIS = [
  { href: "/", label: "O que está rolando?" },
  { href: "/acompanhando", label: "O que meus escolhidos estão fazendo?" },
] as const;

/**
 * Linha "Também:", em três partes na ordem em que aparecem. "Pessoas" e "Votações" entraram aqui na D324 (antes só no
 * rodapé) e, na D325, ganharam um grupo próprio (`FIXOS`): abaixo de 900px ele fica preso à borda direita da linha que
 * rola, para os dois ficarem à vista sem rolar. A partir de 900px o grupo não existe na tela (display:contents).
 */
const TAMBEM_ANTES = [
  { href: "/decisoes", label: "O que mexe comigo?" },
  { href: "/temas", label: "O que está em jogo?" },
] as const;
const FIXOS = [
  { href: "/pessoas", label: "Pessoas" },
  { href: "/votacoes", label: "Votações" },
] as const;
const TAMBEM_DEPOIS = [{ href: "/ajustes", label: "Ajustes" }] as const;

/** Rodapé: repete "Votações" e "Pessoas" (também estão no topo) e traz "Como funciona". */
const ROTAS = [
  { href: "/votacoes", label: "Votações" },
  { href: "/pessoas", label: "Pessoas" },
  { href: "/como-funciona", label: "Como funciona" },
] as const;

export const CONTEUDO_ID = "sv-conteudo";

/** Topo: "pular", marca, UF escolhida (ou "Escolha seu estado") e as duas camadas de navegação. Ordem do DOM = ordem visual. */
export function Topo({ uf, ufFalhou = false }: { uf: Prefs["uf"]; ufFalhou?: boolean }) {
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
        </div>
        <nav className="sv-perg" aria-label="Perguntas">
          <ul className="sv-nv1">
            {PRINCIPAIS.map((n) => (
              <li key={n.href}>
                <NavLink href={n.href}>{n.label}</NavLink>
              </li>
            ))}
          </ul>
          <p className="sv-nv2">
            <span className="sv-nv2__t">Também:</span>
            {TAMBEM_ANTES.map((n) => (
              <NavLink key={n.href} href={n.href}>
                {n.label}
              </NavLink>
            ))}
            <span className="sv-fixo">
              {FIXOS.map((n) => (
                <NavLink key={n.href} href={n.href}>
                  {n.label}
                </NavLink>
              ))}
            </span>
            {TAMBEM_DEPOIS.map((n) => (
              <NavLink key={n.href} href={n.href}>
                {n.label}
              </NavLink>
            ))}
          </p>
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
            <Link href="/no-seu-bolso">Páginas do desenho anterior</Link>
          </li>
        </ul>
        <p className="sv-ass">Seu voto não termina na urna.</p>
      </div>
    </footer>
  );
}
