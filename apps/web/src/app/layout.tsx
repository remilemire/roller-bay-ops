import type { Metadata } from 'next';
import { Providers } from './providers';
import { colorThemeScript, defaultColorTheme } from '@/lib/color-themes';
import '@/styles/globals.css';
export const metadata: Metadata = {
  title: { default: 'Roller Bay · Operations', template: '%s · Roller Bay' },
  description: 'Fabric inventory and production, thoughtfully connected.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-color-theme={defaultColorTheme}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorThemeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
