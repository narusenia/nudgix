import * as stylex from '@stylexjs/stylex';
import { colors, fontSizes, radii, space } from './tokens.stylex';

const styles = stylex.create({
  card: { padding: space.s6, backgroundColor: colors.surface, borderRadius: radii.xl, boxShadow: '0 1px 3px rgb(0 0 0 / 0.1)' },
  title: { fontSize: fontSizes.lg, fontWeight: 600, color: colors.text },
  price: { marginTop: space.s2, fontSize: fontSizes.sm, color: colors.muted },
});

export function Card({ title, price }: { title: string; price: string }) {
  return (
    <article {...stylex.props(styles.card)}>
      <h2 {...stylex.props(styles.title)}>{title}</h2>
      <p {...stylex.props(styles.price)}>{price}</p>
    </article>
  );
}
