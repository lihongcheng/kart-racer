/** Published assets also work when the game is served below a repository path. */
export function assetUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
