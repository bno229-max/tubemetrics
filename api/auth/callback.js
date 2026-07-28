/**
 * GET /api/auth/callback — recebe o retorno do Google e cria a sessão.
 *
 * Sempre termina em REDIRECT para `#/criador` (nunca em JSON): quem chega
 * aqui é o navegador do usuário navegando de volta do Google, não uma chamada
 * de fetch do front-end. Erros vão como `?erro=codigo` no hash, e a tela do
 * Dashboard do Criador lê isso para mostrar o toast certo.
 */

import { parseCookies, setCookie, clearCookie, createSession, sessionStoreReady } from '../_session.js';
import { fetchOwnChannel } from '../_analytics.js';

const APP_URL = (path) => {
  const base = process.env.OAUTH_REDIRECT_URI
    ? new URL(process.env.OAUTH_REDIRECT_URI).origin
    : '';
  return `${base}/${path}`;
};

function redirectToApp(res, hashQuery) {
  res.writeHead(302, { Location: APP_URL(`#/criador?${hashQuery}`) });
  res.end();
}

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;

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
  if (!code || !state || state !== cookies.oauth_state || !cookies.oauth_verifier) {
    // Cobre CSRF (state não bate) e cookie de PKCE expirado (10 min).
    return redirectToApp(res, 'erro=fluxo_invalido');
  }

  clearCookie(res, 'oauth_state');
  clearCookie(res, 'oauth_verifier');

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

    const sessionId = await createSession({
      channelId: channel.id,
      channelTitle: channel.snippet?.title,
      channelHandle: channel.snippet?.customUrl ? `@${channel.snippet.customUrl.replace(/^@/, '')}` : '',
      refreshToken: tokens.refresh_token,
    });

    setCookie(res, 'tm_session', sessionId, { maxAge: 60 * 60 * 24 * 30 }); // 30 dias
    return redirectToApp(res, 'conectado=1');
  } catch (err) {
    console.error('Erro no callback OAuth:', err);
    return redirectToApp(res, 'erro=interno');
  }
}
