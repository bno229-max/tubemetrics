/**
 * /api/rankings — alta do momento + Top 20 curado, num arquivo só.
 *
 * Consolidado para abrir espaço para `api/stripe-webhook.js` dentro do teto
 * de Serverless Functions do plano Hobby da Vercel (12 por deploy — o mesmo
 * limite que já quebrou o build duas vezes neste projeto). `top.js` e
 * `trending.js` eram os dois candidatos mais naturais: ambos são endpoints
 * públicos e anônimos sobre a mesma YouTube Data API, só que respondendo
 * perguntas diferentes ("o que está em alta agora" vs. "quem são os maiores
 * canais").
 *
 *   GET ?resource=trending&region=BR         → vídeos/canais em alta agora
 *   GET ?resource=top&region=BR&limit=20      → Top 20 por inscritos (lista curada)
 */

import { fetchTrending, fetchCategories, fetchChannelsByHandles, YouTubeError } from './_youtube.js';
import { trackChannel } from './_store.js';
import { json, fail, guard, handleYouTubeError } from './_http.js';

/* ==========================================================================
   Alta do momento (mostPopular)
   ========================================================================== */

/**
 * Usa `chart=mostPopular`, que custa 1 unidade para até 50 vídeos e funciona
 * para qualquer país. É o dado global mais barato e mais atual da Data API.
 *
 * ⚠️ Isto é a alta DO MOMENTO. "Mais vistos da semana / do mês / do ano" exige
 * histórico próprio — ver `/api/growth`.
 */

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

async function handleTrending(req, res) {
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

    /*
     * "Em alta no Brasil" não é o mesmo que "brasileiro": a lista traz trailer
     * internacional, clipe estrangeiro, futebol de fora. Aqui tiramos quem
     * declara OUTRO país.
     *
     * Quem não declara país nenhum fica. É a parte importante: `country` é
     * opcional no YouTube e muito canal legítimo não preenche — descartar
     * esses seria jogar fora conteúdo local de verdade por falta de um campo
     * que o dono nunca preencheu. Excluímos por evidência de que é de fora,
     * nunca por ausência de evidência.
     */
    const doPais = (c) => !c || c === region;
    const videosLocais = videos.filter((v) => doPais(v.channelCountry));
    const canaisLocais = channels.filter((c) => doPais(c.country));

    // Se sobrar quase nada, o recorte enganaria mais do que ajudaria.
    const recorteUtil = videosLocais.length >= 5;

    return json(
      res,
      200,
      {
        region,
        regionName: REGIOES[region],
        videos: recorteUtil ? videosLocais : videos,
        channels: recorteUtil ? canaisLocais : channels,
        // Quantos saíram por serem de fora — a tela explica o recorte.
        filteredOut: recorteUtil ? videos.length - videosLocais.length : 0,
        countryFiltered: recorteUtil,
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

/* ==========================================================================
   Top 20 por inscritos (lista curada)
   ========================================================================== */

/**
 * A YouTube Data API **não** tem endpoint de "canais mais inscritos". O que
 * existe é `search.list`, que ordena por relevância textual e custa 100
 * unidades — inviável para montar um ranking.
 *
 * A solução honesta é uma lista curada de canais conhecidos, resolvida por
 * handle (`channels.list?forHandle=`, 1 unidade cada) e ordenada pelos
 * inscritos REAIS que a API devolve. O recorte é editorial; os números não
 * são. Handles que não resolvem (canal renomeado, handle trocado) são
 * simplesmente ignorados — a lista encolhe, nada quebra.
 */
const SEED_HANDLES = [
  // Religião — o segmento que mais cresceu no Brasil nos últimos anos
  'bispobrunoleonardo', 'padremarcelorossi', 'CancaoNova', 'ipdatransformacao',

  // Infantil — categoria com os maiores números absolutos do país
  'galinhapintadinha', 'MariaClaraeJP', 'LuccasToon', 'totoykids', 'mundobita',
  'turmadamonica', 'BelParaMeninas', 'gatodegalochas', 'CleoPetitLIVE',

  // Entretenimento e humor
  'Whinderssonnunes', 'felipeneto', 'luccasneto', 'portadosfundos', 'vocesabia',
  'T3ddy', 'Enaldinho', 'cocielo', 'Casimito', 'Desimpedidos', 'gkay',

  // Games
  'rezendeevil', 'AuthenticGames', 'jovemnerd', 'robinhoodgamer', 'juliaminegirl',
  'Cellbit', 'coisadenerd',

  // Ciência, educação e curiosidades
  'manualdomundo', 'Nerdologia', 'CanalNostalgia',

  // Culinária
  'cheffotto', 'panelaterapia',

  // Música
  'kondzilla', 'anitta', 'luansantana', 'wesleysafadao', 'henriquejuliano',
  'jorgeemateus', 'gusttavolima', 'zenetoecristiano', 'marilia', 'brunoemarrone',
  'ivetesangalo', 'michelteloficial',

  // Entrevista e podcast
  'flowpodcast',
];

/**
 * Curadoria equivalente para os Estados Unidos. Mesmo critério da lista
 * brasileira: alcance grande e nichos variados, para o ranking não virar uma
 * lista só de música ou só de games.
 */
const SEED_HANDLES_US = [
  // Entretenimento e criadores de alcance massivo
  'MrBeast', 'mrbeast2', 'MrBeastGaming', 'sidemen', 'DudePerfect',
  'markiplier', 'jacksepticeye', 'RyanTrahan', 'AirrackVlogs', 'ZHC',

  // Infantil e família
  'CoComelon', 'LikeNastyaofficial', 'Vlad_and_Niki', 'diana_kids_show',
  'BLIPPI', 'RyansWorld',

  // Games
  'PewDiePie', 'DanTDM', 'Jacksfilms', 'Aphmau', 'preston', 'typicalgamer',

  // Música
  'justinbieber', 'EminemMusic', 'billieeilish', 'TaylorSwift', 'Maroon5',
  'katyperry', 'onedirection',

  // Ciência, educação e curiosidades
  'veritasium', 'MarkRober', 'SmarterEveryDay', 'vsauce', 'kurzgesagt',
  'TED', 'NatGeo', 'CrashCourse',

  // Tecnologia
  'mkbhd', 'LinusTechTips', 'UnboxTherapy',

  // Culinária e estilo de vida
  'BabishCulinaryUniverse', 'joshuaweissman', 'bonappetit',

  // Notícias, talk shows e esportes
  'NBA', 'WWE', 'jimmykimmellive', 'TheTonightShow', 'CNN',
];

/** As listas curadas por país. Cair fora daqui devolve 400, não uma lista vazia. */
const LISTAS = {
  BR: { handles: SEED_HANDLES, nome: 'Brasil' },
  US: { handles: SEED_HANDLES_US, nome: 'Estados Unidos' },
};

/**
 * Piso de inscritos.
 *
 * Handle errado costuma resolver para um canal homônimo minúsculo — a primeira
 * versão desta lista trouxe um canal de 56 inscritos entre os maiores do
 * Brasil. Um ranking "por inscritos" com um canal desses perde a credibilidade
 * inteira, então o piso descarta a resolução equivocada em silêncio.
 */
const MIN_SUBSCRIBERS = 500000;

/** 12 horas: inscritos de canal grande não mudam de forma relevante em um dia. */
const CACHE_TOP = 'public, s-maxage=43200, stale-while-revalidate=172800';

async function handleTop(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const region = String(req.query.region || 'BR').toUpperCase();
  const lista = LISTAS[region];
  if (!lista) {
    return fail(res, 400, 'badRegion', `Ranking não disponível para ${region}.`, { supported: Object.keys(LISTAS) });
  }

  try {
    const channels = await fetchChannelsByHandles(lista.handles, apiKey);

    if (!channels.length) {
      return fail(res, 502, 'noChannels', 'Nenhum canal da lista pôde ser resolvido.');
    }

    const ranked = channels
      .filter((c) => c.statistics.subscriberCount >= MIN_SUBSCRIBERS)
      .sort((a, b) => b.statistics.subscriberCount - a.statistics.subscriberCount)
      .slice(0, limit)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    // O Top 20 resolve dezenas de canais reais de uma vez — oportunidade
    // natural de semear o histórico de crescimento, sem depender de alguém
    // abrir cada canal individualmente. Fogo e esquece: falha aqui não pode
    // atrasar nem derrubar a resposta do ranking.
    Promise.allSettled(
      ranked.map((c) => trackChannel(c.id, { title: c.title, handle: c.handle, thumbnail: c.thumbnail }))
    ).catch(() => {});

    return json(
      res,
      200,
      {
        region,
        regionName: lista.nome,
        channels: ranked,
        total: ranked.length,
        resolved: channels.length,
        requested: lista.handles.length,
        minSubscribers: MIN_SUBSCRIBERS,
        fetchedAt: new Date().toISOString(),
      },
      CACHE_TOP
    );
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro inesperado no ranking:', err);
    return fail(res, 500, 'internal', 'Erro interno ao montar o ranking.');
  }
}

/* ==========================================================================
   Roteamento por `resource`
   ========================================================================== */

export default async function handler(req, res) {
  const resource = req.query.resource;
  if (resource === 'top') return handleTop(req, res);
  if (resource === 'trending') return handleTrending(req, res);
  return fail(res, 400, 'missingResource', 'Informe ?resource=top ou ?resource=trending.');
}
