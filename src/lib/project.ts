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
  // webpack は webpack://_N_E/./app/page.tsx の形
  const webpack = p.match(/^webpack:\/\/[^/]*\/\.\/(.+)$/)?.[1];
  if (webpack) return webpack;
  if (projectDir && p.startsWith(`${projectDir}/`)) return p.slice(projectDir.length + 1);
  return p.match(/\/(src\/.+)$/)?.[1] ?? (p.startsWith('/') ? null : p.replace(/^\.\//, ''));
}
