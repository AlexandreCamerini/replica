import { notFound } from "next/navigation";

// Endereço inexistente sob /v2 (ex.: /v2/nao-existe): cai no 404 do próprio /v2 (v2/not-found.tsx), dentro do casco novo.
// Sem isto, o Next responde com a página 404 padrão, fora do /v2. Rotas reais do /v2 têm precedência sobre este coringa.
export default function Resto(): never {
  notFound();
}
