import * as stylex from '@stylexjs/stylex';
import { Card } from './Card';
import { colors, fontSizes, space } from './tokens.stylex';

const styles = stylex.create({
  page: { maxWidth: 896, marginInline: 'auto', padding: space.s8, backgroundColor: colors.page, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' },
  heading: { fontSize: fontSizes.xxl, fontWeight: 700, color: colors.brandStrong },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.s4, marginTop: space.s8 },
});

export function App() {
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>Plans</h1>
      <section {...stylex.props(styles.grid)}>
        <Card title="Starter" price="Free" />
        <Card title="Team" price="$12 / month" />
        <Card title="Business" price="$40 / month" />
      </section>
    </main>
  );
}
