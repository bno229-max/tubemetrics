# Conectar um canal de verdade (OAuth + YouTube Analytics API)

Este é o passo que libera o que a API pública **não** entrega: receita, RPM, CPM,
CTR das miniaturas, retenção de audiência, inscritos ganhos e perdidos por dia e
fontes de tráfego.

Diferente da chave de API, aqui existe um **portão que não depende de você**: o
Google precisa aprovar o app. Este guia mostra como testar hoje mesmo, com sua
própria conta, sem esperar essa aprovação.

---

## Entenda o portão antes de começar

Os escopos que precisamos são classificados como **sensíveis** pelo Google:

```
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/yt-analytics.readonly
https://www.googleapis.com/auth/yt-analytics-monetary.readonly
```

Isso significa duas fases:

| Fase | Quem pode conectar | Quando |
|---|---|---|
| **Teste** | até 100 contas que você cadastrar na mão | imediato |
| **Produção** | qualquer pessoa | após verificação do Google |

**Para validar o produto, a fase de Teste basta.** Você conecta seu canal, vê os
dados reais e valida tudo. A verificação só é necessária quando clientes de fora
forem conectar os canais deles.

> ⏱️ A verificação leva de dias a algumas semanas. Vale abrir o pedido assim que
> a tela de consentimento estiver pronta — ela roda em paralelo enquanto você
> desenvolve.

---

## Passo 1 — Habilitar a YouTube Analytics API

No **mesmo projeto** do Google Cloud onde você criou a chave de API:

1. Abra: **https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com**
2. Confirme o projeto selecionado no topo
3. Clique em **Ativar**

A YouTube Data API v3 você já ativou; esta é a segunda, que serve os dados
privados.

---

## Passo 2 — Configurar a tela de consentimento

1. Abra: **https://console.cloud.google.com/auth/overview**
2. **Get started** (ou **Editar app**, se já existir)
3. Preencha:
   - **Nome do app**: `TubeMetrics`
   - **E-mail de suporte**: seu e-mail
   - **Público**: **Externo**
   - **Dados de contato**: seu e-mail
4. Salve

### Adicionar os escopos

Ainda na tela de consentimento, vá em **Data access** → **Add or remove scopes**
e adicione os três escopos listados no topo deste guia. Salve.

### Cadastrar você como testador

Em **Audience** → **Test users** → **Add users**, coloque **o e-mail do Google
que administra o canal** que você quer conectar.

> ⚠️ Precisa ser exatamente a conta dona do canal. Se o canal pertence a uma
> Conta de Marca, adicione o e-mail que a gerencia.

---

## Passo 3 — Criar as credenciais OAuth

1. Abra: **https://console.cloud.google.com/apis/credentials**
2. **+ Criar credenciais** → **ID do cliente OAuth**
3. **Tipo de aplicativo**: `Aplicativo da Web`
4. **Nome**: `TubeMetrics Web`
5. Em **URIs de redirecionamento autorizados**, adicione **as duas**:

```
https://tubemetrics.vercel.app/api/auth/callback
```

```
http://localhost:8735/api/auth/callback
```

6. **Criar**

Guarde o **Client ID** e o **Client Secret** que aparecerem.

> O `redirect_uri` precisa bater **caractere por caractere** com o que o app
> enviar. Barra a mais no final, `http` no lugar de `https`, domínio de preview
> da Vercel em vez do domínio final — qualquer diferença gera
> `redirect_uri_mismatch`, que é de longe o erro mais comum aqui.

---

## Passo 4 — Guardar as credenciais na Vercel

No projeto da Vercel → **Settings** → **Environment Variables**, adicione:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | o Client ID do passo 3 |
| `GOOGLE_CLIENT_SECRET` | o Client Secret do passo 3 |
| `OAUTH_REDIRECT_URI` | `https://tubemetrics.vercel.app/api/auth/callback` |
| `SESSION_SECRET` | uma frase longa e aleatória, que só você conhece |

Marque **Production**, **Preview** e **Development** em todas.

Para gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Depois faça um **Redeploy** — variável nova só entra em vigor em deploy novo.

---

## Passo 5 — O que ainda falta no código

Aqui é preciso ser direto: **os passos 1 a 4 são configuração, mas o back-end de
OAuth ainda não existe no projeto.** Hoje o botão "Conectar meu canal" roda uma
simulação, e o Dashboard do Criador mostra dados fictícios.

Para conectar de verdade, faltam quatro rotas:

| Rota | O que faz |
|---|---|
| `GET /api/auth/start` | gera `state` + PKCE e redireciona para o Google |
| `GET /api/auth/callback` | valida o `state`, troca o `code` por tokens, cria a sessão |
| `GET /api/analytics` | consulta a Analytics API com o token do usuário |
| `POST /api/auth/logout` | encerra a sessão e descarta o refresh token |

E uma peça de infraestrutura: **onde guardar o refresh token**. Ele é a chave
permanente de acesso ao canal e não pode ficar no navegador nem em variável de
ambiente. O caminho mais direto no seu setup é o **Upstash Redis**, que tem plano
gratuito e integra pela própria Vercel (Storage → Create Database), guardando o
token cifrado com o `SESSION_SECRET`.

Ordem sugerida:

1. Ligar o Upstash Redis (5 minutos, pelo painel da Vercel)
2. Implementar `/api/auth/start` e `/api/auth/callback` com PKCE
3. Implementar `/api/analytics` e trocar o mock do Dashboard do Criador
4. Testar com seu canal na fase de Teste
5. Pedir a verificação do Google

---

## Passo 6 — Como validar quando estiver pronto

Depois de conectar, confira nesta ordem — os erros aparecem em pontos previsíveis:

1. **`/api/health`** deve reportar `oauthConfigured: true`
2. **Botão "Conectar meu canal"** leva à tela do Google com o nome `TubeMetrics`
   e os três escopos listados
3. Após autorizar, o painel mostra **seu canal**, não o de demonstração
4. **Receita, RPM e CPM** aparecem preenchidos — se vierem zerados, o canal não
   está no Programa de Parcerias ou faltou o escopo `yt-analytics-monetary`
5. **CTR e retenção** aparecem por vídeo
6. As análises que hoje dizem "interações" voltam a dizer **"inscritos"**, porque
   o dado real passa a existir

Esse último item é o melhor teste de que a integração funcionou de ponta a ponta:
o motor detecta sozinho que os campos privados chegaram e troca a análise.

---

## Erros comuns

| Erro | Causa | Solução |
|---|---|---|
| `redirect_uri_mismatch` | URI diferente do cadastrado | copie exatamente o do passo 3 |
| `access_denied` | conta não está em Test users | passo 2, cadastre o e-mail |
| `invalid_client` | Client ID/Secret errado ou não aplicado | passo 4 + Redeploy |
| Receita zerada | canal fora do YPP, ou escopo faltando | confira monetização e escopos |
| `403 insufficientPermissions` | escopo não concedido | revogue o acesso e autorize de novo |

Para revogar e refazer o teste do zero:
**https://myaccount.google.com/permissions** → TubeMetrics → Remover acesso.

---

## Sobre segurança, sem rodeios

Três regras que não podem ser relaxadas quando o OAuth for implementado:

1. **O `client_secret` nunca sai do servidor.** Se aparecer no bundle do front,
   qualquer pessoa se passa pelo seu app.
2. **O refresh token nunca chega ao navegador.** Ele dá acesso permanente ao
   canal. Fica cifrado no servidor, e o front recebe apenas um cookie de sessão
   `httpOnly`.
3. **O `state` é obrigatório.** Sem ele, o fluxo aceita um `code` plantado por
   terceiros — é o ataque clássico de CSRF em OAuth.
