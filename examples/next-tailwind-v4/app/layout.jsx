import './globals.css';

export const metadata = { title: 'Next.js + Tailwind v4 example' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
