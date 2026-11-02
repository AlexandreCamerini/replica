import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Assistente (MCP)" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S27" title="Assistente (MCP)" purpose="Consulte os dados a partir do seu assistente de IA." release="R5" />
    </Container>
  );
}
