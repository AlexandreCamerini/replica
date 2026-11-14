import { alternarEscolhido } from "./follow-actions";
import { FOLLOW_MAX } from "./follow-shared";
import { COOKIE_TEXTO } from "./prefs-shared";

/**
 * Marca ou desmarca uma pessoa como "em quem eu votei". É um formulário que envia para o servidor: funciona sem
 * JavaScript, e o cookie é gravado com `httpOnly` (D317). O estado (`on`, `cheio`) vem da página, que já leu o cookie.
 */
export function FollowButton({ slug, name, on, cheio }: { slug: string; name: string; on: boolean; cheio: boolean }) {
  return (
    <form action={alternarEscolhido}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="acao" value={on ? "remover" : "incluir"} />
      <button className="sv-follow" type="submit" aria-pressed={on} disabled={!on && cheio}>
        {on ? "Você acompanha" : "Votei nesta pessoa: acompanhar"}
      </button>
      <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }} role="status">
        {on ? `${name} aparece em destaque na sua página inicial.` : cheio ? `Você já acompanha ${FOLLOW_MAX} pessoas, o limite. Tire alguém para incluir.` : COOKIE_TEXTO}
      </p>
    </form>
  );
}
