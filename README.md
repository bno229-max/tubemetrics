# TubeMetrics

SaaS de análise de métricas de canais do YouTube. Interface em português, paleta YouTube sobre
superfícies neutras estilo painel Stripe, dashboard interativo.

**Regra de ouro:** nenhum insight é gerado por IA. Todos os textos, rankings e recomendações saem
de agrupamento de arrays, aritmética e estatística descritiva — cada número exibido tem uma fórmula
documentada em [`assets/js/engine.js`](assets/js/engine.js).

---

> **Para colocar no ar com dados reais, siga o [SETUP.md](SETUP.md)** — passo a passo de
> 20 minutos, cobrindo tudo que funciona sem depender da aprovação do Google.
>
> **Para conectar um canal e ver receita, CTR e retenção, siga o
> [CONECTAR-CANAL.md](CONECTAR-CANAL.md)** — configuração do OAuth e o que ainda falta implementar.

## Como rodar

O front não tem build: é HTML + ES modules, zero dependências.

```bash
python -m http.server 8735 --directory web
```

Depois abra `http://localhost:8735`. Não abra por `file://` — módulos ES exigem origem HTTP.

Parâmetros úteis na URL durante o desenvolvimento:

| Parâmetro | Efeito |
|---|---|
| `?data=mock` | força dados simulados, sem gastar cota |
| `?data=live` | exige o backend; falha visível em vez de cair para o mock |
| `?publiconly=1` | remove dos dados simulados os campos que a API pública não entrega, para conferir a degradação antes de publicar |

O app instala como PWA (manifesto + service worker) e funciona offline: como todo o cálculo roda no
cliente, não há nada para buscar depois do primeiro carregamento.

## Publicação

No ar em **https://tubemetrics.vercel.app** — repositório `bno229-max/tubemetrics`, deploy
automático a cada `git push` na branch `main`. O `firebase.json` continua no projeto como espelho
opcional, mas a Vercel é o caminho principal.

O service worker usa *stale-while-revalidate* nos ativos: cada visita responde do cache na hora e
baixa a versão nova em segundo plano. Na prática, um deploy aparece para o usuário no segundo
carregamento — sem precisar bumpar o `CACHE` a cada publicação.

### Estado da sessão

Plano ativo, tema, cadastro, favoritos, histórico e cota ficam em `localStorage`. Para reiniciar:

```js
localStorage.removeItem('tubemetrics.state.v2')
```

Em `#/planos` dá para trocar de plano e ver os cadeados abrindo e fechando em tempo real.

---

## 1. Estrutura de pastas

```
tubemetrics/
├── SETUP.md                    # passo a passo de publicação (GitHub → Vercel)
├── vercel.json                 # aponta o estático para web/; api/ é detectado sozinho
├── firebase.json               # espelho opcional no Firebase Hosting
│
├── api/                        # backend: Serverless Functions da Vercel
│   ├── health.js               # GET /api/health   — diagnóstico, não gasta cota
│   ├── top.js                  # GET /api/top      — Top 20 por inscritos
│   ├── search.js               # GET /api/search   — busca canais (101 unidades)
│   ├── channel.js              # GET /api/channel  — relatório (~10 unidades)
│   ├── trending.js             # GET /api/trending — alta por país (1 unidade)
│   ├── growth.js               # GET /api/growth   — crescimento em 7/30/365 dias
│   ├── cron-snapshot.js        # coleta diária, agendada pelo Vercel Cron
│   ├── _youtube.js             # cliente da Data API v3 + normalização
│   ├── _store.js               # histórico diário (Upstash Redis REST)
│   └── _http.js                # respostas JSON e política de cache de borda
│
└── web/                        # front-end estático
    ├── index.html              # casca mínima; tudo é montado por JS
    ├── manifest.webmanifest
    ├── sw.js                   # network-first no HTML, stale-while-revalidate nos ativos
    ├── icons/icon.svg
    └── assets/
        ├── css/app.css         # design system inteiro: tokens, componentes, responsivo
            ├── app.js          # shell + roteador por hash + import() dinâmico das views
            ├── config.js       # ★ mock × backend real, num único lugar
            ├── api.js          # ★ fachada de dados, com fallback automático
            ├── engine.js       # ★ motor de análise (sem IA)
            ├── plans.js        # ★ feature flags e limites
            ├── store.js        # estado de sessão (plano, tema, cota, comparação)
            ├── mock-data.js    # gerador semeado com o shape das APIs do YouTube
            ├── charts.js       # gráficos SVG à mão
            ├── format.js       # formatação pt-BR
            ├── ui.js           # ícones, cartões, modal, toast, paywall
            └── views/
                ├── landing.js       # página pública de entrada
                ├── searchbox.js     # busca com sugestões, reaproveitada
                ├── discover.js      # catálogo e busca dentro do painel
                ├── public-report.js # relatório público (4 abas)
                ├── top.js           # Top 20 canais por inscritos
                ├── rankings.js      # rankings por país e período
                ├── signup.js        # cadastro exigido antes da análise
                ├── creator.js       # dashboard do criador (OAuth)
                ├── compare.js       # comparação de canais
                └── pricing.js       # planos e matriz de recursos
```

Quatro arquivos concentram as decisões: `config.js` (de onde vêm os dados), `api.js` (como chegam),
`engine.js` (como viram resposta) e `plans.js` (quem pode ver o quê).

### Dados ausentes não viram zero

O backend devolve `null` nos campos que a API pública não expõe — inscritos por vídeo, views das
primeiras 48 h e retenção. O motor detecta isso em `dataCapabilities()` e degrada de forma explícita:
a conversão por tema passa a medir interações, o melhor horário passa a usar views totais, e a
retenção aparece como "—". Cada troca é anunciada na interface.

Isso é deliberado. Preencher os buracos com estimativa produziria recomendações confiantes e erradas
— exatamente o tipo de coisa que a regra de ouro deste projeto existe para evitar.

### Temas: por que não dá para usar a categoria do YouTube

A Data API só tem ~15 categorias amplas, e um canal inteiro costuma cair numa só — os 200 vídeos do
Manual do Mundo estão todos em "Ciência e tecnologia". As tags também não salvam: canais
profissionais repetem o mesmo bloco em todo vídeo (11 tags idênticas em 100% dos uploads, no mesmo
canal). Agrupar por qualquer um dos dois produz uma tabela de uma linha com 0% de variação.

Quando a categoria não separa nada, `deriveTitleTopics()` extrai os temas dos **títulos** por
frequência de documento — o princípio do TF-IDF, sem nada de IA:

- termo precisa aparecer em ao menos 3 vídeos (sustenta estatística) e em no máximo 40% deles
  (senão não diferencia);
- hashtags têm prioridade, porque marcam quadros e séries escolhidos pelo próprio autor;
- vídeos sem termo recorrente vão para "Outros", que nunca é eleito melhor nem pior tema;
- a interface informa a base do agrupamento e quantos vídeos ficaram cobertos.

No Manual do Mundo isso revelou o achado mais útil do relatório: vídeos sobre **carro** fazem 11× as
views do vídeo típico e engajam 53% menos. Alcance de vitrine, conversão fraca — invisível em
qualquer agrupamento por categoria.

### Para onde isso cresce (com back-end)

```
tubemetrics/
├── apps/
│   ├── web/                    # este front-end, empacotado
│   └── api/                    # BFF: OAuth, cache de quota, feature flags no servidor
│       ├── routes/
│       │   ├── auth.google.ts  # authorization code + PKCE, guarda refresh token cifrado
│       │   ├── channels.ts     # proxy da Data API com cache
│       │   └── analytics.ts    # proxy da Analytics API, só para o dono do canal
│       └── jobs/
│           └── snapshot.ts     # coleta diária por vídeo (ver "limites da API pública")
├── packages/
│   ├── engine/                 # engine.js movido para cá: mesmo código no cliente e no cron
│   └── contracts/              # tipos compartilhados (Channel, Video, DailyRow)
└── infra/
```

O motor é isomórfico de propósito: as mesmas funções puras rodam no navegador (análise interativa)
e num job noturno (alertas de meta, relatórios agendados).

---

## 2. Endpoints e configuração no Google Cloud

No **Google Cloud Console → APIs e serviços → Biblioteca**, habilite:

| API | Para quê |
| --- | --- |
| **YouTube Data API v3** | Tudo do modo público: canal, lista de uploads, metadados dos vídeos |
| **YouTube Analytics API** | Métricas privadas do dono do canal (views, retenção, CTR, inscritos) |
| **YouTube Reporting API** *(opcional)* | Relatórios em massa em CSV, para quem conecta muitos canais |

### Modo A — Análise pública (sem login)

Precisa apenas de uma **chave de API** (`key=`), sem OAuth.

| Endpoint | Uso | Custo em unidades |
| --- | --- | --- |
| `GET /youtube/v3/search?part=snippet&type=channel&q=` | Buscar canal pelo nome | **100** |
| `GET /youtube/v3/channels?part=snippet,statistics,contentDetails,topicDetails&id=` | Inscritos, views totais, nº de vídeos, data de criação, playlist de uploads | 1 |
| `GET /youtube/v3/playlistItems?part=contentDetails&playlistId=<uploads>&maxResults=50` | Paginar o catálogo de vídeos | 1 por página |
| `GET /youtube/v3/videos?part=snippet,statistics,contentDetails&id=<até 50 ids>` | Views, curtidas, comentários, duração, tags | 1 por lote |

A cota padrão é de **10.000 unidades por dia**. Como `search` custa 100 e os demais custam 1, a
regra prática é: cachear o resultado de `search` por 24 h e resolver o resto por `id`. Um canal de
500 vídeos custa ~21 unidades para varrer inteiro (1 + 10 páginas + 10 lotes).

**Limites que a API pública não cobre.** Três campos usados pelo motor não existem em `videos.list`:

- `views48h` — desempenho nas primeiras 48 h (base do "melhor horário");
- `subsGained` — inscritos atribuídos a cada vídeo (base do "tema que mais converte");
- `avgViewPct` — retenção média (base da "melhor duração").

Para o canal conectado eles vêm da Analytics API. Para canais de terceiros, a única fonte honesta é
o **histórico coletado pelo próprio SaaS**: um job diário grava um snapshot de `viewCount` por vídeo
e de `subscriberCount` do canal; a diferença entre snapshots reconstrói velocidade e atribuição.
Enquanto o histórico não existe, esses campos devem ser exibidos marcados como estimativa — que é
exatamente o que o relatório público faz. Não invente precisão que o dado não tem.

### Modo B — Dashboard do Criador (OAuth 2.0)

Crie credenciais do tipo **ID do cliente OAuth → Aplicativo da Web** e configure a tela de consentimento.

Escopos:

```
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/yt-analytics.readonly
https://www.googleapis.com/auth/yt-analytics-monetary.readonly   # receita, RPM, CPM
```

Fluxo: `authorization code` + PKCE → troca em `POST https://oauth2.googleapis.com/token` → o
**refresh token fica cifrado no servidor e nunca chega ao navegador**; o access token vale 1 h.

Consulta única, mudando `metrics` e `dimensions`:

```
GET https://youtubeanalytics.googleapis.com/v2/reports
  ?ids=channel==MINE
  &startDate=2026-01-01&endDate=2026-07-27
  &metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,
           subscribersGained,subscribersLost,estimatedRevenue,estimatedAdRevenue,
           grossRevenue,cpm,playbackBasedCpm,impressions,impressionClickThroughRate
  &dimensions=day
```

| `dimensions` | Entrega |
| --- | --- |
| `day` / `month` | Séries temporais e comparação mês a mês |
| `video` | Ranking e receita detalhada por vídeo (`sort=-estimatedRevenue`) |
| `insightTrafficSourceType` | Fontes de tráfego (Shorts feed, busca, sugestões, externo) |
| `country` | Países dos espectadores |
| `deviceType` / `operatingSystem` | Dispositivos |
| `ageGroup,gender` | Demografia |
| `subscribedStatus` | Inscritos × não inscritos |
| `elapsedVideoTimeRatio` | Curva de retenção de um vídeo (`ids=channel==MINE&filters=video==ID`) |

Métricas monetárias exigem que o canal esteja no Programa de Parcerias e só saem com o escopo
`yt-analytics-monetary.readonly`.

---

## 3. Como o motor cruza os dados

O arquivo [`assets/js/engine.js`](assets/js/engine.js) é o coração do produto. Só funções puras.

| Pergunta do usuário | Função | Método |
| --- | --- | --- |
| Qual tema gera mais inscritos? | `topicSubscriberConversion` | agrupa por tema → inscritos por mil views → encolhimento bayesiano |
| Qual a melhor duração? | `durationAnalysis` | faixas de tempo × alcance, retenção, tempo de tela e conversão |
| Qual o melhor horário? | `bestPublishTime` | índice de 48 h normalizado por vizinhança temporal, agrupado por hora e dia |
| Qual a frequência ideal? | `idealFrequency` | janelas de 28 dias, agrupadas por ritmo, ordenadas pelo saldo mediano de inscritos |
| Como está meu canal? | `channelScore` | quatro pilares somando 100 pontos |
| Quanto isso rende? | `estimateEarnings` | faixas conservador / médio / otimista sobre um RPM configurável |

### O exemplo de referência

Este é o cruzamento pedido no entregável 6.3 — todo o "consultor de dados" segue este mesmo padrão
de quatro passos:

```js
export function topicSubscriberConversion(videos, { groupField = 'topic', minVideos = 3 } = {}) {
  const totalViews  = sum(videos, (v) => v.views);
  const totalSubs   = sum(videos, (v) => v.subsGained);
  const channelRate = totalViews ? totalSubs / totalViews : 0;   // inscritos por view

  // 1. AGRUPAR — reduce() junta os vídeos por tema
  const groups = groupBy(videos, (v) => v[groupField]);

  // Peso do prior: 8% das views do canal
  const priorWeight = totalViews * 0.08;

  const rows = Object.entries(groups)
    // 2. SOMAR — cada grupo vira { views, inscritos, nº de vídeos }
    .map(([name, list]) => {
      const views = sum(list, (v) => v.views);
      const subs  = sum(list, (v) => v.subsGained);

      // 3. NORMALIZAR — inscritos por MIL VIEWS, não inscritos absolutos.
      //    Total absoluto premiaria só o tema mais publicado; a taxa mede
      //    eficiência de conversão, que é o que a pergunta realmente pede.
      const rawRate = views ? (subs / views) * 1000 : 0;

      // 4. ESTABILIZAR — encolhimento em direção à taxa média do canal.
      //    Sem isso, um tema com 900 views e um viral lidera a tabela.
      const adjRate = shrunkRate(subs, views, channelRate, priorWeight) * 1000;

      return {
        name,
        videos: list.length,
        uploadShare: list.length / videos.length,
        views, subs,
        subsPer1k: adjRate,
        vsChannel: channelRate ? (adjRate / (channelRate * 1000) - 1) * 100 : 0,
        reliable: list.length >= minVideos,
      };
    })
    // 5. ORDENAR pela taxa ajustada
    .sort((a, b) => b.subsPer1k - a.subsPer1k);

  return {
    rows,
    channelSubsPer1k: channelRate * 1000,
    best:  rows.find((r) => r.reliable) || rows[0] || null,
    worst: [...rows].reverse().find((r) => r.reliable) || null,
  };
}
```

E o encolhimento, que é o que separa um ranking honesto de um ranking barulhento:

```js
export function shrunkRate(groupEvents, groupBase, globalRate, priorWeight) {
  return (groupEvents + priorWeight * globalRate) / (groupBase + priorWeight);
}
```

Mesma ideia da média bayesiana do IMDb: um grupo pequeno é puxado para a média global e só se
descola dela quando junta amostra suficiente para sustentar a diferença. Grupos abaixo de
`minVideos` continuam na tabela, mas marcados como amostra baixa e fora da eleição de "melhor" —
o produto prefere dizer "ainda não sei" a chutar com confiança.

### Nota geral do canal (0–100)

| Pilar | Pontos | Fórmula |
| --- | --- | --- |
| Engajamento | 30 | `(curtidas + comentários) ÷ views` nos 30 vídeos recentes; satura em 4,5% |
| Consistência | 25 | 65% regularidade `1/(1+CV dos intervalos)` + 35% atividade recente |
| Crescimento | 30 | mediana de views dos últimos 90 d ÷ 90 d anteriores; 0,7× → 0, 1,5× → cheio |
| Alcance & retenção | 15 | 55% views por inscrito + 45% retenção média |

Medianas em vez de médias onde há cauda longa; um viral não deve virar nota.

### Estimativa de ganhos

Faixas em vez de número único, porque RPM varia com país da audiência, sazonalidade de anunciante e
cobertura de anúncio:

```
Conservador = RPM × 0,70      Médio = RPM × 1,00      Otimista = RPM × 1,50
```

Vídeos longos rendem sobre ~62% de views monetizadas. Shorts entram pelo pool separado, com RPM
equivalente a ~5,5% do longo — é a diferença que mais engana quem estima "no olho".

---

## 4. Monetização e feature flags

Tudo declarado em [`assets/js/plans.js`](assets/js/plans.js) e consultado por `can(plano, recurso)`
e `limitOf(plano, limite)`. Nenhuma tela decide sozinha o que mostrar.

| | Grátis | Starter | Pro | Creator |
| --- | --- | --- | --- | --- |
| Preço/mês | R$ 0 | R$ 49,90 | R$ 179,90 | R$ 249,90 |
| Análises de canal por mês | 3 | 80 | 180 | ilimitado |
| Análise pública + nota do canal | ✓ | ✓ | ✓ | ✓ |
| Canais favoritos | — | 5 | 15 | ilimitado |
| Canais em comparação | — | 2 | 5 | 10 |
| Top 20 por inscritos | — | ✓ | ✓ | ✓ |
| Melhor horário / frequência ideal | — | ✓ | ✓ | ✓ |
| Dashboard do Criador + receita por vídeo | — | ✓ | ✓ | ✓ |
| Canais conectados | 0 | 1 | 5 | 15 |
| Assentos de equipe | 1 | 1 | 5 | 8 |
| Exportação PDF/Excel | — | — | ✓ | ✓ |

A cota é **mensal**, não diária: analisar canal é decisão de planejamento e acontece em ondas. Um teto
diário puniria justamente a semana em que o assinante mais precisa da ferramenta. Canal já analisado
no mês reabre pelo histórico sem consumir cota de novo.

O cadastro (nome, telefone, e-mail) é exigido antes da primeira análise. **É captura de lead no
navegador, não autenticação**: os dados ficam em `localStorage` e qualquer pessoa contorna limpando o
storage. Virar conta de verdade exige backend com sessão e a mesma checagem de plano no servidor.

> **Flag de cliente é experiência, não segurança.** Nesta demonstração o bloqueio acontece no
> navegador. Em produção a mesma tabela vive no servidor e a rota recusa o dado antes de montar a
> resposta; o front apenas reflete o que já foi negado.

---

## 5. Próximos passos

1. **Back-end de proxy** — mover a chave da Data API para o servidor, com cache por canal (24 h) e
   contagem de cota por conta.
2. **OAuth real** — trocar `connectGoogleAccount()` por authorization code + PKCE; guardar o refresh
   token cifrado; renovar o access token sob demanda.
3. **Job de snapshot diário** — sem ele, `views48h`, `subsGained` e `avgViewPct` continuam
   estimativas para canais de terceiros.
4. **Persistência** — Postgres para snapshots e assinaturas; Redis para cache de quota.
5. **Cobrança** — Stripe, com o webhook de assinatura escrevendo o plano que `plans.js` lê.
6. **Exportação e API** — PDF/Excel do relatório e endpoints públicos com chave por conta (Creator).

---

## Dados de demonstração

Quatro canais sintéticos com nichos, ritmos e perfis de monetização diferentes, gerados por PRNG
semeado (mulberry32) em `mock-data.js` — a mesma seed produz sempre o mesmo canal, então a interface
é testável e os números não mudam a cada reload.

O gerador **planta sinais de verdade** — janelas de horário melhores, temas que convertem mais,
faixas de duração com retenção maior — justamente para que o motor tenha algo real a redescobrir.
Se o `bestPublishTime` não recuperasse a janela plantada, seria bug de estatística, não de dado.

| Canal | Nicho | Perfil |
| --- | --- | --- |
| `@devrocket` | Programação e carreira | crescimento acelerado, cadência irregular, muitos Shorts |
| `@cozinhadoze` | Culinária | catálogo grande, RPM baixo, Shorts dominando as views |
| `@granaemordem` | Finanças pessoais | canal menor, RPM alto, melhor conversão em inscritos |
| `@pixelstorm` | Games | canal maduro e volumoso, crescimento estagnado |
