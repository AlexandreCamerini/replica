import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Governos" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S12" title="Governos" purpose="Mandatos do Executivo lado a lado, com indicadores oficiais ano a ano." release="R5" />
    </Container>
  );
}
