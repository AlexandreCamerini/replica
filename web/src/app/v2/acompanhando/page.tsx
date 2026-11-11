import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { FOLLOW_COOKIE, FOLLOW_MAX, parseFollows } from "@/components/sv/follow-shared";
import { FollowedCard, loadFollowed } from "@/components/sv/followed";
import { Src } from "@/components/sv/ui";

export const metadata: Metadata = { title: "Quem você votou" };

export default async function Acompanhando() {
  const follows = parseFollows((await cookies()).get(FOLLOW_COOKIE)?.value);
  const followed = await loadFollowed(follows, 6);

  return (
    <>
      <h1 className="sv-title">O que fez quem você votou</h1>
      <p className="sv-lead sv-mt-2">Os votos mais recentes de cada pessoa que você marcou. Em ordem alfabética, sem nota e sem comparação.</p>

      {followed.length === 0 ? (
        <div className="sv-mt-5">
          <p className="sv-lead">Você ainda não marcou ninguém. Abra a página de uma pessoa e toque em “Votei nesta pessoa: acompanhar”.</p>
          <Link className="sv-btn sv-mt-3" href="/v2/pessoas">
            Escolher em quem votei
          </Link>
        </div>
      ) : (
        <div className="sv-cols is-2 sv-mt-5" style={{ gap: "40px 56px" }}>
          {followed.map((f) => (
            <FollowedCard key={f.slug} f={f} />
          ))}
        </div>
      )}

      <p className="sv-meta sv-mt-5" style={{ fontWeight: 400 }}>
        Você pode acompanhar até {FOLLOW_MAX} pessoas. A lista fica guardada só neste navegador: não criamos conta e não gravamos em quem você votou. Para tirar alguém, abra a página da pessoa.
      </p>
      <Src>Fonte: Câmara dos Deputados e Senado Federal, votações nominais. Sem voto registrado não é voto contra.</Src>
    </>
  );
}
