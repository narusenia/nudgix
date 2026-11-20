import { Button } from './components/Button';
import { Card } from './components/Card';

export default function Page() {
  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <span className="font-semibold">Acme</span>
        <nav className="flex gap-4 text-gray-500">
          <a href="#">Pricing</a>
          <a href="#">Docs</a>
          <a href="#">Blog</a>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-12">
        <section>
          <h1 className="mb-3 text-4xl font-bold">Ship UI tweaks faster</h1>
          <p className="mb-6 text-gray-500">Try spacing, color and type in the browser, then hand the list to Claude.</p>
          <Button>Get started</Button>
        </section>
        <section className="mt-12 grid grid-cols-3 gap-4">
          <Card title="Starter" badge="Free">
            For side projects.
          </Card>
          <Card title="Team" badge="Popular" accent>
            For small teams that ship every day.
          </Card>
          <Card title="Enterprise" badge="Contact us">
            SSO, audit logs and support.
          </Card>
        </section>
      </main>
    </>
  );
}
