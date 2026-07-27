/**
 * signup.js — Cadastro exigido antes da primeira análise.
 *
 * ⚠️ Isto é captura de lead no navegador, NÃO autenticação. Os dados ficam em
 * `localStorage` e qualquer pessoa contorna o formulário limpando o storage.
 * Para virar cadastro de verdade — com sessão, verificação de e-mail e cota
 * amarrada à conta — os dados precisam ir para um backend, junto com a mesma
 * checagem de plano do lado do servidor.
 */

import { modal, icon } from '../ui.js';
import { esc } from '../format.js';
import * as store from '../store.js';

/** Aceita formatos brasileiros com ou sem máscara, fixo ou celular. */
const PHONE_RE = /^\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Máscara progressiva: (11) 91234-5678 */
function maskPhone(value) {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Garante que existe cadastro antes de seguir.
 * @returns {Promise<boolean>} `true` se já havia ou se acabou de cadastrar.
 */
export function ensureLead() {
  if (store.hasLead()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let done = false;

    const dialog = modal({
      title: 'Crie sua conta para analisar canais',
      subtitle: 'É rápido e libera as 3 análises gratuitas do mês.',
      width: 460,
      body: `
        <form data-signup novalidate>
          <label style="display:block;margin-bottom:14px">
            <span class="label" style="display:block;margin-bottom:6px">Nome</span>
            <input class="input" name="name" autocomplete="name" placeholder="Como podemos te chamar" required>
            <span class="fs12" data-err="name" style="color:var(--neg);display:none;margin-top:5px"></span>
          </label>
          <label style="display:block;margin-bottom:14px">
            <span class="label" style="display:block;margin-bottom:6px">Telefone</span>
            <input class="input" name="phone" inputmode="tel" autocomplete="tel" placeholder="(11) 91234-5678" required>
            <span class="fs12" data-err="phone" style="color:var(--neg);display:none;margin-top:5px"></span>
          </label>
          <label style="display:block">
            <span class="label" style="display:block;margin-bottom:6px">E-mail</span>
            <input class="input" name="email" type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com" required>
            <span class="fs12" data-err="email" style="color:var(--neg);display:none;margin-top:5px"></span>
          </label>
          <p class="muted fs12" style="margin-top:14px;line-height:1.5">
            ${icon('shield')} Usamos seus dados só para identificar sua conta e avisar sobre o produto.
            Nesta versão eles ficam salvos apenas neste navegador.
          </p>
          <button type="submit" hidden></button>
        </form>`,
      actions: [
        { label: 'Agora não' },
        {
          label: 'Criar conta',
          primary: true,
          onClick: () => submit(),
        },
      ],
    });

    const form = dialog.root.querySelector('[data-signup]');
    const field = (n) => form.querySelector(`[name="${n}"]`);
    const errBox = (n) => form.querySelector(`[data-err="${n}"]`);

    const showError = (n, msg) => {
      const box = errBox(n);
      box.textContent = msg;
      box.style.display = msg ? 'block' : 'none';
      field(n).style.borderColor = msg ? 'var(--neg)' : '';
    };

    field('phone').addEventListener('input', (e) => {
      e.target.value = maskPhone(e.target.value);
    });
    ['name', 'phone', 'email'].forEach((n) =>
      field(n).addEventListener('input', () => showError(n, ''))
    );

    function submit() {
      const name = field('name').value.trim();
      const phone = field('phone').value.trim();
      const email = field('email').value.trim();

      let ok = true;
      if (name.length < 2) { showError('name', 'Informe seu nome.'); ok = false; }
      if (!PHONE_RE.test(phone)) { showError('phone', 'Telefone inválido. Use DDD + número.'); ok = false; }
      if (!EMAIL_RE.test(email)) { showError('email', 'E-mail inválido.'); ok = false; }
      if (!ok) return false; // mantém o modal aberto

      store.saveLead({ name, phone, email });
      done = true;
      resolve(true);
      return true;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submit() !== false) dialog.close();
    });

    // Fechar sem cadastrar precisa devolver `false`, senão a busca seguiria.
    const observer = new MutationObserver(() => {
      if (!document.body.contains(dialog.root)) {
        observer.disconnect();
        if (!done) resolve(false);
      }
    });
    observer.observe(document.body, { childList: true });

    setTimeout(() => field('name')?.focus(), 60);
  });
}

/** Cartão de conta, exibido no painel. */
export function leadCard() {
  const lead = store.get().lead;
  if (!lead) return '';
  return `<div class="flex ac g8 fs13">
    <span class="muted">${icon('users')}</span>
    <span><b>${esc(lead.name)}</b> · ${esc(lead.email)}</span>
  </div>`;
}
