import { FalhaDeLeitura } from "@/components/sv/falha-leitura";

// Pessoa e suas rotas (gastos, equipe, votos) quando a leitura do cadastro falhou: lacuna nomeada, nunca 500 nem 404.
export function PessoaNaoLida() {
  return <FalhaDeLeitura titulo="Quem é esta pessoa?" pergunta="Que cargo ocupa?" oQue="o cadastro desta pessoa" proxima={{ href: "/v2/pessoas", pergunta: "Quem está no cargo?" }} />;
}
