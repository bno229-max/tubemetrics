/**
 * auth.js — Conta de verdade: login, "Primeiro acesso" e recuperação de senha.
 *
 * Substitui signup.js: aquele só guardava nome/telefone/e-mail no navegador
 * (sem senha, sem servidor — qualquer pessoa contornava limpando o
 * localStorage). Aqui existe senha e sessão no servidor (cookie `httpOnly`
 * `tm_uid`), e a cota de análises fica autoritativa no Firestore.
 *
 * Login/cadastro/esqueci-senha continuam como MODAL (mesmo padrão de
 * `ensureLead()` que existia antes: `ensureAuth()` devolve uma Promise que
 * resolve quando a conta fica logada, ou `false` se a pessoa desistir).
 * Só "redefinir senha" é uma ROTA de página inteira de verdade — o link no
 * e-mail precisa abrir uma URL própria, sem depender do app já estar aberto.
 */

import { modal, icon, toast } from '../ui.js';
import { esc } from '../format.js';
import * as store from '../store.js';
import { registerAccount, loginAccount, forgotPassword, resetPassword } from '../api.js';

const PHONE_RE = /^\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function maskPhone(value) {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const field = (name, label, opts = '') =>
  `<label style="display:block;margin-bottom:14px">
    <span class="label" style="display:block;margin-bottom:6px">${label}</span>
    <input class="input" name="${name}" ${opts}>
    <span class="fs12" data-err="${name}" style="color:var(--neg);display:none;margin-top:5px"></span>
  </label>`;

/**
 * Garante que existe uma conta logada antes de seguir.
 * @returns {Promise<boolean>} `true` se já estava logado ou acabou de logar.
 */
export function ensureAuth() {
  if (store.get().user) return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (ok) => { if (!finished) { finished = true; resolve(ok); } };
    openAuthModal('login', finish);
  });
}

function openAuthModal(mode, finish) {
  let switching = false;
  const gotoMode = (next) => { switching = true; dialog.close(); openAuthModal(next, finish); };

  const dialog = modal({
    title: TITLES[mode],
    subtitle: SUBTITLES[mode],
    width: 440,
    body: BODIES[mode](),
    actions: ACTIONS[mode](gotoMode),
  });

  wireForm(mode, dialog, finish, gotoMode);

  const observer = new MutationObserver(() => {
    if (!document.body.contains(dialog.root)) {
      observer.disconnect();
      if (!switching) finish(false);
    }
  });
  observer.observe(document.body, { childList: true });
}

const TITLES = {
  login: 'Entrar na sua conta',
  register: 'Primeiro acesso',
  forgot: 'Esqueci minha senha',
};
const SUBTITLES = {
  login: 'Entre para continuar analisando canais.',
  register: 'Crie sua conta — é rápido e libera as 3 análises grátis vitalícias.',
  forgot: 'Enviamos um link de redefinição para o seu e-mail.',
};

const BODIES = {
  login: () => `
    <form data-auth-form novalidate>
      ${field('email', 'E-mail', 'type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com" required')}
      ${field('password', 'Senha', 'type="password" autocomplete="current-password" placeholder="Sua senha" required')}
      <button type="submit" hidden></button>
    </form>
    <div class="flex ac" style="justify-content:space-between;margin-top:6px">
      <button class="btn btn-ghost btn-sm" data-link="forgot" type="button">Esqueci minha senha</button>
      <button class="btn btn-ghost btn-sm" data-link="register" type="button">Criar conta</button>
    </div>`,
  register: () => `
    <form data-auth-form novalidate>
      ${field('name', 'Nome', 'autocomplete="name" placeholder="Como podemos te chamar" required')}
      ${field('phone', 'Telefone', 'inputmode="tel" autocomplete="tel" placeholder="(11) 91234-5678" required')}
      ${field('email', 'E-mail', 'type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com" required')}
      ${field('password', 'Senha', 'type="password" autocomplete="new-password" placeholder="Pelo menos 6 caracteres" required')}
      ${field('confirm', 'Confirmar senha', 'type="password" autocomplete="new-password" placeholder="Repita a senha" required')}
      <p class="muted fs12" style="margin-top:2px;line-height:1.5">
        ${icon('shield')} Ao continuar, você concorda com nossos
        <a href="./termos.html" target="_blank" style="text-decoration:underline">Termos de Uso</a> e nossa
        <a href="./privacidade.html" target="_blank" style="text-decoration:underline">Política de Privacidade</a>.
      </p>
      <button type="submit" hidden></button>
    </form>
    <div style="margin-top:6px">
      <button class="btn btn-ghost btn-sm" data-link="login" type="button">Já tenho conta, entrar</button>
    </div>`,
  forgot: () => `
    <form data-auth-form novalidate>
      ${field('email', 'E-mail', 'type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com" required')}
      <button type="submit" hidden></button>
    </form>
    <div style="margin-top:6px">
      <button class="btn btn-ghost btn-sm" data-link="login" type="button">Voltar para entrar</button>
    </div>`,
};

const ACTIONS = {
  login: () => [{ label: 'Agora não' }, { label: 'Entrar', primary: true, onClick: () => false }],
  register: () => [{ label: 'Agora não' }, { label: 'Criar conta', primary: true, onClick: () => false }],
  forgot: () => [{ label: 'Fechar' }, { label: 'Enviar link', primary: true, onClick: () => false }],
};

function wireForm(mode, dialog, finish, gotoMode) {
  const form = dialog.root.querySelector('[data-auth-form]');
  const val = (n) => form.querySelector(`[name="${n}"]`)?.value.trim() || '';
  const errBox = (n) => form.querySelector(`[data-err="${n}"]`);
  const showError = (n, msg) => {
    const box = errBox(n);
    if (!box) return;
    box.textContent = msg;
    box.style.display = msg ? 'block' : 'none';
    form.querySelector(`[name="${n}"]`).style.borderColor = msg ? 'var(--neg)' : '';
  };
  const clearErrors = () => ['name', 'phone', 'email', 'password', 'confirm'].forEach((n) => showError(n, ''));

  form.querySelector('[name="phone"]')?.addEventListener('input', (e) => {
    e.target.value = maskPhone(e.target.value);
  });

  dialog.root.querySelectorAll('[data-link]').forEach((btn) => {
    btn.addEventListener('click', () => gotoMode(btn.dataset.link));
  });

  const primaryBtn = dialog.root.querySelector('.modal-foot .btn-primary');

  async function submit() {
    clearErrors();

    if (mode === 'login') {
      const email = val('email');
      const password = val('password');
      let ok = true;
      if (!EMAIL_RE.test(email)) { showError('email', 'E-mail inválido.'); ok = false; }
      if (!password) { showError('password', 'Informe sua senha.'); ok = false; }
      if (!ok) return false;

      primaryBtn.disabled = true;
      try {
        const body = await loginAccount({ email, password });
        store.setUser(body.user, body.quota);
        finish(true);
        dialog.close();
        return true;
      } catch (err) {
        showError('password', err.code === 'invalidCredentials' ? 'E-mail ou senha incorretos.' : err.message);
        return false;
      } finally {
        primaryBtn.disabled = false;
      }
    }

    if (mode === 'register') {
      const name = val('name');
      const phone = val('phone');
      const email = val('email');
      const password = val('password');
      const confirm = val('confirm');
      let ok = true;
      if (name.length < 2) { showError('name', 'Informe seu nome.'); ok = false; }
      if (!PHONE_RE.test(phone)) { showError('phone', 'Telefone inválido. Use DDD + número.'); ok = false; }
      if (!EMAIL_RE.test(email)) { showError('email', 'E-mail inválido.'); ok = false; }
      if (password.length < 6) { showError('password', 'Pelo menos 6 caracteres.'); ok = false; }
      if (confirm !== password) { showError('confirm', 'As senhas não coincidem.'); ok = false; }
      if (!ok) return false;

      primaryBtn.disabled = true;
      try {
        const body = await registerAccount({ name, phone, email, password });
        store.setUser(body.user, body.quota);
        finish(true);
        dialog.close();
        return true;
      } catch (err) {
        if (err.code === 'emailTaken') showError('email', 'Este e-mail já tem uma conta. Faça login.');
        else if (err.code === 'phoneTaken') showError('phone', 'Este telefone já está em uso por outra conta.');
        else toast(err.message, 'error');
        return false;
      } finally {
        primaryBtn.disabled = false;
      }
    }

    // forgot
    const email = val('email');
    if (!EMAIL_RE.test(email)) { showError('email', 'E-mail inválido.'); return false; }

    primaryBtn.disabled = true;
    try {
      await forgotPassword(email);
      dialog.root.querySelector('.modal-body').innerHTML = `
        <p class="txt-2 fs13" style="line-height:1.6">
          ${icon('shield')} Se este e-mail tiver uma conta, enviamos um link de redefinição —
          ele vale por 1 hora. Confira também a caixa de spam.
        </p>`;
      dialog.root.querySelectorAll('.modal-foot .btn').forEach((b) => b.remove());
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn btn-primary';
      closeBtn.textContent = 'Entendi';
      closeBtn.addEventListener('click', () => dialog.close());
      dialog.root.querySelector('.modal-foot').appendChild(closeBtn);
      return false; // não fecha sozinho — o botão acima fecha
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      primaryBtn.disabled = false;
    }
  }

  primaryBtn?.addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  setTimeout(() => form.querySelector('input')?.focus(), 60);
}

/* ==========================================================================
   Redefinir senha — rota de página inteira (link vindo por e-mail)
   ========================================================================== */

export default async function resetPasswordPage(root, params, ctx) {
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';

  root.innerHTML = `
    <div class="landing">
      <nav class="lp-nav">
        <div class="brand"><span class="logo-mark"></span><strong>TubeMetrics</strong></div>
      </nav>
      <div style="max-width:420px;margin:60px auto;padding:0 20px">
        <div class="card" style="padding:32px">
          <h2 style="font-size:19px;font-weight:660;margin-bottom:6px">Redefinir senha</h2>
          <p class="muted fs13" style="margin-bottom:20px">Escolha uma nova senha para sua conta.</p>
          <form data-reset-form novalidate>
            ${field('password', 'Nova senha', 'type="password" autocomplete="new-password" placeholder="Pelo menos 6 caracteres" required')}
            ${field('confirm', 'Confirmar senha', 'type="password" autocomplete="new-password" placeholder="Repita a senha" required')}
            <button class="btn btn-primary" style="width:100%;margin-top:6px" type="submit">Redefinir senha</button>
          </form>
        </div>
      </div>
    </div>`;

  if (!token) {
    root.querySelector('[data-reset-form]').outerHTML =
      `<p class="txt-2 fs13">Este link é inválido. Peça um novo em "Esqueci minha senha".</p>`;
    return;
  }

  const form = root.querySelector('[data-reset-form]');
  const val = (n) => form.querySelector(`[name="${n}"]`).value.trim();
  const errBox = (n) => form.querySelector(`[data-err="${n}"]`);
  const showError = (n, msg) => {
    const box = errBox(n);
    box.textContent = msg;
    box.style.display = msg ? 'block' : 'none';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = val('password');
    const confirm = val('confirm');
    showError('password', '');
    showError('confirm', '');
    if (password.length < 6) return showError('password', 'Pelo menos 6 caracteres.');
    if (confirm !== password) return showError('confirm', 'As senhas não coincidem.');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await resetPassword(token, password);
      form.outerHTML = `<p class="txt-2 fs13">Senha redefinida! <a href="#/" style="text-decoration:underline">Voltar e entrar</a> com a nova senha.</p>`;
    } catch (err) {
      toast(err.code === 'invalidToken' ? 'Este link expirou ou já foi usado. Peça um novo.' : err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
