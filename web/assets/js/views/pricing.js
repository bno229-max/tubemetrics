/** pricing.js — Planos, matriz de recursos e assinatura real via Stripe. */

import { PLANS, PLAN_BY_ID } from '../plans.js';
import { icon, toast } from '../ui.js';
import { featureMatrix } from './feature-matrix.js';
import { esc, money } from '../format.js';
import { startCheckout, openBillingPortal, fetchMe } from '../api.js';
import { ensureAuth } from './auth.js';
import * as store from '../store.js';

export default async function pricing(root, _params, ctx) {
  // O retorno do Checkout do Stripe volta para cá com `?assinatura=`, no
  // mesmo padrão que o callback do OAuth já usa em `#/criador?conectado=1`.
  const feedback = new URLSearchParams(location.hash.split('?')[1] || '');
  if (feedback.has('assinatura')) {
    history.replaceState(null, '', location.pathname + location.search + '#/planos');
  }
  if (feedback.get('assinatura') === 'sucesso') {
    toast('Assinatura confirmada! Pode levar alguns segundos para o plano atualizar aqui.', 'success');
    // O webhook do Stripe grava o plano em paralelo ao redirecionamento de
    // volta — uma nova consulta evita que a pessoa veja o plano antigo por
    // já ter chegado primeiro que o evento.
    const me = await fetchMe().catch(() => null);
    if (me?.user) store.setUser(me.user, me.quota);
  }
  if (feedback.get('assinatura') === 'cancelada') {
    toast('Checkout cancelado — nenhuma cobrança foi feita.', 'info');
  }

  const current = store.get().plan;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Planos</h1>
          </div>
          <div class="actions"><span class="chip chip-brand">Plano atual: ${esc(PLAN_BY_ID[current].name)}</span></div>
        </div>
      </div>

      <div class="price-grid">
        ${PLANS.map((p) => `
          <div class="card price-card${p.featured ? ' feat' : ''}">
            ${p.featured ? '<span class="tag">Mais popular</span>' : ''}
            <h3>${esc(p.name)}</h3>
            <div class="desc">${esc(p.tagline)}</div>
            <div class="amt"><b>${p.price === 0 ? 'R$ 0' : money(p.price)}</b><span>/mês</span></div>
            <ul>
              ${p.highlights.map((h) => `<li>${icon('checkSmall')}<span>${esc(h)}</span></li>`).join('')}
              ${p.missing.map((h) => `<li class="off">${icon('close')}<span>${esc(h)}</span></li>`).join('')}
            </ul>
            ${botaoDoPlano(p, current)}
          </div>`).join('')}
      </div>

      <div class="section">
        ${featureMatrix({ showKeys: true, sub: 'Exatamente o que a tabela de feature flags declara' })}
      </div>

    </div>`;

  root.querySelectorAll('[data-checkout]').forEach((b) => {
    b.addEventListener('click', () => assinar(b, ctx));
  });
  root.querySelectorAll('[data-portal]').forEach((b) => {
    b.addEventListener('click', () => gerenciar(b));
  });
}

/**
 * Um plano pago vira "Assinar X" (abre o Checkout do Stripe). O Grátis, para
 * quem já paga, vira "Cancelar assinatura" — cancelar é sempre pelo Portal do
 * Stripe, nunca um clique nosso que troca o plano direto, porque só o Stripe
 * sabe de verdade se a assinatura ainda existe.
 */
function botaoDoPlano(p, current) {
  if (p.id === current) {
    return `
      <button class="btn" disabled>Plano atual</button>
      ${p.id !== 'free' ? `<button class="btn btn-sm btn-ghost" style="margin-top:8px;width:100%" data-portal>Gerenciar assinatura</button>` : ''}`;
  }
  if (p.id === 'free') {
    return current === 'free'
      ? ''
      : `<button class="btn" data-portal>Cancelar assinatura</button>`;
  }
  return `<button class="btn ${p.featured ? 'btn-primary' : ''}" data-checkout="${p.id}">Assinar ${esc(p.name)}</button>`;
}

async function assinar(btn, ctx) {
  if (!(await ensureAuth())) return;
  const rotulo = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Redirecionando…';
  try {
    const { url } = await startCheckout(btn.dataset.checkout);
    location.href = url;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = rotulo;
    if (err.code === 'billingNotConfigured') ctx.navigate('#/planos');
  }
}

async function gerenciar(btn) {
  if (!(await ensureAuth())) return;
  const rotulo = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Abrindo…';
  try {
    const { url } = await openBillingPortal();
    location.href = url;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = rotulo;
  }
}
