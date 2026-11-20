import type { Category } from '../lib/types';
import s from './ui.module.css';

/** トークンの値の小さい見本。色は四角、角丸は角の形、余白は幅のバー、文字は Aa、影は影を落とした小さいカード */
export function Specimen({ category, value }: { category: Category; value: string | undefined }) {
  if (!value) return null;
  const px = Number.parseFloat(value);
  switch (category) {
    case 'colors':
      return <span aria-hidden="true" className={s.icoColor} style={{ background: value }} />;
    case 'radii':
      return <span aria-hidden="true" className={s.icoRadius} style={{ borderTopLeftRadius: Math.min(px || 0, 10) }} />;
    case 'shadows':
      // 暗いパネルでも影が見えるよう、明るい台に半分の大きさで置く
      return value === 'none' ? null : (
        <span aria-hidden="true" className={s.icoShadow}>
          <span style={{ boxShadow: value }} />
        </span>
      );
    case 'spacing':
    case 'sizes':
      return <span aria-hidden="true" className={s.icoSpace} style={{ width: Math.max(Math.min(px || 0, 28), 2) }} />;
    case 'fontWeights':
      return (
        <span aria-hidden="true" className={s.icoText} style={{ fontWeight: value }}>
          Aa
        </span>
      );
    default:
      return null;
  }
}
