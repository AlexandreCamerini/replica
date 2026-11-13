import { FALHOU_LEITURA } from "./estados";
import { Lacuna, Proxima, Quadro } from "./ui";

// Tela inteira quando a leitura principal falhou (fonte fora, exceção do banco): lacuna nomeada, nunca 500 nem "não existe".
// Distinto do 404: o registro pode existir; só não conseguimos lê-lo agora.
export function FalhaDeLeitura({ titulo, pergunta, oQue, proxima }: { titulo: string; pergunta: string; oQue: string; proxima: { href: string; pergunta: string } }) {
  return (
    <div className="sv-pg">
      <div className="sv-folio sv-folio--dom">
        <h1>{titulo}</h1>
        <p className="sv-intro">A fonte não pôde ser lida agora.</p>
      </div>
      <Quadro id="falha-1" variante="lacuna" numero={1} pergunta={pergunta}>
        <Lacuna motivo={`Não conseguimos ler ${oQue} agora. Tente de novo em alguns minutos.`}>{FALHOU_LEITURA}</Lacuna>
        <p className="sv-t">Isso não quer dizer que o registro não existe: a leitura falhou.</p>
      </Quadro>
      <Proxima href={proxima.href} pergunta={proxima.pergunta} />
    </div>
  );
}
