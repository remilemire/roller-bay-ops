import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Roller Bay Ops',
  description: 'Roller Bay Ops application starter',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
