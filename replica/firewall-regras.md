# Regras de firewall da Vercel: limite por IP no login

Estado em 19/11/2026: **não aplicado**. A API de firewall não está liberada para a conexão do Claude com a Vercel (404 em `get_firewall_config`), então as regras são aplicadas pelo painel ou pela CLI.

## Por que é obrigatório antes do corte

- Na D336, o login `pg` do site ganhou um teto global de 300 envios de código por hora.
- Sem limite por IP, quem resolve 300 captchas por hora esgota esse teto e derruba o login do site inteiro.
- O mesmo vale para a entrada da central, que limita por e-mail, mas não por IP.

O limite precisa estar no firewall, porque a aplicação não tem limite por IP.

O rate limiting do firewall depende do plano da equipe na Vercel. Confira no painel em Firewall > Rules > "Rate Limit". Se o plano não oferecer, a alternativa é a ação "challenge" em vez de limite.

## Regra 1: site (projeto `replica`)

- **Nome:** `login: limite por IP`.
- **Condições** (todas):
  - Method igual a `POST`;
  - o cabeçalho `Next-Action` existe, em **qualquer caminho**.

  As server actions do login (`sendCode`, `verifyCode`) são chamadas com POST e esse cabeçalho. O Next encaminha a action a partir de qualquer rota (`POST /pessoas` com o id do `sendCode` executa o `sendCode`), então um limite só em `/entrar` seria contornado. A regra cobre também acompanhar, sugestões e ajustes; o limite foi escolhido para não atrapalhar quem usa o site normalmente.
- **Ação:** Rate Limit.
  - Algoritmo: Fixed Window.
  - Janela: 60 s.
  - Limite: 20 pedidos.
  - Chave: IP.
  - Ao estourar: Deny por 5 min.
  - Operadora móvel com CGNAT põe muita gente atrás de um IP. Se aparecer reclamação de bloqueio, troque o Deny por Challenge antes de subir o limite.
- **Teste depois de aplicar:**
  - 22 POSTs seguidos de um mesmo IP com o cabeçalho `Next-Action`: a partir do 21º, 429 ou 403.
  - GETs seguem 200.

Corpo equivalente para a API (`update_firewall_config`, ação `rules.insert`), para quando a conexão tiver acesso:

```json
{
  "action": "rules.insert",
  "id": null,
  "value": {
    "name": "login: limite por IP",
    "description": "D336: o teto global de envio de código (300/h) não pode virar negação de serviço",
    "active": true,
    "conditionGroup": [
      { "conditions": [
        { "type": "method", "op": "eq", "value": "POST" },
        { "type": "header", "key": "next-action", "op": "ex" }
      ] }
    ],
    "action": { "mitigate": {
      "action": "rate_limit",
      "rateLimit": { "algo": "fixed_window", "window": 60, "limit": 20, "keys": ["ip"], "action": "deny" },
      "actionDuration": "5m"
    } }
  }
}
```

## Regra 2: central (projeto `admin.`, quando existir)

A central não usa server action (as rotas de entrada são de API). A regra é por caminho:

- Method `POST` e path começando com `/admin/api/entrar`;
- limite de 10 por 60 s por IP, Deny por 5 min.

As rotas da central já respondem num tempo fixo de 1,5 s. O limite corta a força bruta distribuída por e-mail.

## Volta

Desligar a regra (`active: false`) no painel. O efeito é imediato e não precisa de redeploy.
