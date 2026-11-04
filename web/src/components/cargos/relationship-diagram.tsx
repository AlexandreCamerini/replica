// Diagrama de "quem faz o quê com quem". O SVG é um resumo visual (role="img" com descrição);
// a mesma informação completa está na lista logo abaixo, na página.
const BOX = "fill-surface stroke-border";
const TXT = "fill-fg";
const ARR = "stroke-fg";

function Node({ x, y, w = 150, title, sub }: { x: number; y: number; w?: number; title: string; sub: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={62} rx={8} className={BOX} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + 27} textAnchor="middle" className={TXT} fontSize={17} fontWeight={700}>
        {title}
      </text>
      <text x={x + w / 2} y={y + 48} textAnchor="middle" className={TXT} fontSize={13}>
        {sub}
      </text>
    </g>
  );
}

function Arrow({ d, label, lx, ly }: { d: string; label: string; lx: number; ly: number }) {
  return (
    <g>
      <path d={d} className={ARR} strokeWidth={1.8} fill="none" markerEnd="url(#seta)" />
      <text x={lx} y={ly} textAnchor="middle" className={TXT} fontSize={14} fontWeight={600} paintOrder="stroke" stroke="var(--color-bg, #fff)" strokeWidth={4}>
        {label}
      </text>
    </g>
  );
}

export function RelationshipDiagram() {
  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 640 350"
        role="img"
        aria-labelledby="diag-t diag-d"
        className="h-auto w-full max-w-[720px] rounded-sm border border-border bg-surface"
      >
        <title id="diag-t">Quem faz o quê com quem</title>
        <desc id="diag-d">
          Os eleitores elegem o Executivo e o Legislativo. O Executivo sanciona ou veta o que o Legislativo aprova. O Legislativo
          fiscaliza o Executivo. O Executivo nomeia os ministros do Judiciário e o Senado os aprova. O Judiciário julga os atos
          dos outros dois poderes. A lista abaixo traz o mesmo conteúdo em texto.
        </desc>
        <defs>
          <marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-fg" />
          </marker>
        </defs>
        <Node x={235} y={14} title="Eleitores" sub="voto direto" w={170} />
        <Node x={10} y={236} title="Executivo" sub="chefes de governo" w={180} />
        <Node x={230} y={236} title="Legislativo" sub="parlamentares" w={180} />
        <Node x={450} y={236} title="Judiciário" sub="juízes e tribunais" w={180} />
        <Arrow d="M275,76 L110,234" label="elegem" lx={170} ly={140} />
        <Arrow d="M340,76 L320,234" label="elegem" lx={355} ly={150} />
        <Arrow d="M192,267 L228,267" label="" lx={0} ly={0} />
        <text x={210} y={228} textAnchor="middle" className={TXT} fontSize={13}>
          sanciona/veta
        </text>
        <Arrow d="M320,300 C320,334 100,334 100,302" label="fiscaliza" lx={210} ly={338} />
        <Arrow d="M540,234 C540,196 170,196 150,232" label="julga os atos" lx={400} ly={190} />
      </svg>
      <figcaption className="mt-2 max-w-[68ch] text-sm text-muted">
        Resumo visual. O Executivo sanciona ou veta leis e nomeia ministros do STF (o Senado aprova); o Legislativo fiscaliza o
        Executivo; o Judiciário julga atos dos outros dois.
      </figcaption>
    </figure>
  );
}
