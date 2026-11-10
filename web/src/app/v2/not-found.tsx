import { Label, List, Row } from "@/components/sv/ui";

export default function NotFound() {
  return (
    <>
      <h1 className="sv-title">Não consta</h1>
      <p className="sv-lead sv-mt-2">Não encontramos esta página. O endereço pode ter mudado, ou o registro ainda não foi carregado.</p>
      <div className="sv-mt-5" style={{ maxWidth: 520 }}>
        <Label>Continue por aqui</Label>
        <List>
          <Row href="/v2" label="Quem decide por você" value="→" on />
          <Row href="/v2/decisoes" label="Decisões" value="→" on />
          <Row href="/v2/votacoes" label="Votações" value="→" on />
          <Row href="/v2/pessoas" label="Pessoas" value="→" on />
        </List>
      </div>
    </>
  );
}
