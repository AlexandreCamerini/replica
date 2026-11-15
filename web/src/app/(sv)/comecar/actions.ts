"use server";

// Ação do começo em dois passos (/comecar). Só funções async aqui. Nenhum cookie novo: a cidade vai no mesmo `sv_esferas`
// que os Ajustes gravam, pela mesma ação (`salvarEsferas`), que valida a cidade contra o estado guardado e redireciona.
import { cookies } from "next/headers";
import { ESFERAS_COOKIE, ESFERAS_PADRAO, parseCidade, parseEsferas, readPrefs } from "@/components/sv/prefs";
import { salvarEsferas } from "../ajustes/actions";

/**
 * Passo 1, cidade (opcional). O formulário do começo só tem o campo `cidade`; `salvarEsferas` regrava as duas esferas a
 * partir do POST, e um POST só com a cidade desligaria a Assembleia. Por isso esta ação monta o pedido completo: mantém a
 * esfera estadual como está e liga a municipal só quando veio uma cidade (é para isso que a cidade serve).
 * Cidade vazia, fora do padrão, de outro estado ou sem estado guardado: nenhuma cidade guardada e a esfera municipal
 * desligada (a cidade é conferida aqui contra o estado do cookie, antes de ligar a esfera). Depois, passo 2.
 */
export async function salvarCidadeDoComeco(form: FormData): Promise<void> {
  const [prefs, jar] = await Promise.all([readPrefs(), cookies()]);
  const atual = parseEsferas(jar.get(ESFERAS_COOKIE)?.value) ?? ESFERAS_PADRAO;
  // só vale cidade do estado guardado; sem estado lido não há como conferir, então nenhuma cidade é aceita
  const cidade = prefs.uf ? (parseCidade(String(form.get("cidade") ?? ""), prefs.uf.ibge) ?? "") : "";
  const pedido = new FormData();
  pedido.set("esferas", "1");
  // com fragmento próprio: sem ele, o navegador sem JavaScript reaproveita o "#cm-cidade" do endereço anterior
  pedido.set("voltar", "/comecar?passo=2#cm-pessoas");
  if (atual.estadual) pedido.set("estadual", "on");
  if (cidade) pedido.set("municipal", "on");
  pedido.set("cidade", cidade);
  await salvarEsferas(pedido); // grava e redireciona (ou volta com ?erro=leitura, sem gravar, se a lista de estados falhar)
}
