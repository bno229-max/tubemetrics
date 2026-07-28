# Configuração — colocar o TubeMetrics no ar com dados reais

Fluxo: **GitHub → Vercel**. Sem cartão de crédito, sem plano pago.

Este guia cobre **tudo que funciona sem aprovação do Google**: a análise pública
de qualquer canal, com dados de verdade da YouTube Data API.

O que **não** entra aqui: receita, RPM, CTR de miniatura e retenção. Esses dados
exigem OAuth com escopos sensíveis e verificação do Google — etapa separada.

Tempo estimado: **15 minutos**.

---

## Como o projeto se encaixa na Vercel

```
tubemetrics/
├── vercel.json     → aponta o site estático para web/
├── api/            → vira Serverless Functions automaticamente
│   ├── health.js       → /api/health
│   ├── search.js       → /api/search
│   ├── channel.js      → /api/channel
│   └── _*.js           → bibliotecas (o "_" faz a Vercel ignorar como rota)
└── web/            → o site (HTML, CSS, JS)
```

Você não configura nada disso: a Vercel detecta a pasta `api/` sozinha.

---

## Passo 1 — Habilitar a YouTube Data API

1. Abra: **https://console.cloud.google.com/apis/library/youtube.googleapis.com**
2. No topo da página, selecione um projeto (ou crie um novo — pode chamar
   `tubemetrics`)
3. Clique em **Ativar**

Esta API usa chave, não login de usuário. Por isso não exige tela de
consentimento nem verificação — é o que nos permite ir ao ar hoje.

---

## Passo 2 — Criar a chave de API

1. Abra: **https://console.cloud.google.com/apis/credentials**
2. **+ Criar credenciais** → **Chave de API**
3. Copie a chave (começa com `AIzaSy...`) e deixe em algum lugar seguro
4. Clique em **Editar chave de API** e ajuste:
   - **Restrições de aplicativo** → **Nenhuma**
   - **Restrições de API** → **Restringir chave** → marque **YouTube Data API v3**
5. **Salvar**

> **Por que "Nenhuma" em restrições de aplicativo?** Quem usa a chave é o
> servidor da Vercel, não o navegador. Restrição por referenciador HTTP só
> quebraria as chamadas. A proteção que importa é a de API: se a chave vazar,
> ela não serve para mais nada além de ler dados públicos do YouTube.

---

## Passo 3 — Subir para o GitHub

Na pasta do projeto:

```bash
cd "C:\Users\Fabiano Micro\Downloads\tubemetrics"
```

Depois:

```bash
git add -A && git commit -m "TubeMetrics: app + API pública"
```

Crie um repositório vazio em **https://github.com/new** (pode ser privado) e
conecte:

```bash
git remote add origin https://github.com/SEU-USUARIO/tubemetrics.git
```

```bash
git branch -M main && git push -u origin main
```

---

## Passo 4 — Importar na Vercel

1. Abra: **https://vercel.com/new**
2. Escolha o repositório `tubemetrics` → **Import**
3. Nas configurações que aparecem:
   - **Framework Preset**: `Other`
   - **Build Command**: deixe **vazio**
   - **Install Command**: deixe **vazio**
   - **Output Directory**: `web`
4. **Deploy**

O `vercel.json` já traz o `outputDirectory`, mas preencher no painel evita
qualquer dúvida.

O primeiro deploy leva menos de um minuto. O site sobe — ainda com dados de
demonstração, porque a chave ainda não foi configurada. É o esperado.

---

## Passo 5 — Configurar a chave na Vercel

1. No projeto recém-criado: **Settings** → **Environment Variables**
2. Adicione:
   - **Key**: `YOUTUBE_API_KEY`
   - **Value**: a chave do passo 2
   - **Environments**: marque **Production**, **Preview** e **Development**
3. **Save**

---

## Passo 6 — Publicar de novo

Variáveis de ambiente só entram em vigor num deploy novo.

1. Aba **Deployments**
2. No deploy mais recente, menu **⋯** → **Redeploy** → confirme

> Daqui para frente, todo `git push` publica sozinho. Este redeploy manual é
> necessário só desta vez, por causa da variável nova.

---

## Passo 7 — Conferir

Abra, trocando pelo seu domínio da Vercel:

```
https://SEU-PROJETO.vercel.app/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "mode": "public",
  "apiKeyConfigured": true,
  "message": "Backend pronto. Buscas e relatórios usarão dados reais da YouTube Data API."
}
```

Se vier `"apiKeyConfigured": false`, a variável não chegou — refaça os passos 5 e 6.

Agora abra o site, vá em **Descobrir canais** e busque um canal real — por
exemplo `Manual do Mundo`. Se aparecer a faixa verde **"Dados reais da YouTube
Data API"** no topo do relatório, acabou.

---

## O que muda depois disso

| | Antes | Depois |
|---|---|---|
| Buscar canal | 4 canais fictícios | qualquer canal do YouTube |
| Inscritos, views, vídeos | simulados | reais |
| Frequência, formatos, temas | simulados | reais |
| Nota do canal | simulada | real |
| Estimativa de ganhos | simulada | real (sobre views reais) |
| Melhor horário | preciso (48 h) | aproximado — ver abaixo |
| Receita, RPM, CTR, retenção | simulados | ❌ ainda indisponíveis |

### Por que algumas análises ficam aproximadas

A API pública **não** informa três coisas: quantos inscritos cada vídeo trouxe,
quantas views fez nas primeiras 48 h, e a retenção de audiência.

O sistema detecta a ausência e se adapta, sem inventar número:

- **"Tema que mais converte"** passa a medir **interações** (curtidas +
  comentários) por mil views, e a tela diz isso com todas as letras.
- **"Melhor horário"** usa views totais em vez do arranque de 48 h. É um sinal
  mais fraco, e o rodapé do gráfico avisa.
- **Retenção** aparece como "—" nas tabelas.

Resolve-se de duas formas, ambas etapas futuras: o **job de snapshot diário**
(que reconstrói o arranque de 48 h a partir de coletas sucessivas) e o **OAuth**
(que traz os dados privados de quem for dono do canal).

---

## Opcional — ligar os rankings de crescimento (Firestore)

Os rankings de **alta por país** já funcionam sem nada disso. O que depende
desta etapa são os rankings de **crescimento** (semana, mês, ano).

### Por que precisa de banco

A Data API devolve só o retrato de agora: inscritos e views acumulados, sem
nenhuma série temporal. Não existe endpoint de "quanto o canal cresceu na
semana". A única forma é guardar o retrato todo dia e subtrair depois.

> 💡 **O Firestore não exige plano Blaze.** O Blaze é cobrado pelas *Cloud
> Functions*; aqui as funções rodam na Vercel e o Firestore entra só como banco.
> No plano **Spark (gratuito)** você tem 50 mil leituras e 20 mil escritas por
> dia — este motor usa poucas centenas.

### Passo A — criar o banco

1. Abra: **https://console.firebase.google.com/project/tubemetrics-saas/firestore**
2. **Criar banco de dados** → modo **produção** → região **southamerica-east1 (São Paulo)**

Se aparecer erro de API desabilitada, ative em
**https://console.cloud.google.com/apis/library/firestore.googleapis.com** e
espere um minuto.

### Passo B — criar a conta de serviço

1. Abra: **https://console.firebase.google.com/project/tubemetrics-saas/settings/serviceaccounts/adminsdk**
2. **Gerar nova chave privada** → confirme
3. Baixa um arquivo `.json`. Abra-o: você vai precisar de três campos.

⚠️ Esse arquivo dá acesso total ao seu banco. **Não** o coloque no repositório —
o `.gitignore` já bloqueia `.json` de credencial, mas vale conferir.

### Passo C — configurar na Vercel

**Settings** → **Environment Variables**, marcando Production, Preview e Development:

| Name | De onde vem no JSON |
|---|---|
| `FIREBASE_PROJECT_ID` | campo `project_id` |
| `FIREBASE_CLIENT_EMAIL` | campo `client_email` |
| `FIREBASE_PRIVATE_KEY` | campo `private_key` — **cole o valor inteiro**, incluindo `-----BEGIN PRIVATE KEY-----` e os `
` |
| `CRON_SECRET` | uma frase longa e aleatória, sua |

Para gerar o `CRON_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> A chave privada tem quebras de linha. O painel guarda tudo numa linha só, com
> `
` literal — o código desfaz isso sozinho. Cole exatamente como está no JSON.

### Passo D — publicar as regras e o código

```bash
firebase deploy --only firestore:rules
```

Depois, um **Redeploy** na Vercel (variável nova só vale em deploy novo).

As regras negam todo acesso do navegador de propósito: quem lê e escreve é a
função da Vercel, pelo Admin SDK, que passa por cima das regras.

### Passo E — conferir

```
https://tubemetrics.vercel.app/api/health
```

Deve mostrar `"firestoreConfigured": true`. Para forçar a primeira coleta sem
esperar a madrugada:

```bash
curl -H "Authorization: Bearer SEU_CRON_SECRET" https://tubemetrics.vercel.app/api/cron-snapshot
```

Confira os documentos aparecendo em **Firestore → coleção `snapshots`**.

### O relógio que não dá para acelerar

| Ranking | Fica pronto em |
|---|---|
| Semana | 7 dias de coleta |
| Mês | 30 dias |
| Ano | 365 dias |

Não há atalho: o histórico não existe retroativamente. Enquanto isso, a tela
explica que a coleta está em andamento, em vez de mostrar um ranking vazio sem
contexto.

Os canais entram na coleta sozinhos — os da lista do Top 20 e qualquer canal que
alguém analise. Custo: 1 unidade de cota por lote de 50 canais, por dia.

---

## Cota: o limite que realmente importa

A YouTube Data API dá **10.000 unidades por dia**, reiniciando à meia-noite do
Pacífico (por volta das 5h da manhã no Brasil).

| Ação | Custo |
|---|---|
| Buscar por nome | 101 unidades |
| Abrir um canal (até 200 vídeos) | ~10 unidades |

São **cerca de 90 buscas por termo novo por dia**. Parece pouco, mas quem segura
essa conta é o **cache da borda da Vercel**: buscas ficam guardadas 24 h e canais
6 h. O segundo usuário que procurar o mesmo canal é atendido pelo CDN e **não
gasta um único ponto** da cota.

### Uma limitação honesta

Não há um contador compartilhado de cota. O cache protege repetições, não
termos únicos: uma rajada de buscas diferentes pode esgotar o dia. Quando isso
acontecer, o app mostra a mensagem certa em vez de quebrar.

Se o tráfego crescer a ponto disso incomodar, o próximo passo é ligar um
**Upstash Redis** (tem plano gratuito, integra pela própria Vercel) para contar
e limitar. Não vale fazer antes de precisar.

Se o volume crescer de verdade, dá para pedir aumento de cota ao Google pelo
formulário de auditoria da YouTube API. É gratuito, mas leva tempo.

---

## Se algo der errado

| Sintoma | Causa provável | Solução |
|---|---|---|
| Site mostra "Dados de demonstração" | chave ausente ou deploy antigo | passos 5 e 6 |
| `/api/health` diz `apiKeyConfigured: false` | variável não aplicada | refaça o **Redeploy** |
| `/api/health` dá 404 | pasta `api/` fora da raiz do repo | confira se `api/` está no topo do repositório |
| Erro 403 `forbidden` | API não habilitada, ou chave restrita errado | passos 1 e 2 |
| Erro 429 `quotaExceeded` | cota do dia acabou | esperar a virada (~5h da manhã) |
| Vercel reclama do Output Directory | campo em branco | Settings → Build & Development → Output Directory = `web` |

Para ver o que a função respondeu: painel da Vercel → aba **Logs**.

---

## E o Firebase?

O projeto `tubemetrics-saas` no Firebase Hosting continua no ar como espelho,
com dados de demonstração. Não atrapalha em nada e não custa nada.

Se quiser mantê-lo atualizado:

```bash
firebase deploy --only hosting
```

Se preferir concentrar tudo na Vercel, é só ignorá-lo — ou apagar o projeto pelo
console do Firebase.

---

## Próxima etapa (depende do Google)

Para liberar o Dashboard do Criador com receita, RPM, CTR e retenção reais:

1. Configurar a tela de consentimento OAuth
2. Pedir verificação dos escopos `youtube.readonly`, `yt-analytics.readonly` e
   `yt-analytics-monetary.readonly`
3. Enquanto a verificação não sai, o app funciona em modo Teste com até 100
   contas cadastradas manualmente — suficiente para os primeiros clientes

Vale abrir esse pedido **assim que possível**: é o único item do projeto cujo
prazo não depende de você.
