import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'MedCore HMS',
  description: 'Hospital care and operations workspace',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
