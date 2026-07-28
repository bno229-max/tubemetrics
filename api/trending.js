/**
 * GET /api/trending?region=BR — vídeos e canais em alta em um país.
 *
 * Usa `chart=mostPopular`, que custa 1 unidade para até 50 vídeos e funciona
 * para qualquer país. É o dado global mais barato e mais atual da Data API.
 *
 * ⚠️ Isto é a alta DO MOMENTO. "Mais vistos da semana / do mês / do ano" exige
 * histórico próprio — ver `/api/growth`.
 */

import { fetchTrending, fetchCategories, YouTubeError } from './_youtube.js';
import { json, fail, guard, handleYouTubeError } from './_http.js';

/** Países oferecidos no seletor. ISO 3166-1 alpha-2, como a API exige. */
export const REGIOES = {
  BR: 'Brasil', PT: 'Portugal', US: 'Estados Unidos', MX: 'México', AR: 'Argentina',
  CO: 'Colômbia', CL: 'Chile', PE: 'Peru', ES: 'Espanha', FR: 'França',
  DE: 'Alemanha', IT: 'Itália', GB: 'Reino Unido', CA: 'Canadá', AU: 'Austrália',
  JP: 'Japão', KR: 'Coreia do Sul', IN: 'Índia', ID: 'Indonésia', PH: 'Filipinas',
  RU: 'Rússia', TR: 'Turquia', NG: 'Nigéria', ZA: 'África do Sul', AO: 'Angola',
  MZ: 'Moçambique',
};

/** 1 hora: a lista de alta muda ao longo do dia, mas não de minuto em minuto. */
const CACHE_TRENDING = 'public, s-maxage=3600, stale-while-revalidate=21600';

export default async function handler(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  const region = String(req.query.region || 'BR').toUpperCase();
  if (!REGIOES[region]) {
    return fail(res, 400, 'badRegion', `País não suportado: ${region}.`, { supported: Object.keys(REGIOES) });
  }

  try {
    // As categorias são por país; sem elas os vídeos ficariam sem tema.
    let categories = {};
    try {
      categories = await fetchCategories(apiKey, region);
    } catch {
      categories = {}; // categoria é enfeite, não pode derrubar a rota
    }

    const { videos, channels } = await fetchTrending(region, apiKey, { maxResults: 50, categories });

    if (!videos.length) {
      return fail(res, 404, 'noTrending', `O YouTube não retornou vídeos em alta para ${REGIOES[region]}.`);
    }

    return json(
      res,
      200,
      {
        region,
        regionName: REGIOES[region],
        videos,
        channels,
        fetchedAt: new Date().toISOString(),
        // O front usa isto para rotular corretamente e não prometer histórico.
        basis: 'mostPopular',
      },
      CACHE_TRENDING
    );
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro inesperado em trending:', err);
    return fail(res, 500, 'internal', 'Erro interno ao buscar vídeos em alta.');
  }
}
