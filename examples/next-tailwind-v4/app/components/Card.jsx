export function Card({ title, children, badge, accent = false }) {
  return (
    <article className="rounded-card border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <p className="mb-4 text-gray-500">{children}</p>
      <span className={accent ? 'rounded-full bg-brand-50 px-2 py-1 text-sm text-brand-700' : 'rounded-full bg-gray-100 px-2 py-1 text-sm'}>{badge}</span>
    </article>
  );
}
