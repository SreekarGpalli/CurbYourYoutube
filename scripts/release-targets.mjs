export const releaseTargets = ['chrome', 'firefox', 'chrome-store'];

export function archiveName(target, version) {
  return target === 'chrome-store'
    ? `curb-video-focus-chrome-store-${version}.zip`
    : `curb-your-youtube-${target}-${version}.zip`;
}

export function storeSource(source) {
  return source.replaceAll('Curb Your YouTube', 'Curb Video Focus').replace('const STORE_BUILD = false;', 'const STORE_BUILD = true;');
}
