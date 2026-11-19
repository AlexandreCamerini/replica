// Classificação de falhas para a tela (funções puras): o que o operador vê quando uma leitura ou um pedido falha, e o que ele pode fazer.
// A entrada é só o que o navegador sabe: o status HTTP (ou "sem resposta"), e, se veio, o texto de `erro` do corpo JSON. Nenhum detalhe técnico vai para a tela.
// Mapeamento (conforme respostaDeErro em consultas.ts e a guarda): 404 sem corpo = sessão expirada ou central fechada; 503 = banco; 403 = recusado pelo servidor; 429 = ritmo;
// 400 = pedido inválido (a mensagem do corpo é de validação e é mostrada); 404 com `erro` = não encontrado; 5xx restante = falha da central; sem resposta = rede.

export type TipoFalha = "banco" | "sessao" | "rede" | "recusado" | "limite" | "validacao" | "nao_encontrado" | "servidor";

export type Falha = {
  tipo: TipoFalha;
  /** título curto (vira o h2 do aviso) */
  titulo: string;
  /** o que aconteceu, em uma frase */
  mensagem: string;
  /** a próxima ação do operador */
  acao: string;
  /** destino de "entrar de novo", só na falha de sessão */
  href?: string;
  /** vale tentar de novo sem mudar nada (a consulta periódica tenta sozinha) */
  tentarDeNovo: boolean;
};

export type EntradaFalha = { status?: number | null; rede?: boolean; mensagem?: string | null };

export const ROTA_ENTRAR = "/admin/entrar";

export function classificarFalha(e: EntradaFalha): Falha {
  const status = typeof e.status === "number" ? e.status : null;
  if (e.rede || status === null || status === 0) {
    return { tipo: "rede", titulo: "Sem conexão com a central", mensagem: "A tela não conseguiu falar com a central. Pode ser sua conexão ou a central fora do ar.", acao: "Confira sua conexão. A tela tenta de novo sozinha; seu trabalho aberto não foi perdido.", tentarDeNovo: true };
  }
  if (status === 429) {
    return { tipo: "limite", titulo: "Pedidos demais em pouco tempo", mensagem: "O servidor limitou os pedidos deste operador (no máximo 20 por minuto).", acao: "Espere cerca de um minuto e envie de novo.", tentarDeNovo: false };
  }
  if (status === 403) {
    return { tipo: "recusado", titulo: "O servidor recusou o pedido", mensagem: e.mensagem && e.mensagem.trim() !== "" ? e.mensagem : "O servidor recusou esta ação para o seu acesso.", acao: "Recarregue a página e tente de novo. Se continuar, peça a um administrador para conferir seu cadastro.", tentarDeNovo: false };
  }
  if (status === 404) {
    if (e.mensagem && e.mensagem.trim() !== "") return { tipo: "nao_encontrado", titulo: "Item não encontrado", mensagem: e.mensagem, acao: "Volte à lista e abra o item de novo.", tentarDeNovo: false };
    return { tipo: "sessao", titulo: "Sua sessão expirou", mensagem: "A central não reconheceu mais o seu acesso (sessão expirada ou central fechada).", acao: "Entre de novo. O que você digitou fica guardado neste navegador.", href: ROTA_ENTRAR, tentarDeNovo: false };
  }
  if (status === 400) {
    return { tipo: "validacao", titulo: "O pedido não foi aceito", mensagem: e.mensagem && e.mensagem.trim() !== "" ? e.mensagem : "Os dados do pedido não passaram na validação.", acao: "Corrija o que a mensagem aponta e envie de novo.", tentarDeNovo: false };
  }
  if (status === 503) {
    return { tipo: "banco", titulo: "Não foi possível ler o banco", mensagem: "A central não conseguiu consultar o banco agora. Os números já na tela são da última leitura que deu certo.", acao: "Tente de novo em instantes. Se persistir, o banco da coleta pode estar fora do ar.", tentarDeNovo: true };
  }
  return { tipo: "servidor", titulo: "A central falhou ao responder", mensagem: "Ocorreu um erro interno na central. Nenhum detalhe técnico é mostrado aqui.", acao: "Tente de novo em instantes. Se persistir, avise quem mantém a central.", tentarDeNovo: true };
}

/** Falha de leitura de uma PÁGINA (o servidor já sabe: erro de banco). Mesmo texto do tipo "banco". */
export const FALHA_BANCO: Falha = classificarFalha({ status: 503 });

/** A falha mudou de natureza (ou apareceu / sumiu)? Usado para não reanunciar o mesmo aviso a cada tentativa da consulta periódica. */
export const mesmaFalha = (a: Falha | null, b: Falha | null): boolean => (a === null && b === null) || (a !== null && b !== null && a.tipo === b.tipo);
