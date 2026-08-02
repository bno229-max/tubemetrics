/**
 * _stripe.js — Assinaturas reais via Stripe, chamando a API REST direto.
 *
 * Sem o SDK oficial de propósito: a superfície que este projeto precisa
 * (criar Checkout Session, criar sessão do Portal de cobrança, verificar a
 * assinatura de um webhook) é pequena o bastante para não justificar uma
 * dependência inteira — mesmo raciocínio que já levou `_auth.js` a preferir
 * `node:crypto.scrypt` a uma lib de bcrypt.
 *
 * ## Autoridade do plano
 *
 * A partir daqui, **só o webhook muda o plano de uma conta paga**
 * (`api/stripe-webhook.js`). O que este arquivo faz é iniciar o Checkout e o
 * Portal — nunca grava plano no Firestore diretamente, porque quem autoriza
 * a mudança é o evento assinado que o Stripe manda de volta, não o clique do
 * usuário no botão.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const clean = (v) => (v || '').trim();

const STRIPE_SECRET_KEY = clean(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = clean(process.env.STRIPE_WEBHOOK_SECRET);

export const stripeReady = () => !!STRIPE_SECRET_KEY;
export const webhookReady = () => !!STRIPE_WEBHOOK_SECRET;

/**
 * Price ID de cada plano pago. Não são segredo (aparecem em qualquer sessão
 * de Checkout que o navegador abre) — por isso ficam direto no código, sem
 * precisar de mais três variáveis de ambiente.
 */
export const PRICE_BY_PLAN = {
  starter: 'price_1TytLQBXCKjwlmhXqHFFKkcc',
  pro: 'price_1TytMVBXCKjwlmhX1ci15mXK',
  creator: 'price_1TytNiBXCKjwlmhXfqath0F3',
};
export const PLAN_BY_PRICE = Object.fromEntries(Object.entries(PRICE_BY_PLAN).map(([plan, price]) => [price, plan]));

/**
 * A API do Stripe é `application/x-www-form-urlencoded`, com colchetes para
 * estrutura aninhada (`line_items[0][price]=...`), não JSON. `flatten` faz
 * esse achatamento para objetos e arrays, então quem chama `call()` só
 * precisa passar um objeto JS normal.
 */
function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => Object.assign(out, flatten(item, `${key}[${i}]`)));
    } else if (typeof v === 'object') {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

async function call(path, params, method = 'POST') {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurada.');

  let url = `https://api.stripe.com/v1/${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } };

  if (method === 'GET') {
    const qs = params ? new URLSearchParams(flatten(params)).toString() : '';
    if (qs) url += `?${qs}`;
  } else {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = params ? new URLSearchParams(flatten(params)).toString() : '';
  }

  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Stripe respondeu ${res.status}`);
    err.status = res.status;
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

/**
 * Sessão de Checkout para assinar um plano pago.
 *
 * `client_reference_id` e `subscription_data.metadata.uid` carregam o uid do
 * Firebase para os dois lados possíveis do retorno: o próprio
 * `checkout.session.completed` e, mais adiante, todo evento da assinatura
 * criada (`customer.subscription.*`) — sem isso, o webhook não teria como
 * ligar o evento do Stripe de volta a uma conta nossa.
 */
export async function createCheckoutSession({ uid, email, plan, customerId, successUrl, cancelUrl }) {
  const price = PRICE_BY_PLAN[plan];
  if (!price) throw new Error(`Plano sem preço configurado no Stripe: ${plan}`);

  return call('checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: uid,
    subscription_data: { metadata: { uid } },
    allow_promotion_codes: true,
    ...(customerId ? { customer: customerId } : { customer_email: email }),
  });
}

/** Portal onde o cliente troca cartão, vê faturas ou cancela por conta própria. */
export async function createBillingPortalSession({ customerId, returnUrl }) {
  return call('billing_portal/sessions', { customer: customerId, return_url: returnUrl });
}

export async function retrieveSubscription(subscriptionId) {
  return call(`subscriptions/${subscriptionId}`, null, 'GET');
}

/**
 * Confere a assinatura HMAC do cabeçalho `Stripe-Signature`, no formato
 * documentado pelo Stripe: `t=<timestamp>,v1=<hash>`, onde o hash é
 * HMAC-SHA256 de `"<timestamp>.<corpo cru>"` com o signing secret do webhook.
 *
 * É isto que garante que a chamada em `/api/stripe-webhook` veio do Stripe e
 * não de qualquer POST forjado direto para a URL — a rota é pública por
 * necessidade (o Stripe não manda token de autenticação nosso), então essa
 * assinatura é toda a defesa que existe.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET não configurado.');

  const parts = Object.fromEntries(
    String(signatureHeader || '')
      .split(',')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2)
  );
  const timestamp = parts.t;
  const received = parts.v1;
  if (!timestamp || !received) throw new Error('Cabeçalho Stripe-Signature malformado.');

  // Janela de 5 minutos contra replay de um webhook capturado.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error('Timestamp do webhook fora da janela aceita.');
  }

  const esperado = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(esperado, 'hex');
  const b = Buffer.from(received, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Assinatura do webhook inválida.');
  }

  return JSON.parse(rawBody);
}
