import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "STF" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S15" title="STF" purpose="Pauta, ministros e processos do Supremo." release="R5" />
    </Container>
  );
}
