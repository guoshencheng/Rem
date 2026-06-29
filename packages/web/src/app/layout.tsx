import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Rem Agent',
  description: 'Rem Agent Chat UI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="h-screen overflow-hidden antialiased">{children}</body>
    </html>
  );
}
