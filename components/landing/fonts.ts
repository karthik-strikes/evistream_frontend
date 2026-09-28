import { Crimson_Pro, JetBrains_Mono } from 'next/font/google';

// Landing-only fonts. Inter is already loaded app-wide by app/layout.tsx
// (weights 300–800, exposed as --font-inter), so it is not requested again.
// These two are scoped to the landing root via their CSS variables, so the
// dashboard's typography is untouched.
export const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-landing-serif',
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-landing-mono',
});
