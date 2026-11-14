"use client";

import { FALHOU_LEITURA } from "@/components/sv/estados";

// Rede de segurança do /v2: exceção que nenhuma página tratou. As páginas tratam a própria leitura (lacuna nomeada,
// FalhaDeLeitura); isto só aparece se algo escapar. Nunca a tela de erro padrão do Next, nunca detalhe da exceção.
export default function ErroV2({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="sv-pg">
      <div className="sv-folio sv-folio--dom">
        <h1>Esta página não pôde ser montada agora.</h1>
        <p className="sv-intro">{FALHOU_LEITURA}</p>
      </div>
      <p className="sv-t">Isso não quer dizer que o registro não existe: a leitura falhou. Tente de novo em alguns minutos.</p>
      <p className="sv-t">
        <button type="button" className="sv-btn" onClick={() => reset()}>
          Tentar de novo
        </button>
      </p>
    </div>
  );
}
