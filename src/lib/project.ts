// 対象のプロジェクトのフォルダ。ソースマップや CSS ファイルの絶対パスを、プロジェクトからの相対パスに直すのに使う
let projectDir = '';
export const getProjectDir = () => projectDir;
export const setProjectDir = (dir: string) => {
  projectDir = dir;
};

/** 絶対パスやバンドラーの URL を、プロジェクトからの相対パスにする。外のファイル（node_modules など）は null */
export function relativeToProject(file: string): string | null {
  const p = decodeURI(file.replace(/^file:\/\//, '')).replace(/[?#].*$/, '');
  if (p.includes('/node_modules/')) return null;
  // webpack writes webpack://_N_E/./app/page.tsx, Turbopack turbopack:///[project]/app/page.tsx
  const bundler = p.match(/^webpack:\/\/[^/]*\/\.\/(.+)$/)?.[1] ?? p.match(/^(?:turbopack:\/\/\/)?\[project\]\/(.+)$/)?.[1];
  if (bundler) return bundler;
  if (projectDir && p.startsWith(`${projectDir}/`)) return p.slice(projectDir.length + 1);
  return p.match(/\/(src\/.+)$/)?.[1] ?? (p.startsWith('/') ? null : p.replace(/^\.\//, ''));
}
