/**
 * config.js — Único lugar para apontar o app entre dados reais e simulados.
 *
 * `dataSource`:
 *   'auto' — tenta o backend real; se ele não responder (ainda não publicado,
 *            sem chave configurada, cota esgotada), cai para o mock e avisa na
 *            interface. É o padrão porque mantém o app utilizável em qualquer
 *            estágio da configuração.
 *   'live' — exige o backend. Falha visível, sem rede de segurança. Use quando
 *            já estiver tudo configurado e você quiser detectar quebras.
 *   'mock'  — força os dados simulados, útil para demonstração e para
 *            desenvolver a interface sem gastar cota.
 */
const params = new URLSearchParams(location.search);

export const CONFIG = {
  dataSource: params.get('data') || 'auto',
  apiBase: '/api',
  /** Tempo máximo esperando o backend antes de considerar indisponível. */
  timeoutMs: 12000,
  /**
   * `?publiconly=1` remove dos dados simulados exatamente os campos que a
   * YouTube Data API pública não entrega. Serve para conferir como o relatório
   * se comporta com dados reais ANTES de o backend estar publicado — sem isso,
   * a degradação só seria testada em produção, que é o pior lugar para testar.
   */
  simulatePublicOnly: params.get('publiconly') === '1',
};
