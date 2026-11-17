// Prazo para chamadas ao provedor de login (Supabase Auth). Puro: usado pelo middleware e pela sessão.
// Sem prazo, o supabase-js tenta de novo com espera crescente quando o provedor está fora do ar, e cada requisição da central ficava presa ~25 s
// antes do 404 (achado da prova F3-T5): lentidão e negação de serviço. Estourado o prazo, a chamada conta como falha, e falha do provedor fecha (404).
export const PRAZO_AUTH_MS = 4000;

export function comPrazo<T>(p: Promise<T>, ms: number = PRAZO_AUTH_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    t = setTimeout(() => rejeitar(new Error("prazo do provedor de login estourado")), ms);
  });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}
