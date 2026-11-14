import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";

export default function PropostaNaoEncontrada() {
  return (
    <Container className="max-w-3xl">
      <PageHeader title="Proposta não encontrada" lead="Este endereço não corresponde a uma proposta que passou pela nossa regra." />
      <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/pauta" className="font-semibold text-accent-text underline underline-offset-2">
          Ver a pauta
        </Link>
        <Link href="/como-escolhemos" className="text-accent-text underline underline-offset-2">
          Como escolhemos
        </Link>
      </p>
    </Container>
  );
}
