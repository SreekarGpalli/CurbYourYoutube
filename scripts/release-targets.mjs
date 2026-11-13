export const releaseTargets = ['chrome', 'firefox', 'chrome-store'];

export function archiveName(target, version) {
  return target === 'chrome-store'
    ? `curb-your-youtube-chrome-store-${version}.zip`
    : `curb-your-youtube-${target}-${version}.zip`;
}

export function storeSource(source) {
  return source.replace('const STORE_BUILD = false;', 'const STORE_BUILD = true;');
}
