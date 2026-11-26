import { FALHOU_LEITURA } from "./estados";
import { COOKIE_TEXTO } from "./prefs-shared";
import { salvarTemas } from "./temas-actions";
import { TEMAS_MAX } from "./temas-escolhidos";
import type { Topic } from "@/lib/data";

/**
 * Filtro por assunto escolhido em /votacoes (F5 do roteiro do eleitor, B1). O assunto é o tema oficial ligado à proposta votada. O leitor
 * marca até TEMAS_MAX assuntos; o servidor guarda no cookie sv_temas e monta a lista já filtrada, sem JavaScript. A escolha é do leitor:
 * o site não decide o que importa a ele nem classifica nenhum assunto como mais ou menos relevante (lista A–Z, sem número de votações).
 * `topics` null = a lista de assuntos não pôde ser lida (lacuna nomeada, e a lista de votações aparece sem filtro).
 */
export function FiltroTemas({ topics, escolhidos, voltar }: { topics: Topic[] | null; escolhidos: string[]; voltar: string }) {
  if (!topics) {
    return (
      <p className="sv-lac" data-filtro-temas="falhou">
        <span className="sv-lac__liso">{FALHOU_LEITURA} Os assuntos para filtrar não puderam ser lidos agora, e a lista abaixo está sem filtro.</span>
      </p>
    );
  }
  // na ordem da lista (A–Z), não na ordem em que foram marcados: o site não reordena a escolha do leitor
  const nomes = topics.filter((t) => escolhidos.includes(t.slug)).map((t) => t.name);
  return (
    <div className="sv-ft" data-filtro-temas={escolhidos.length > 0 ? "ligado" : "desligado"}>
      <h3 className="sv-ft__t">Assuntos que importam para você</h3>
      {escolhidos.length > 0 ? (
        <p className="sv-t" data-assuntos-escolhidos>
          Mostrando só: {nomes.join(", ")}.
        </p>
      ) : (
        <p className="sv-t">Você pode ver só as votações de alguns assuntos (até {TEMAS_MAX}).</p>
      )}
      <details className="sv-ft__d">
        <summary>{escolhidos.length > 0 ? "Trocar os assuntos" : "Escolher assuntos"}</summary>
        <form action={salvarTemas} className="sv-ft__f">
          <input type="hidden" name="voltar" value={voltar} />
          <fieldset className="sv-ft__fs">
            <legend className="sv-vh">Assuntos, em ordem alfabética</legend>
            <ul className="sv-ft__l">
              {topics.map((t) => (
                <li key={t.slug} className="sv-chk">
                  <input type="checkbox" id={`ft-${t.slug}`} name="tema" value={t.slug} defaultChecked={escolhidos.includes(t.slug)} />
                  <label htmlFor={`ft-${t.slug}`}>{t.name}</label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="sv-ft__b">
            <button type="submit" className="sv-btn">
              Mostrar só estes assuntos
            </button>
            {escolhidos.length > 0 && (
              <button type="submit" name="acao" value="limpar" className="sv-btn sv-btn--vazio">
                Ver todos os assuntos
              </button>
            )}
          </div>
        </form>
      </details>
      <p className="sv-nota">
        Assunto é o tema oficial ligado à proposta votada. Votação sem proposta ligada não tem assunto e fica fora quando você filtra. {COOKIE_TEXTO}
      </p>
    </div>
  );
}
