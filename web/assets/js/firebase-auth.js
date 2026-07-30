/**
 * firebase-auth.js — Firebase Authentication no navegador.
 *
 * Única dependência externa do projeto, e por um bom motivo: senha, e-mail de
 * redefinição e unicidade de conta são problemas resolvidos há anos, e mal
 * resolvidos dão vazamento de dados. O SDK é carregado sob demanda — quem
 * nunca abre a tela de login nunca baixa esses 160 KB.
 *
 * Nada aqui fala com o nosso backend. O que sai deste módulo é o ID token, e
 * é `api.js` que o anexa às requisições (ver `authHeader()` lá).
 */

const SDK = 'https://www.gstatic.com/firebasejs/11.10.0/';

let ready = null;

/**
 * Carrega o SDK + config e devolve `{ auth, fns }`. Memoizado: chamadas
 * seguintes reaproveitam a mesma promessa, então o SDK entra uma vez só.
 */
function init() {
  if (ready) return ready;

  ready = (async () => {
    const [{ initializeApp }, authMod, cfgRes] = await Promise.all([
      import(`${SDK}firebase-app.js`),
      import(`${SDK}firebase-auth.js`),
      fetch('/api/firebase-config'),
    ]);

    if (!cfgRes.ok) {
      const body = await cfgRes.json().catch(() => null);
      throw new Error(body?.error?.message || 'Firebase Authentication não está configurado neste servidor.');
    }

    const app = initializeApp(await cfgRes.json());
    const auth = authMod.getAuth(app);
    // Sessão sobrevive a fechar o navegador — é o que se espera de um SaaS.
    await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
    return { auth, fns: authMod };
  })();

  // Uma falha de rede não pode deixar o módulo inutilizável para sempre.
  ready.catch(() => { ready = null; });
  return ready;
}

/**
 * Traduz os códigos do Firebase para frases que fazem sentido para quem está
 * olhando a tela. Sem isto, o usuário lê "auth/invalid-credential".
 */
const MESSAGES = {
  'auth/email-already-in-use': 'Este e-mail já tem uma conta. Faça login.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
  'auth/popup-closed-by-user': 'Login cancelado.',
  'auth/operation-not-allowed': 'Este método de login não está habilitado no Firebase.',
};

export const authMessage = (err) => MESSAGES[err?.code] || err?.message || 'Não foi possível concluir. Tente de novo.';

/* ------------------------------------------------------------- operações */

export async function signUp(email, password) {
  const { auth, fns } = await init();
  const cred = await fns.createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signIn(email, password) {
  const { auth, fns } = await init();
  const cred = await fns.signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Login com a conta Google — sem senha para lembrar nem para redefinir. */
export async function signInWithGoogle() {
  const { auth, fns } = await init();
  const provider = new fns.GoogleAuthProvider();
  const cred = await fns.signInWithPopup(auth, provider);
  return cred.user;
}

/** O Firebase envia o e-mail de redefinição; nós não tocamos em senha. */
export async function sendReset(email) {
  const { auth, fns } = await init();
  await fns.sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  const { auth, fns } = await init();
  await fns.signOut(auth);
}

/**
 * ID token do usuário atual, ou `null`. O SDK renova sozinho quando está
 * perto de expirar, então basta pedir antes de cada requisição.
 */
export async function idToken() {
  if (!ready) return null; // SDK nunca carregou = ninguém logou nesta aba
  try {
    const { auth } = await init();
    return auth.currentUser ? await auth.currentUser.getIdToken() : null;
  } catch {
    return null;
  }
}

/**
 * Existe sessão salva neste navegador?
 *
 * O SDK guarda o usuário logado em `firebase:authUser:<apiKey>:[DEFAULT]`.
 * Ler essa chave é o suficiente para saber se VALE A PENA baixar o SDK no
 * boot — visitante que nunca logou não paga os 160 KB por nada. É só uma
 * dica de desempenho: quem manda sobre a sessão continua sendo o Firebase.
 */
export function hasStoredSession() {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('firebase:authUser:'));
  } catch {
    return false; // modo privado com storage bloqueado
  }
}

/**
 * Avisa quando o Firebase termina de restaurar (ou não) a sessão salva.
 * Resolve com o usuário do Firebase ou `null` — é o gatilho para o app
 * decidir se hidrata a conta no boot.
 */
export async function whenAuthReady() {
  const { auth, fns } = await init();
  return new Promise((resolve) => {
    const stop = fns.onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}
