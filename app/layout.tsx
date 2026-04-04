import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'eviStreams - AI-Powered Medical Data Extraction',
  description: 'Automate systematic review data extraction with AI-generated code',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking script: applies dark class before React hydrates to prevent flash */}
        <Script id="theme-init" strategy="beforeInteractive">{`(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}})();`}</Script>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className={`font-sans ${inter.variable}`}>
        <Script id="error-handler" strategy="afterInteractive">{`
          window.addEventListener('unhandledrejection', function(e) {
            if (!e.reason) return;
            fetch('/api/v1/logs/client', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({level:'error', message:'Unhandled rejection: ' + (e.reason?.message || String(e.reason)), context:{stack: e.reason?.stack?.slice(0,500)}}),
              keepalive: true
            }).catch(function(){});
          });
          window.addEventListener('error', function(e) {
            if (!e.message) return;
            fetch('/api/v1/logs/client', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({level:'error', message:'JS error: ' + e.message, context:{filename: e.filename, lineno: e.lineno}}),
              keepalive: true
            }).catch(function(){});
          });
        `}</Script>
        <Providers><ErrorBoundary>{children}</ErrorBoundary></Providers>
      </body>
    </html>
  );
}
