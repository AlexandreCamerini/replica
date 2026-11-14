import Link from "next/link";
import type { Metadata } from "next";
import { Casco } from "@/components/sv/casco";
import { Proxima, Quadro, Resposta } from "@/components/sv/ui";

// 404 do site (Direção 2). Vale para endereço sem rota e para notFound() de qualquer tela que não tenha o próprio
// not-found (o do desenho anterior é só o de /proposta/[key]). O 404 da raiz não passa por layout de grupo: por isso traz o Casco.
// Como todo notFound() no Next 15.5, o conteúdo só aparece com JavaScript quando vem de uma tela; endereço sem rota sai no HTML.
// Não afirma que o registro não existe: só que esta página não foi encontrada aqui.

export const metadata: Metadata = { title: "Não consta" };

const SEGUIR = [
  { href: "/", label: "O que está rolando?" },
  { href: "/acompanhando", label: "O que meus escolhidos estão fazendo?" },
  { href: "/decisoes", label: "O que mexe comigo?" },
  { href: "/temas", label: "O que está em jogo?" },
  { href: "/votacoes", label: "Como votaram no Congresso?" },
  { href: "/pessoas", label: "Quem está no cargo?" },
  { href: "/como-funciona", label: "Como funciona?" },
] as const;

export default function NotFound() {
  return (
    <Casco>
      <Conteudo />
    </Casco>
  );
}

function Conteudo() {
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
      <Proxima href="/" pergunta="O que está rolando?" />
    </div>
  );
}
