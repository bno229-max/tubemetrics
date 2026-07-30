/**
 * GET /api/auth/callback — recebe o retorno do Google e cria a sessão.
 *
 * Sempre termina em REDIRECT para `#/criador` (nunca em JSON): quem chega
 * aqui é o navegador do usuário navegando de volta do Google, não uma chamada
 * de fetch do front-end. Erros vão como `?erro=codigo` no hash, e a tela do
 * Dashboard do Criador lê isso para mostrar o toast certo.
 */

import {
  parseCookies, clearCookie, saveConnection, listConnections, sessionStoreReady,
  googleClientId, googleClientSecret, oauthRedirectUri,
} from '../_session.js';
import { findUserByUid } from '../_auth.js';
import { channelLimit } from '../_plans.js';
import { fetchOwnChannel } from '../_analytics.js';

const APP_URL = (path) => {
  const redirectUri = oauthRedirectUri();
  const base = redirectUri ? new URL(redirectUri).origin : '';
  return `${base}/${path}`;
};

/**
 * `res.writeHead(302, { Location })` recebe um segundo objeto de headers que,
 * a depender de como o runtime encapsula a resposta, pode substituir os
 * headers já definidos via `res.setHeader()` em vez de somar a eles — é
 * exatamente onde o cookie da sessão poderia se perder mesmo com o resto do
 * fluxo dando certo. `setHeader` + `res.end()` evita essa ambiguidade: o
 * `Location` entra no MESMO mecanismo de acúmulo que já guarda os `Set-Cookie`.
 */
function redirectToApp(res, hashQuery) {
  res.statusCode = 302;
  res.setHeader('Location', APP_URL(`#/criador?${hashQuery}`));
  res.end();
}

export default async function handler(req, res) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  const redirectUri = oauthRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    return redirectToApp(res, 'erro=oauth_nao_configurado');
  }
  if (!sessionStoreReady()) {
    return redirectToApp(res, 'erro=sessao_nao_configurada');
  }

  const { code, state, error: googleError } = req.query;
  const cookies = parseCookies(req);

  if (googleError) {
    // O próprio usuário cancelou o consentimento — não é uma falha do sistema.
    return redirectToApp(res, `erro=cancelado`);
  }
  if (!code || !state || state !== cookies.oauth_state || !cookies.oauth_verifier || !cookies.oauth_uid) {
    // Cobre CSRF (state não bate) e cookie de PKCE expirado (10 min).
    return redirectToApp(res, 'erro=fluxo_invalido');
  }

  const uid = cookies.oauth_uid;
  clearCookie(res, 'oauth_state');
  clearCookie(res, 'oauth_verifier');
  clearCookie(res, 'oauth_uid');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: cookies.oauth_verifier,
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('Falha na troca de tokens OAuth:', tokens);
      return redirectToApp(res, 'erro=token');
    }
    if (!tokens.refresh_token) {
      // Não deveria acontecer com prompt=consent, mas cobre o caso mesmo assim.
      return redirectToApp(res, 'erro=sem_refresh_token');
    }

    const channel = await fetchOwnChannel(tokens.access_token);
    if (!channel) {
      return redirectToApp(res, 'erro=canal_nao_encontrado');
    }

    const user = await findUserByUid(uid);
    if (!user) return redirectToApp(res, 'erro=conta_nao_encontrada');

    // O teto é conferido de novo aqui, e não só em `start.js`: entre iniciar
    // o consentimento e voltar, o plano pode ter mudado ou outra aba pode ter
    // conectado um canal. Reconectar um canal que já é seu não conta como
    // novo — é só atualizar o token dele.
    const jaConectados = await listConnections(uid);
    const eNovo = !jaConectados.some((c) => c.channelId === channel.id);
    if (eNovo && jaConectados.length >= channelLimit(user.plan)) {
      return redirectToApp(res, 'erro=limite_de_canais');
    }

    await saveConnection({
      uid,
      channelId: channel.id,
      channelTitle: channel.snippet?.title,
      channelHandle: channel.snippet?.customUrl ? `@${channel.snippet.customUrl.replace(/^@/, '')}` : '',
      refreshToken: tokens.refresh_token,
    });

    return redirectToApp(res, `conectado=1&canal=${encodeURIComponent(channel.id)}`);
  } catch (err) {
    console.error('Erro no callback OAuth:', err);
    return redirectToApp(res, 'erro=interno');
  }
}
