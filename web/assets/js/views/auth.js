/**
 * auth.js — Login, 1º acesso e recuperação de senha, sobre Firebase Auth.
 *
 * Substituiu um cadastro que só gravava nome/telefone/e-mail no localStorage:
 * sem senha, sem servidor, e contornável limpando o navegador. Agora a
 * identidade é do Firebase Authentication e a cota mora no Firestore.
 *
 * Quatro telas, todas no mesmo modal (`ensureAuth()` devolve uma Promise que
 * resolve `true` quando a conta fica pronta para usar):
 *
 *   login    → e-mail + senha, ou botão do Google
 *   register → criar conta (e-mail + senha)
 *   profile  → nome e telefone, o que o Firebase Auth não guarda
 *   forgot   → dispara o e-mail de redefinição (quem envia é o Firebase)
 *
 * `profile` não é opcional: sem ele não há telefone, e é o telefone único que
 * impede alguém de criar conta atrás de conta para renovar as 3 análises.
 */

import { modal, icon, toast } from '../ui.js';
import * as store from '../store.js';
import { fetchMe, saveProfile } from '../api.js';
import * as fb from '../firebase-auth.js';

const PHONE_RE = /^\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function maskPhone(value) {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const input = (name, label, attrs = '') =>
  `<label style="display:block;margin-bottom:14px">
    <span class="label" style="display:block;margin-bottom:6px">${label}</span>
    <input class="input" name="${name}" ${attrs}>
    <span class="fs12" data-err="${name}" style="color:var(--neg);display:none;margin-top:5px"></span>
  </label>`;

const googleButton = `
  <button class="btn" type="button" data-google style="width:100%;justify-content:center;gap:9px">
    ${icon('google')} Continuar com Google
  </button>
  <div style="display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--text-3);font-size:12px">
    <i style="flex:1;height:1px;background:var(--border)"></i>ou<i style="flex:1;height:1px;background:var(--border)"></i>
  </div>`;

const SCREENS = {
  login: {
    title: 'Entrar na sua conta',
    subtitle: 'Entre para continuar analisando canais.',
    primary: 'Entrar',
    body: () => `
      ${googleButton}
      <form data-form novalidate>
        ${input('email', 'E-mail', 'type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com"')}
        ${input('password', 'Senha', 'type="password" autocomplete="current-password" placeholder="Sua senha"')}
        <button type="submit" hidden></button>
      </form>
      <div class="flex ac" style="justify-content:space-between">
        <button class="btn btn-ghost btn-sm" data-go="forgot" type="button">Esqueci minha senha</button>
        <button class="btn btn-ghost btn-sm" data-go="register" type="button">Criar conta</button>
      </div>`,
  },
  register: {
    title: 'Primeiro acesso',
    subtitle: 'Crie sua conta e ganhe 3 análises gratuitas.',
    primary: 'Continuar',
    body: () => `
      ${googleButton}
      <form data-form novalidate>
        ${input('email', 'E-mail', 'type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com"')}
        ${input('password', 'Senha', 'type="password" autocomplete="new-password" placeholder="Pelo menos 6 caracteres"')}
        ${input('confirm', 'Confirmar senha', 'type="password" autocomplete="new-password" placeholder="Repita a senha"')}
        <button type="submit" hidden></button>
      </form>
      <div>
        <button class="btn btn-ghost btn-sm" data-go="login" type="button">Já tenho conta, entrar</button>
      </div>`,
  },
  profile: {
    title: 'Complete seu cadastro',
    subtitle: 'Só falta isso para liberar suas análises.',
    primary: 'Concluir cadastro',
    body: () => `
      <form data-form novalidate>
        ${input('name', 'Nome', 'autocomplete="name" placeholder="Como podemos te chamar"')}
        ${input('phone', 'Telefone', 'inputmode="tel" autocomplete="tel" placeholder="(11) 91234-5678"')}
        <p class="muted fs12" style="line-height:1.5">
          ${icon('shield')} Ao continuar, você concorda com nossos
          <a href="./termos.html" target="_blank" style="text-decoration:underline">Termos de Uso</a> e nossa
          <a href="./privacidade.html" target="_blank" style="text-decoration:underline">Política de Privacidade</a>.
        </p>
        <button type="submit" hidden></button>
      </form>`,
  },
  forgot: {
    title: 'Esqueci minha senha',
    subtitle: 'Enviamos um link para você criar uma nova senha.',
    primary: 'Enviar link',
    body: () => `
      <form data-form novalidate>
        ${input('email', 'E-mail', 'type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com"')}
        <button type="submit" hidden></button>
      </form>
      <div>
        <button class="btn btn-ghost btn-sm" data-go="login" type="button">Voltar para entrar</button>
      </div>`,
  },
};

/**
 * Garante conta logada E perfil completo antes de seguir.
 * @returns {Promise<boolean>}
 */
export function ensureAuth() {
  const s = store.get();
  if (s.user) return Promise.resolve(true);

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    // Quem já está autenticado no Firebase mas não tem perfil cai direto no
    // passo que falta, em vez de ser mandado para o login de novo.
    open(s.needsProfile ? 'profile' : 'login', finish);
  });
}

function open(screen, finish) {
  const cfg = SCREENS[screen];
  let switching = false;

  const dialog = modal({
    title: cfg.title,
    subtitle: cfg.subtitle,
    width: 430,
    body: cfg.body(),
    // `onClick: () => false` mantém o modal aberto: quem fecha é o submit,
    // depois que a rede responde.
    actions: [{ label: 'Agora não' }, { label: cfg.primary, primary: true, onClick: () => false }],
  });

  const go = (next) => { switching = true; dialog.close(); open(next, finish); };
  wire(screen, dialog, finish, go);

  const observer = new MutationObserver(() => {
    if (!document.body.contains(dialog.root)) {
      observer.disconnect();
      if (!switching) finish(false);
    }
  });
  observer.observe(document.body, { childList: true });
}

function wire(screen, dialog, finish, go) {
  const root = dialog.root;
  const form = root.querySelector('[data-form]');
  const btn = root.querySelector('.modal-foot .btn-primary');

  const val = (n) => form.querySelector(`[name="${n}"]`)?.value.trim() || '';
  const err = (n, msg) => {
    const box = form.querySelector(`[data-err="${n}"]`);
    if (!box) return;
    box.textContent = msg;
    box.style.display = msg ? 'block' : 'none';
    const el = form.querySelector(`[name="${n}"]`);
    if (el) el.style.borderColor = msg ? 'var(--neg)' : '';
  };
  const clearErrors = () => form.querySelectorAll('[data-err]').forEach((b) => {
    b.style.display = 'none';
    const el = form.querySelector(`[name="${b.dataset.err}"]`);
    if (el) el.style.borderColor = '';
  });

  form.querySelector('[name="phone"]')?.addEventListener('input', (e) => {
    e.target.value = maskPhone(e.target.value);
  });

  root.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go))
  );

  const busy = (on) => {
    btn.disabled = on;
    root.querySelectorAll('[data-google],[data-go]').forEach((b) => { b.disabled = on; });
  };

  /**
   * Depois de autenticar no Firebase, o perfil pode existir (login normal) ou
   * não (conta nova). Um caminho só para os dois casos evita divergir a regra.
   */
  async function afterSignIn() {
    const me = await fetchMe();
    if (me?.user) {
      store.setUser(me.user, me.quota);
      finish(true);
      dialog.close();
      return;
    }
    store.set({ needsProfile: true });
    go('profile');
  }

  root.querySelector('[data-google]')?.addEventListener('click', async () => {
    busy(true);
    try {
      await fb.signInWithGoogle();
      await afterSignIn();
    } catch (e) {
      if (e?.code !== 'auth/popup-closed-by-user') toast(fb.authMessage(e), 'error');
    } finally {
      busy(false);
    }
  });

  async function submit() {
    clearErrors();

    if (screen === 'login') {
      const email = val('email');
      const password = val('password');
      let ok = true;
      if (!EMAIL_RE.test(email)) { err('email', 'E-mail inválido.'); ok = false; }
      if (!password) { err('password', 'Informe sua senha.'); ok = false; }
      if (!ok) return;

      busy(true);
      try {
        await fb.signIn(email, password);
        await afterSignIn();
      } catch (e) {
        err('password', fb.authMessage(e));
      } finally { busy(false); }
      return;
    }

    if (screen === 'register') {
      const email = val('email');
      const password = val('password');
      let ok = true;
      if (!EMAIL_RE.test(email)) { err('email', 'E-mail inválido.'); ok = false; }
      if (password.length < 6) { err('password', 'Pelo menos 6 caracteres.'); ok = false; }
      if (val('confirm') !== password) { err('confirm', 'As senhas não coincidem.'); ok = false; }
      if (!ok) return;

      busy(true);
      try {
        await fb.signUp(email, password);
        await afterSignIn();
      } catch (e) {
        err('email', fb.authMessage(e));
      } finally { busy(false); }
      return;
    }

    if (screen === 'profile') {
      const name = val('name');
      const phone = val('phone');
      let ok = true;
      if (name.length < 2) { err('name', 'Informe seu nome.'); ok = false; }
      if (!PHONE_RE.test(phone)) { err('phone', 'Telefone inválido. Use DDD + número.'); ok = false; }
      if (!ok) return;

      busy(true);
      try {
        const body = await saveProfile({ name, phone });
        store.set({ needsProfile: false });
        store.setUser(body.user, body.quota);
        finish(true);
        dialog.close();
      } catch (e) {
        if (e.code === 'phoneTaken') err('phone', 'Este telefone já está em uso por outra conta.');
        else toast(e.message, 'error');
      } finally { busy(false); }
      return;
    }

    // forgot
    const email = val('email');
    if (!EMAIL_RE.test(email)) return err('email', 'E-mail inválido.');

    busy(true);
    try {
      await fb.sendReset(email);
      root.querySelector('.modal-body').innerHTML = `
        <p class="txt-2 fs13" style="line-height:1.6">
          ${icon('shield')} Se este e-mail tiver uma conta, o link de redefinição já está a caminho.
          Confira também a caixa de spam.
        </p>`;
      root.querySelector('.modal-foot').innerHTML = '';
      const ok = document.createElement('button');
      ok.className = 'btn btn-primary';
      ok.textContent = 'Entendi';
      ok.addEventListener('click', () => dialog.close());
      root.querySelector('.modal-foot').appendChild(ok);
    } catch (e) {
      err('email', fb.authMessage(e));
    } finally { busy(false); }
  }

  btn.addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  setTimeout(() => form.querySelector('input')?.focus(), 60);
}

/** Sai da conta: Firebase encerra a sessão, o store esquece o espelho local. */
export async function signOut() {
  try { await fb.signOut(); } catch { /* já estava fora */ }
  store.clearUser();
}
