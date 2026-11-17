// Tempo mínimo de resposta das ações de entrada (achado A3): a resposta é neutra, mas a latência não podia ser: só para admin há ida ao provedor de login. Módulo PURO, com relógio injetável.
// Limite registrado: o limite de ritmo por IP e por e-mail fica no Supabase Auth. O da aplicação exigiria escrita em banco, e o role da central (`admin_central`) não escreve em nada fora de `adm_pedidos*`.

export type Relogio = { agora: () => number; dormir: (ms: number) => Promise<void> };
export const RELOGIO_REAL: Relogio = { agora: () => Date.now(), dormir: (ms) => new Promise((r) => setTimeout(r, ms)) };
export const PISO_ENTRADA_MS = 1500;

/** Roda `trabalho` e só devolve (ou lança) depois de `piso` ms desde o início. Se o trabalho passar do piso, devolve quando ele termina. */
export async function completarAte<T>(piso: number, trabalho: () => Promise<T>, r: Relogio = RELOGIO_REAL): Promise<T> {
  const t0 = r.agora();
  try {
    return await trabalho();
  } finally {
    const falta = piso - (r.agora() - t0);
    if (falta > 0) await r.dormir(falta);
  }
}

/**
 * Responde NO piso, sempre, e deixa o trabalho continuar: `pendente` é a promessa dele (nunca rejeita), para o chamador entregar a `after()` do Next e a função não ser congelada antes de o
 * provedor responder. Assim a latência da resposta não depende de o trabalho ter ido ao provedor ou não, mesmo quando o provedor demora mais que o piso.
 */
export async function responderNoPiso(piso: number, trabalho: () => Promise<void>, r: Relogio = RELOGIO_REAL): Promise<{ pendente: Promise<void> }> {
  const pendente = Promise.resolve()
    .then(trabalho)
    .catch(() => undefined);
  await r.dormir(piso);
  return { pendente };
}
