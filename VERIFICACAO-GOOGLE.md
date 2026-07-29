# Checklist — Verificação OAuth do Google

Isso libera o Dashboard do Criador para **qualquer** usuário, não só os 100
e-mails cadastrados como testador. É o item mais lento de todo o roteiro —
vale submeter agora e deixar rodando em paralelo com o resto.

As duas páginas exigidas já estão no ar:
- **https://tubemetrics.vercel.app/privacidade.html**
- **https://tubemetrics.vercel.app/termos.html**

---

## ✅ Dados legais já preenchidos

| Campo | Valor |
|---|---|
| Nome | Fabiano Ferreira de Souza |
| E-mail de suporte | bno229@gmail.com |
| Foro | Comarca de São Paulo/SP |

Já publicado nas duas páginas. Pode seguir direto para o passo 1.

---

## Passo 1 — Tela de consentimento: dados básicos

Abra: **https://console.cloud.google.com/auth/branding**

Confirme/preencha:
- **Nome do app**: TubeMetrics
- **E-mail de suporte ao usuário**: bno229@gmail.com
- **Logo do app**: opcional, mas ajuda a aprovação — pode usar o ícone em
  `web/icons/icon.svg` (exporte como PNG 120×120)
- **Link da Política de Privacidade**: `https://tubemetrics.vercel.app/privacidade.html`
- **Link dos Termos de Uso**: `https://tubemetrics.vercel.app/termos.html`
- **Domínio autorizado**: `vercel.app` (ou seu domínio próprio, se migrar)

---

## Passo 2 — Justificar cada escopo

Em **Data access** (mesma seção do console), para cada um dos três escopos
sensíveis, o formulário pede uma justificativa curta. Sugestão de texto,
adapte à vontade:

**`youtube.readonly`**
> Usado para identificar o canal do usuário autenticado e listar seus vídeos
> públicos, exibidos no painel de análise do próprio usuário.

**`yt-analytics.readonly`**
> Usado para exibir ao usuário métricas do próprio canal: views, tempo de
> exibição, retenção de audiência e inscritos ganhos/perdidos, dentro do
> Dashboard do Criador.

**`yt-analytics-monetary.readonly`**
> Usado para exibir ao usuário a receita estimada, RPM e CPM do próprio canal,
> quando monetizado — dado que hoje só aparece no YouTube Studio.

---

## Passo 3 — Gravar um vídeo de demonstração

O Google costuma pedir isso para escopos sensíveis. Grave uma tela curta
(2–3 minutos) mostrando:

1. Login em `#/criador` → clique em "Continuar com o Google"
2. A tela de consentimento do Google (mostrando os escopos pedidos)
3. Voltando ao TubeMetrics já conectado, com o dashboard mostrando dados reais
4. **Bônus que ajuda a aprovação**: mostrar o botão "Desconectar" e a página
   `myaccount.google.com/permissions` confirmando que dá para revogar o acesso

Suba o vídeo (não listado) no YouTube e cole o link no formulário.

---

## Passo 4 — Submeter para verificação

Ainda na tela de consentimento, clique em **Preparar para verificação** (ou
"Submit for verification"). O Google confirma o recebimento por e-mail e pode
pedir esclarecimentos adicionais — responda o mais rápido possível para não
perder a vez na fila.

---

## O que esperar depois

| Etapa | Prazo típico |
|---|---|
| Confirmação de recebimento | minutos |
| Primeira resposta do revisor | poucos dias a 2 semanas |
| Idas e vindas de esclarecimento (comum) | variável |
| Aprovação final | dias a algumas semanas no total |

Quando aprovado, volte em **Audience** (`console.cloud.google.com/auth/audience`)
e clique em **Publish app** — só aí a tela de "não verificado" desaparece para
qualquer usuário, e a lista de 100 testadores deixa de ser necessária.

---

## Enquanto isso

- A lista de testadores continua funcionando normalmente — pode seguir
  testando e demonstrando o produto para até 100 e-mails cadastrados
- Os recursos públicos (busca, relatório de canal, Top 20, Rankings) já
  funcionam para qualquer pessoa, sem depender desta verificação
