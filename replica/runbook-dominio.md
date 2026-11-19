# Runbook: www.segueovoto.com.br no ar

Estado em 19/11/2026: **não executado**. O site roda na Vercel; o que falta é o DNS.

## O que já está pronto, conferido pela API da Vercel

- O projeto `replica` tem `www.segueovoto.com.br`, que é o domínio de produção, e `segueovoto.com.br`, que faz 308 para o `www`. Os dois estão verificados.
- O domínio está na equipe da Vercel com zona DNS própria. A Vercel espera os servidores `ns1.vercel-dns.com` e `ns2.vercel-dns.com`.
- A zona da Vercel já tem os registros, todos criados pela própria Vercel:
  - `ALIAS` no apex;
  - `ALIAS` curinga (`*`), que cobre o `www`;
  - três `CAA`: Let's Encrypt, Sectigo e Google.
- O domínio no registro.br ainda aponta para `a.auto.dns.br` e `b.auto.dns.br`, o padrão de quem não configurou DNS. A Vercel marca `misconfigured: true`.

## Caminho recomendado: delegar o domínio para a Vercel

No registro.br, abra o domínio e procure **Alterar servidores DNS**. Não é a edição de zona.

Antes de salvar, confira se o domínio tem **DNSSEC** ligado. O DNS automático do registro.br costuma vir assinado. Se ficar um registro DS apontando para as chaves antigas depois da troca, o domínio inteiro passa a falhar na resolução (SERVFAIL). Desligue o DNSSEC no registro.br antes, ou na mesma tela.

| Campo | Valor |
|---|---|
| Servidor 1 | `ns1.vercel-dns.com` |
| Servidor 2 | `ns2.vercel-dns.com` |

Não é preciso criar nenhum registro: a zona da Vercel já responde pelo apex e pelo `www`.

O `.br` costuma publicar em minutos ou em poucas horas. Para voltar, troque de novo para os servidores do Registro.br. A zona antiga estava vazia, então não há o que restaurar.

Consequência: todo o DNS do domínio passa a ser gerido na Vercel. Isso inclui os registros de e-mail do Resend, que entram antes do corte para o Railway.

## Alternativa: zona no próprio registro.br

Use só se a delegação for recusada. Ative a edição de zona e crie dois registros:

| Nome | Tipo | Valor |
|---|---|---|
| `segueovoto.com.br` | `A` | `76.76.21.21` |
| `www` | `CNAME` | `cname.vercel-dns.com.` |

Nesse caso, os registros do Resend também ficam no registro.br.

## Depois do DNS, na mesma sessão

Nada disto bloqueia o site abrir. Bloqueia o login no domínio novo.

1. **`SITE_URL`** em Production na Vercel: `https://www.segueovoto.com.br`, e redeploy. Confirme antes de mergear a #61. Com `SITE_URL` definido, o `robots.txt` libera a indexação em qualquer host que o sirva, inclusive o alias `*.vercel.app` de produção, e anuncia o sitemap da origem do `SITE_URL`. Por isso o valor tem de ser o `www`.
2. **Supabase Auth**, em URL Configuration:
   - Site URL: `https://www.segueovoto.com.br`
   - Redirect URLs: incluir `https://www.segueovoto.com.br/**`
   - Vale enquanto `AUTH_PROVIDER=supabase`.
3. **Turnstile**, na chave de produção: incluir os hostnames `www.segueovoto.com.br` e `segueovoto.com.br`.
4. **GitHub**, **secret** `REVALIDATE_URL` (os workflows leem `secrets.REVALIDATE_URL`): `gh secret set REVALIDATE_URL --repo AlexandreCamerini/replica --body https://www.segueovoto.com.br/api/revalidate`.

## Aceite

0. `dig +short DS segueovoto.com.br` vazio, sem DNSSEC sobrando.
1. `dig +short NS segueovoto.com.br` devolve `ns1.vercel-dns.com.` e `ns2.vercel-dns.com.`. Na alternativa, `dig +short A segueovoto.com.br` devolve `76.76.21.21`.
2. `get_domain_config` (MCP da Vercel, equipe `team_zSfqr6b24BZaz2Wt7nJUloWT`) devolve `misconfigured: false` para o apex e para o `www`.
3. `curl -sSI https://www.segueovoto.com.br/` responde 200, com certificado válido.
4. `curl -sSI https://segueovoto.com.br/` responde 308 para `https://www.segueovoto.com.br/`.
5. Nenhum 500 em `/`, `/pessoas`, `/votacoes`, `/como-funciona`, numa página de pessoa e em `/entrar`.
6. `/robots.txt` e `/sitemap.xml` com URLs do `www`, depois da #61 e do `SITE_URL`.
7. Login por código completo no `www`: o dono faz uma vez, porque depende da caixa de e-mail.
