import { css } from '../styled-system/css';

export function Card({ title, price }: { title: string; price: string }) {
  return (
    <article className={css({ p: '6', bg: 'surface', rounded: 'xl', shadow: 'md' })}>
      <h2 className={css({ fontSize: 'lg', fontWeight: 'semibold' })}>{title}</h2>
      <p className={css({ mt: '2', color: 'muted', fontSize: 'sm' })}>{price}</p>
    </article>
  );
}
