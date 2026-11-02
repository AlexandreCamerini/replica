import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Sugerir ou corrigir" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S25" title="Sugerir ou corrigir" purpose="Mande uma ideia, um dado que falta ou um erro que você achou." release="R2" />
    </Container>
  );
}
