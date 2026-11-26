// F3 do roteiro do eleitor (replica/roteiro-eleitor-2026-11.md, eixo D, pergunta 1): entradas por intenção na primeira tela da home,
// antes de pedir qualquer coisa. Cada entrada leva à resposta que já está na própria página; o estado só é pedido onde a resposta
// precisa dele (o quadro "Quem mais me representa?" convida a escolher o estado quando ele não está guardado).
// "Quanto custa?" entra com o dado do custo das casas (F10), não antes: sem o dado, a entrada não existe.
// Links de âncora (<a> nativo, como no resto do site): funcionam sem JavaScript e o foco do teclado segue o alvo. Ordem fixa, nunca por uso.
const ENTRADAS = [
  { href: "#inicio-representa", label: "Quem me representa?" },
  { href: "#inicio-semana", label: "O que está em votação?" },
] as const;

export function Entradas() {
  return (
    <nav className="sv-ent" aria-label="Por onde começar">
      <ul>
        {ENTRADAS.map((e) => (
          <li key={e.href}>
            <a href={e.href}>{e.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
