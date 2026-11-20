import { css } from '../styled-system/css';
import { Card } from './Card';

export function App() {
  return (
    <main className={css({ maxW: '4xl', mx: 'auto', p: '8', bg: 'gray.50', minH: '100vh' })}>
      <h1 className={css({ fontSize: '3xl', fontWeight: 'bold', color: 'brand.600' })}>Plans</h1>
      <section className={css({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4', mt: '8' })}>
        <Card title="Starter" price="Free" />
        <Card title="Team" price="$12 / month" />
        <Card title="Business" price="$40 / month" />
      </section>
    </main>
  );
}
