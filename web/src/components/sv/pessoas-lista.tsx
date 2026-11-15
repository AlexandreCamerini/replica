import Link from "next/link";
import type { Officeholder } from "@/lib/data";
import { esferaDoCargo } from "./esfera";
import { alternarEscolhido } from "./follow-actions";
import { FOLLOW_MAX } from "./follow-shared";
import { COOKIE_TEXTO } from "./prefs-shared";
import { Nota } from "./ui";

// Lista de pessoas da D2 (/pessoas e o passo 2 de /comecar), com o botão de marcar em cada linha (D324).
// Toda pessoa tem a mesma moldura: nome (link), cargo e lugar com o partido em palavra, esfera em palavra, botão.
// Nada aqui tem cor nem varia por partido, esfera ou pessoa. Ordem: sempre de A a Z.

/**
 * Marca ou desmarca uma pessoa direto na lista. Mesmo formulário da página da pessoa (follow.tsx): envia `slug` e a
 * intenção (`acao`) para a server action, que grava o cookie `httpOnly` (D317). Funciona sem JavaScript; o navegador nunca
 * lê nem grava o cookie. O nome vai no rótulo acessível (aria-label, que começa pelo texto visível): há um botão por pessoa.
 */
export function MarcarPessoa({ slug, nome, on, cheio }: { slug: string; nome: string; on: boolean; /** a lista já tem FOLLOW_MAX pessoas */ cheio: boolean }) {
  const texto = on ? "Você acompanha" : "Votei nesta pessoa";
  return (
    <form action={alternarEscolhido} className="sv-pp__f">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="acao" value={on ? "remover" : "incluir"} />
      <button className="sv-follow" type="submit" aria-pressed={on} aria-label={`${texto}: ${nome}`} disabled={!on && cheio}>
        {texto}
      </button>
    </form>
  );
}

/** Quantas pessoas já estão marcadas, dito uma vez por lista (e não em cada linha). `role="status"`: muda quando a pessoa marca. */
export function Marcados({ n }: { n: number }) {
  return (
    <div className="sv-pp__m">
      <p className="sv-t" role="status">
        {n === 0
          ? "Você ainda não marcou ninguém. Toque em “Votei nesta pessoa” para acompanhar o que ela faz."
          : n >= FOLLOW_MAX
            ? `Você já acompanha ${FOLLOW_MAX} pessoas, o limite. Tire alguém para incluir.`
            : n === 1
              ? `Você acompanha 1 pessoa. Cabem até ${FOLLOW_MAX}.`
              : `Você acompanha ${n} pessoas. Cabem até ${FOLLOW_MAX}.`}
      </p>
      {n > 0 && (
        <Link className="sv-lk" href="/acompanhando">
          Ver o que meus escolhidos estão fazendo <span aria-hidden="true">&nbsp;→</span>
        </Link>
      )}
      <Nota>{COOKIE_TEXTO}</Nota>
    </div>
  );
}

/**
 * Pessoas sempre de A a Z: nenhuma lista de pessoas tem ordem de mérito. O link leva só o nome.
 * `marcados`: os slugs do cookie `sv_sigo`, lidos pelo servidor; null = lista sem botão de marcar.
 */
export function ListaPessoas({ items, marcados }: { items: Officeholder[]; marcados: readonly string[] | null }) {
  const sorted = [...items].sort((a, b) => a.person.displayName.localeCompare(b.person.displayName, "pt-BR"));
  const cheio = !!marcados && marcados.length >= FOLLOW_MAX;
  return (
    <ul className="sv-pp">
      {sorted.map((h) => {
        const esfera = esferaDoCargo(h.mandate.office);
        return (
          <li key={`${h.person.id}-${h.mandate.id}`}>
            <Link href={`/pessoa/${h.person.slug}`}>{h.person.displayName}</Link>
            <span className="sv-pp__c">
              {h.officeName}, {h.placeLabel} · {h.party.acronym}
            </span>
            <span className="sv-esf">Esfera: {esfera ?? "ainda não temos esse dado"}</span>
            {marcados && <MarcarPessoa slug={h.person.slug} nome={h.person.displayName} on={marcados.includes(h.person.slug)} cheio={cheio} />}
          </li>
        );
      })}
    </ul>
  );
}
