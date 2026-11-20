import type { Category } from '../lib/types';
import s from './ui.module.css';

/** Small sample of a token value. Colors as a square, radius as a corner, spacing as a bar, text as Aa, shadows as a small card casting the shadow */
export function Specimen({ category, value }: { category: Category; value: string | undefined }) {
  if (!value) return null;
  const px = Number.parseFloat(value);
  switch (category) {
    case 'colors':
      return <span aria-hidden="true" className={s.icoColor} style={{ background: value }} />;
    case 'radii':
      return <span aria-hidden="true" className={s.icoRadius} style={{ borderTopLeftRadius: Math.min(px || 0, 10) }} />;
    case 'shadows':
      // Place it at half size on a light base so the shadow is visible even on dark panels
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
