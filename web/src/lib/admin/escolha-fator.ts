// Qual fator TOTP pode ser desafiado (achado A4). Módulo PURO.
// Com fator já VERIFICADO na conta, só ele vale: o `fatorId` vindo do cliente é ignorado (um fator `unverified` criado direto na API do provedor não sobe a sessão para aal2).
// Fator `unverified` só é aceito quando não existe nenhum verificado: é o primeiro cadastro.
// Limite registrado (TOFU): o primeiro cadastro de TOTP é confiança no primeiro uso. Entre incluir alguém em `adm_admins` e a pessoa cadastrar o fator, quem tiver a caixa de e-mail dela
// cadastra o próprio autenticador. Mitigação operacional: cadastro do primeiro fator acompanhado pelo dono, ou `ativo=false` até lá.

export type FatorDaLista = { id: string; factor_type: string; status: string };

export function escolherFator<F extends FatorDaLista>(todos: readonly F[], pedido: string): F | undefined {
  const totp = todos.filter((f) => f.factor_type === "totp");
  const verificados = totp.filter((f) => f.status === "verified");
  if (verificados.length > 0) return verificados[0];
  return pedido === "" ? undefined : totp.find((f) => f.id === pedido && f.status === "unverified");
}
