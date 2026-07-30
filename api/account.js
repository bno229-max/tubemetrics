/**
 * /api/account — tudo que diz respeito à conta do usuário, numa função só.
 *
 * ## Por que várias operações num endpoint só
 *
 * O plano Hobby da Vercel permite no máximo 12 Serverless Functions por
 * deploy, e cada arquivo em `api/` (fora os `_*.js`, que são ignorados) vira
 * uma. Separar perfil, plano, cota e config em quatro arquivos levou o projeto
 * a 15 e o build passou a falhar — este arquivo é a consolidação que devolve a
 * contagem para dentro do limite.
 *
 * Não é só concessão: as quatro coisas giram em torno do mesmo documento
 * (`users/{uid}`) e do mesmo `verifyRequest`, então juntá-las evita repetir o
 * mesmo preâmbulo de autenticação quatro vezes.
 *
 * ## Rotas
 *
 *   GET  ?resource=config          → config pública do Firebase (sem login)
 *   GET                            → { user, quota, needsProfile }
 *   POST { action: 'profile' }     → 1º acesso: grava nome e telefone
 *   POST { action: 'plan' }        → troca de plano (demonstração)
 *   POST { action: 'quota' }       → gasta 1 análise, ou recusa com 403
 */

import {
  verifyRequest, findUserByUid, createProfile, phoneTakenBy,
  normalizePhone, publicUser, getQuota, setUserPlan, consumeSearch,
} from './_auth.js';
import { firestoreReady } from './_firebase.js';
import { isValidPlan } from './_plans.js';
import { json, fail, NO_CACHE } from './_http.js';

const PHONE_RE = /^\d{10,11}$/;
const clean = (v) => (v || '').trim();

/** Config muda só com o deploy: 1 h de borda evita acordar a função à toa. */
const CACHE_CONFIG = 'public, s-maxage=3600, stale-while-revalidate=86400';

/**
 * Extrai a chave de `FIREBASE_WEB_API_KEY`.
 *
 * O Console do Firebase não mostra a chave sozinha: mostra o bloco de código
 * `const firebaseConfig = { apiKey: "AIza...", authDomain: ... }` inteiro,
 * com comentários. Colar isso direto na variável de ambiente é o caminho
 * natural — e foi o que aconteceu aqui, resultando num `auth/invalid-api-key`
 * de diagnóstico nada óbvio.
 *
 * Em vez de exigir que a pessoa recorte a string certa, aceitamos as duas
 * formas: se o valor não é uma chave limpa, procuramos `apiKey: "..."` dentro
 * dele. Mesmo espírito do `trim()` nas variáveis de OAuth em `_session.js`,
 * onde uma quebra de linha invisível já custou uma sessão inteira de
 * depuração.
 */
function extractApiKey(raw) {
  const value = clean(raw);
  if (!value) return '';
  // Chaves do Google começam com "AIza" e não têm espaço — se já veio limpa,
  // não há o que fazer.
  if (/^AIza[\w-]+$/.test(value)) return value;

  const match = value.match(/apiKey\s*:\s*["'`]([^"'`]+)["'`]/);
  return match ? match[1].trim() : '';
}

/**
 * Config pública do Firebase. Estes valores não são segredo — a `apiKey` do
 * Firebase Web identifica o projeto e não autoriza nada sozinha (quem autoriza
 * são as regras do Firestore e a lista de domínios do console). Vêm de
 * variável de ambiente para o mesmo código servir qualquer projeto.
 */
function firebaseConfig(res) {
  const rawKey = clean(process.env.FIREBASE_WEB_API_KEY);
  const apiKey = extractApiKey(rawKey);
  const projectId = clean(process.env.FIREBASE_PROJECT_ID);

  if (!projectId) {
    return fail(res, 503, 'firebaseAuthNotConfigured', 'Falta a variável FIREBASE_PROJECT_ID.');
  }
  if (!rawKey) {
    return fail(
      res,
      503,
      'firebaseAuthNotConfigured',
      'Falta a variável FIREBASE_WEB_API_KEY (Console do Firebase → Configurações do projeto → Seus apps → Web).'
    );
  }
  if (!apiKey) {
    // A variável existe mas não contém nada parecido com uma chave: dizer isso
    // é muito mais útil que deixar o Firebase responder "invalid-api-key".
    return fail(
      res,
      503,
      'firebaseKeyMalformed',
      'FIREBASE_WEB_API_KEY não parece uma chave válida. Use apenas o valor de apiKey (começa com "AIza"), ou cole o bloco firebaseConfig inteiro.'
    );
  }

  return json(
    res,
    200,
    {
      apiKey,
      projectId,
      authDomain: clean(process.env.FIREBASE_AUTH_DOMAIN) || `${projectId}.firebaseapp.com`,
    },
    CACHE_CONFIG
  );
}

export default async function handler(req, res) {
  // Config é o único caminho que não exige login — é justamente o que o
  // navegador precisa ANTES de conseguir fazer login.
  if (req.method === 'GET' && req.query?.resource === 'config') return firebaseConfig(res);

  if (!firestoreReady()) {
    return fail(res, 503, 'authNotConfigured', 'Autenticação ainda não configurada neste servidor.');
  }

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Nenhuma conta logada.');

  if (req.method === 'GET') {
    const user = await findUserByUid(account.uid);
    // Conta existe no Firebase Auth mas ainda não tem perfil: é o 1º acesso,
    // que ainda precisa informar nome e telefone.
    if (!user) return json(res, 200, { user: null, quota: null, needsProfile: true }, NO_CACHE);
    return json(res, 200, { user: publicUser(user), quota: getQuota(user), needsProfile: false }, NO_CACHE);
  }

  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use GET ou POST.');

  const { action } = req.body || {};

  if (action === 'profile') return saveProfile(req, res, account);
  if (action === 'plan') return changePlan(req, res, account);
  if (action === 'quota') return spendQuota(req, res, account);

  return fail(res, 400, 'unknownAction', 'Ação desconhecida.');
}

/** 1º acesso: nome e telefone, que o Firebase Auth não guarda. */
async function saveProfile(req, res, account) {
  const { name, phone } = req.body || {};
  const cleanName = clean(name);
  const cleanPhone = normalizePhone(phone);

  if (cleanName.length < 2) return fail(res, 400, 'invalidName', 'Informe seu nome.');
  if (!PHONE_RE.test(cleanPhone)) return fail(res, 400, 'invalidPhone', 'Telefone inválido. Use DDD + número.');

  // Telefone único entre contas: é a trava contra criar cadastro atrás de
  // cadastro só para renovar as 3 análises gratuitas.
  if (await phoneTakenBy(cleanPhone, account.uid)) {
    return fail(res, 409, 'phoneTaken', 'Este telefone já está em uso por outra conta.');
  }

  const existing = await findUserByUid(account.uid);
  const user = existing || (await createProfile(account.uid, { name: cleanName, email: account.email, phone: cleanPhone }));

  return json(res, 200, { user: publicUser(user), quota: getQuota(user), needsProfile: false }, NO_CACHE);
}

/** Troca de plano de demonstração — ainda sem cobrança real. */
async function changePlan(req, res, account) {
  const { plan } = req.body || {};
  if (!isValidPlan(plan)) return fail(res, 400, 'invalidPlan', 'Plano inválido.');

  const user = await findUserByUid(account.uid);
  if (!user) return fail(res, 400, 'needsProfile', 'Complete seu cadastro antes de escolher um plano.');

  await setUserPlan(account.uid, plan);
  const updated = { ...user, plan };
  return json(res, 200, { user: publicUser(updated), quota: getQuota(updated) }, NO_CACHE);
}

/**
 * Gasta 1 análise. Roda ANTES de `/api/channel`, que fica cacheado no CDN e é
 * compartilhado entre usuários — a cota não pode viver lá, porque uma resposta
 * servida do cache nem chega a executar a função (ver `CACHE_CHANNEL`).
 *
 * É aqui que o plano Grátis efetivamente trava nas 3 análises: como a contagem
 * mora no Firestore, limpar o navegador não devolve nada — que era o furo do
 * cadastro anterior, guardado em localStorage.
 */
async function spendQuota(req, res, account) {
  const channelId = clean(String((req.body || {}).channelId || ''));
  if (!channelId) return fail(res, 400, 'missingChannelId', 'Canal não informado.');

  const user = await findUserByUid(account.uid);
  if (!user) return fail(res, 400, 'needsProfile', 'Complete seu cadastro para analisar canais.');

  const quota = await consumeSearch(user, channelId);
  if (!quota) {
    return fail(res, 403, 'quotaExceeded', 'Você usou todas as análises do seu plano.', {
      quota: getQuota(user),
    });
  }

  return json(res, 200, { ok: true, quota }, NO_CACHE);
}
