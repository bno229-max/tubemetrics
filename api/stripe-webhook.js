/**
 * POST /api/stripe-webhook — o Stripe avisa aqui quando uma assinatura muda.
 *
 * É o ÚNICO lugar que grava `plan` no Firestore para uma conta paga. O
 * navegador não pode mais fazer isso diretamente (ver o histórico de
 * `api/account.js`) porque a assinatura de verdade mora no Stripe — deixar
 * o cliente autodeclarar o plano é exatamente o furo que fechamos ao trocar
 * a demonstração por cobrança real.
 *
 * `bodyParser: false` porque a verificação de assinatura em `_stripe.js`
 * precisa do corpo CRU da requisição, byte a byte — o Stripe assina o texto
 * exato que mandou, e um JSON re-serializado pelo parser do Vercel bateria
 * diferente do hash calculado do lado deles.
 */

import { verifyWebhookSignature, retrieveSubscription, PLAN_BY_PRICE } from './_stripe.js';
import { firestore, firestoreReady } from './_firebase.js';
import { json, fail } from './_http.js';

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Estados em que a conta mantém acesso ao plano pago. */
const ATIVOS = new Set(['active', 'trialing', 'past_due']); // past_due = régua de cobrança do Stripe em andamento

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');
  if (!firestoreReady()) return fail(res, 503, 'firestoreNotConfigured', 'Firestore não configurado.');

  const body = await rawBody(req);
  let event;
  try {
    event = verifyWebhookSignature(body, req.headers['stripe-signature'] || '');
  } catch (err) {
    console.error('Webhook do Stripe recusado:', err.message);
    return fail(res, 400, 'invalidSignature', 'Assinatura inválida.');
  }

  const db = firestore();
  const obj = event.data.object;

  try {
    switch (event.type) {
      /*
       * Fecha o ciclo do Checkout imediatamente: em vez de esperar o próximo
       * evento de assinatura para saber qual plano foi comprado, já buscamos
       * a assinatura recém-criada aqui. Sem isso, a pessoa voltaria da tela
       * de pagamento e ainda veria o plano antigo por alguns segundos.
       */
      case 'checkout.session.completed': {
        const uid = obj.client_reference_id || obj.metadata?.uid;
        if (!uid) break;

        const patch = { stripeCustomerId: obj.customer };
        if (obj.subscription) {
          const sub = await retrieveSubscription(obj.subscription).catch((e) => {
            console.error('Falha ao buscar assinatura recém-criada:', e.message);
            return null;
          });
          const priceId = sub?.items?.data?.[0]?.price?.id;
          const plan = priceId && PLAN_BY_PRICE[priceId];
          if (plan && ATIVOS.has(sub.status)) {
            patch.plan = plan;
            patch.stripeSubscriptionId = sub.id;
          }
        }
        await db.collection('users').doc(uid).set(patch, { merge: true });
        break;
      }

      // Cobre upgrade/downgrade pelo Portal, renovação e falha de cobrança.
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const uid = obj.metadata?.uid;
        if (!uid) break;

        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan = priceId && PLAN_BY_PRICE[priceId];
        if (!plan) break;

        await db.collection('users').doc(uid).set(
          {
            plan: ATIVOS.has(obj.status) ? plan : 'free',
            stripeSubscriptionId: obj.id,
          },
          { merge: true }
        );
        break;
      }

      // Cancelamento efetivado (fim do período, ou depois da régua de cobrança falhar).
      case 'customer.subscription.deleted': {
        const uid = obj.metadata?.uid;
        if (uid) await db.collection('users').doc(uid).set({ plan: 'free' }, { merge: true });
        break;
      }

      default:
        break; // eventos que não mudam plano não precisam de tratamento
    }
  } catch (err) {
    console.error('Erro ao processar webhook do Stripe:', event.type, err);
    return fail(res, 500, 'internal', 'Erro ao processar evento.');
  }

  return json(res, 200, { received: true });
}
