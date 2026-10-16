export function resolveApiBase(config, pageOrigin) {
  if (!config.apiOrigin) {
    if (config.hosting === 'github-pages') {
      throw new Error('A API ainda não foi conectada ao site. Entre em contato pelo WhatsApp enquanto a configuração é concluída.');
    }
    return new URL('/api', pageOrigin).href;
  }
  const origin = new URL(config.apiOrigin);
  if (origin.protocol !== 'https:' || !origin.hostname || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('A configuração da API exige uma origem HTTPS sem caminho, credenciais ou parâmetros.');
  }
  return `${origin.origin}/api`;
}
