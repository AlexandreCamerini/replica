import Link from "next/link";
import { Proxima, Quadro, Resposta } from "@/components/sv/ui";

// 404 do /v2 (Direção 2). Vale para notFound() de qualquer tela do /v2 e para endereço inexistente sob /v2 ([...resto]).
// Não afirma que o registro não existe: só que esta página não foi encontrada aqui.

const SEGUIR = [
  { href: "/v2", label: "O que está rolando?" },
  { href: "/v2/acompanhando", label: "O que meus escolhidos estão fazendo?" },
  { href: "/v2/decisoes", label: "O que mexe comigo?" },
  { href: "/v2/temas", label: "O que está em jogo?" },
  { href: "/v2/votacoes", label: "Como votaram no Congresso?" },
  { href: "/v2/pessoas", label: "Quem está no cargo?" },
  { href: "/v2/como-funciona", label: "Como funciona?" },
] as const;

export default function NotFound() {
  return (
    <div className="sv-pg sv-pg--nf">
      <div className="sv-folio sv-folio--dom">
        <h1>Não consta</h1>
        <p className="sv-intro">Esta página não está no Segue o Voto.</p>
      </div>
      <Quadro id="nf-1" variante="dom" numero={1} pergunta="O que aconteceu com esta página?" className="sv-c7">
        <Resposta tamanho="dom">Não encontramos esta página.</Resposta>
        <p className="sv-t">O endereço pode ter mudado ou estar incompleto, ou o registro ainda não foi carregado.</p>
        <p className="sv-t">Isso não quer dizer que a pessoa, a proposta ou a votação não existam. Quer dizer só que não temos uma página neste endereço.</p>
      </Quadro>
      <Quadro id="nf-2" numero={2} pergunta="Por onde eu sigo?" className="sv-c5">
        <ul className="sv-ln">
          {SEGUIR.map((s) => (
            <li key={s.href}>
              <Link href={s.href}>
                {s.label} <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </Quadro>
      <Proxima href="/v2" pergunta="O que está rolando?" />
    </div>
  );
}
