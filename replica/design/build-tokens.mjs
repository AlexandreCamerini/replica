#!/usr/bin/env node
// tokens.json -> tokens.css (custom properties, claro/escuro) + tailwind-theme.css (@theme do Tailwind v4).
// Uso: node replica/design/build-tokens.mjs [--out <dir>]   (copia também para web/src/styles/ se existir)
// Falha (exit 1) se um token referenciado no mapeamento não existir ou se o escuro não espelhar o claro.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

const { dark, ...light } = t.color;
const errors = [];
for (const k of Object.keys(light)) if (!(k in dark)) errors.push(`color.dark.${k} ausente`);
for (const k of Object.keys(dark)) if (!(k in light)) errors.push(`color.${k} sem par no claro`);
for (const [k, v] of Object.entries({ ...light, ...dark }))
  if (!/^#[0-9a-f]{6}$/i.test(v)) errors.push(`cor inválida ${k}=${v}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const px = (n) => `${n}px`;
const rem = (n) => `${n / 16}rem`;
const vars = (obj, p = "") => Object.entries(obj).map(([k, v]) => `  --${p}${k}: ${v};`).join("\n");

const base = {};
for (const [k, v] of Object.entries(t.font)) base[`font-${k}`] = v;
for (const [k, v] of Object.entries(t.type)) {
  if (k.startsWith("_")) continue;
  base[`text-${k}`] = rem(v.size);
  base[`leading-${k}`] = rem(v.line);
  base[`weight-${k}`] = v.weight;
}
// display/hero encolhem no mobile sem media query
base["text-hero"] = `clamp(2.5rem, 1.6rem + 4vw, ${rem(t.type.hero.size)})`;
base["leading-hero"] = "0.95";
base["text-display"] = `clamp(2rem, 1.6rem + 1.6vw, ${rem(t.type.display.size)})`;
base["leading-display"] = "1";
t.space.forEach((v, i) => (base[`space-${i}`] = px(v)));
for (const [k, v] of Object.entries(t.radius)) base[`radius-${k}`] = px(v);
for (const [k, v] of Object.entries(t["border-width"])) base[`border-${k}`] = px(v);
for (const [k, v] of Object.entries(t.shadow)) base[`shadow-${k}`] = v;
for (const [k, v] of Object.entries(t.motion)) base[`motion-${k}`] = v;
for (const [k, v] of Object.entries(t.layout)) if (typeof v === "number") base[`layout-${k}`] = px(v);

const header = "/* GERADO por replica/design/build-tokens.mjs a partir de tokens.json. Não edite à mão. */\n";
const tokensCss = `${header}
:root {
  color-scheme: light;
${vars(light)}
${vars(base, "ds-")}
}

/* escuro: segue o sistema, a menos que o usuário escolha; data-theme vence */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${vars(dark).replace(/^/gm, "  ")}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
${vars(dark)}
}

@media (prefers-reduced-motion: reduce) {
  :root { --ds-motion-fast: 0ms; --ds-motion-base: 0ms; --ds-motion-enter: 0ms; }
}
`;

// Tailwind v4: classes bg-surface, text-muted, border-input, rounded-md, font-display...
const colorMap = Object.keys(light)
  .map((k) => {
    const name = { text: "fg", "text-muted": "muted" }[k] ?? k; // classes text-fg / text-muted, não text-text
    return `  --color-${name}: var(--${k});`;
  })
  .join("\n");
const breakpoints = Object.entries(t.layout.breakpoints).map(([k, v]) => `  --breakpoint-${k}: ${rem(v)};`).join("\n");
const typeMap = Object.keys(t.type)
  .filter((k) => !k.startsWith("_"))
  .map((k) => `  --text-${k}: var(--ds-text-${k});\n  --text-${k}--line-height: var(--ds-leading-${k});\n  --text-${k}--font-weight: var(--ds-weight-${k});`)
  .join("\n");
const twCss = `${header}
@theme inline {
  --color-*: initial;
  --color-transparent: transparent;
  --color-current: currentColor;
${colorMap}
  --font-*: initial;
  --font-sans: var(--ds-font-sans);
  --font-display: var(--ds-font-display);
  --font-mono: var(--ds-font-mono);
  --text-*: initial;
${typeMap}
  --radius-*: initial;
${Object.keys(t.radius).map((k) => `  --radius-${k}: var(--ds-radius-${k});`).join("\n")}
  --shadow-*: initial;
${Object.keys(t.shadow).map((k) => `  --shadow-${k}: var(--ds-shadow-${k});`).join("\n")}
  --breakpoint-*: initial;
${breakpoints}
  --spacing: 4px;
  --ease-out: var(--ds-motion-ease);
  --default-transition-duration: var(--ds-motion-base);
  --default-transition-timing-function: var(--ds-motion-ease);
}
`;

const outs = [here];
const web = resolve(here, "../../web/src/styles");
if (existsSync(resolve(web, ".."))) { mkdirSync(web, { recursive: true }); outs.push(web); }
for (const dir of outs) {
  writeFileSync(join(dir, "tokens.css"), tokensCss);
  writeFileSync(join(dir, "tailwind-theme.css"), twCss);
}
console.log(`ok: ${Object.keys(light).length} cores x 2 temas, ${Object.keys(base).length} tokens base -> ${outs.join(", ")}`);
