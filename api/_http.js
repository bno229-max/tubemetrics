/**
 * _http.js — Respostas JSON e política de cache.
 *
 * Aqui mora a decisão mais importante do backend na Vercel: o cache não é um
 * banco de dados, é o CDN.
 *
 * `s-maxage` instrui a rede de borda da Vercel a guardar a resposta e servi-la
 * sem acordar a função. Como a chave da requisição é a URL inteira, dois
 * usuários que buscarem o mesmo canal compartilham a mesma resposta — e o
 * segundo não gasta um único ponto da cota do YouTube.
 *
 * `stale-while-revalidate` completa: passado o `s-maxage`, o CDN ainda entrega
 * a cópia antiga imediatamente e revalida em segundo plano. O usuário nunca
 * espera por uma chamada à API do Google, e um pico de acessos não vira um pico
 * de consumo de cota.
 */

/** Busca custa 100 unidades: vale guardar por um dia e servir velho por uma semana. */
export const CACHE_SEARCH = 'public, s-maxage=86400, stale-while-revalidate=604800';

/** Métricas de canal mudam devagar; 6 horas é folgado e mantém a leitura atual. */
export const CACHE_CHANNEL = 'public, s-maxage=21600, stale-while-revalidate=86400';

export const NO_CACHE = 'no-store';

export function json(res, status, body, cacheControl = NO_CACHE) {
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
}

export function fail(res, status, code, message, extra = {}) {
  // Erro nunca é cacheado: seria um problema temporário virando permanente.
  json(res, status, { error: { code, message, ...extra } }, NO_CACHE);
}

/** Aceita apenas GET e devolve a chave configurada, ou encerra a requisição. */
export function guard(req, res) {
  if (req.method !== 'GET') {
    fail(res, 405, 'methodNotAllowed', 'Use GET.');
    return null;
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    fail(
      res,
      503,
      'missingApiKey',
      'A variável de ambiente YOUTUBE_API_KEY não está configurada no projeto da Vercel.'
    );
    return null;
  }
  return apiKey;
}

/** Traduz erros da API do Google para respostas próprias. */
export function handleYouTubeError(res, err) {
  const quota = err.reason === 'quotaExceeded' || err.reason === 'dailyLimitExceeded';
  if (quota) {
    return fail(
      res,
      429,
      'quotaExceeded',
      'A cota diária da YouTube API acabou. Ela reinicia por volta das 5h da manhã (horário de Brasília).'
    );
  }
  if (err.status === 404) return fail(res, 404, err.reason || 'notFound', err.message);
  if (err.status === 403) {
    return fail(
      res,
      403,
      err.reason || 'forbidden',
      'A chave de API foi recusada. Confira se a YouTube Data API v3 está habilitada e se a chave permite essa API.'
    );
  }
  console.error('Erro da YouTube API:', err);
  return fail(res, 502, err.reason || 'upstream', err.message || 'Falha ao consultar a YouTube API.');
}
