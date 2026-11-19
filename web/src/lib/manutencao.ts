// Modo manutenção do site (runbook-railway §3; plano autônomo, etapa 4). Módulo PURO.
// Durante a cópia do banco no corte para o Railway, nada pode escrever no banco de origem: o que fosse gravado depois do dump
// (conta nova, código de login, acompanhamento, sugestão) se perderia. Com MAINTENANCE=1 na Vercel, as server actions que
// escrevem (lib/account.ts) recusam com o aviso abaixo e o casco mostra o mesmo aviso. A leitura continua no ar.
// Liga e desliga trocando a variável (e fazendo redeploy): é reversível e não mexe em código.
// Valor exato "1": qualquer outro (inclusive "true" ou " 1") deixa o site normal, para um erro de digitação não travar o login.

export const AVISO_MANUTENCAO = "O site está em manutenção por alguns minutos: dá para ler tudo, mas entrar, criar conta, acompanhar e enviar sugestões voltam logo.";

export function emManutencao(env: Record<string, string | undefined>): boolean {
  return env.MAINTENANCE === "1";
}
