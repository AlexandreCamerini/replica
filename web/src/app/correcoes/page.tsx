import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";

export const metadata: Metadata = { title: "Correções", description: "Toda resposta corrigida, com data e motivo." };

// Ainda não há resposta publicada (todas aguardam revisão), logo não há o que corrigir. A lista entra junto com a revisão.
export default function Correcoes() {
  return (
    <Container className="max-w-3xl">
      <PageHeader title="Correções" lead="Toda resposta corrigida aparece aqui, com data e motivo." />
      <p className="text-base text-fg">Nenhuma correção publicada até agora.</p>
      <p className="mt-2 text-sm text-muted">
        As respostas sobre cada proposta ainda aguardam revisão. Quando forem publicadas, cada correção entra nesta lista.{" "}
        <Link href="/como-escolhemos#revisao" className="text-accent-text underline underline-offset-2">
          Como revisamos
        </Link>
      </p>
    </Container>
  );
}
