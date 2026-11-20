// The target project's folder. Used to turn absolute paths from source maps and CSS files into project-relative paths
let projectDir = '';
export const getProjectDir = () => projectDir;
export const setProjectDir = (dir: string) => {
  projectDir = dir;
};

/** Turn an absolute path or bundler URL into a project-relative path. null for files outside it (node_modules etc.) */
export function relativeToProject(file: string): string | null {
  const p = decodeURI(file.replace(/^file:\/\//, '')).replace(/[?#].*$/, '');
  if (p.includes('/node_modules/')) return null;
  // webpack writes webpack://_N_E/./app/page.tsx, Turbopack turbopack:///[project]/app/page.tsx
  const bundler = p.match(/^webpack:\/\/[^/]*\/\.\/(.+)$/)?.[1] ?? p.match(/^(?:turbopack:\/\/\/)?\[project\]\/(.+)$/)?.[1];
  if (bundler) return bundler;
  if (projectDir && p.startsWith(`${projectDir}/`)) return p.slice(projectDir.length + 1);
  return p.match(/\/(src\/.+)$/)?.[1] ?? (p.startsWith('/') ? null : p.replace(/^\.\//, ''));
}
