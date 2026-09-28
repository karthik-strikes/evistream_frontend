'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui/logo';
import styles from './landing.module.css';
import { GET_STARTED_HREF, RESEARCH_URL } from './links';

const NAV_LINK = 'text-[13px] text-[#5a5a5a] transition-colors hover:text-[#990000]';

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || document.documentElement.scrollTop) > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className="sticky top-0 z-50 border-b border-[#e4e4e7] bg-white/[0.92] backdrop-blur-[12px]"
      style={{
        boxShadow: scrolled ? '0 8px 24px -16px rgba(0,0,0,0.18)' : '0 0 0 rgba(0,0,0,0)',
        transition: 'box-shadow .5s cubic-bezier(.22,1,.36,1)',
      }}
    >
      <div className="mx-auto flex h-[60px] max-w-[1248px] items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center gap-[9px] text-[#0a0a0a]">
          <Logo size={24} variant="compact" className="text-[#011F5B]" />
          <span className="text-[16px] font-bold tracking-[-0.01em]">eviStreams</span>
        </Link>
        <div className="hidden items-center gap-[22px] md:flex">
          <a href="#workflow" className={NAV_LINK}>Workflow</a>
          <a href="#review" className={NAV_LINK}>Product</a>
          <a href={RESEARCH_URL} target="_blank" rel="noopener noreferrer" className={NAV_LINK}>Research</a>
          <a href="#faq" className={NAV_LINK}>FAQ</a>
        </div>
        <div className="flex items-center gap-[6px]">
          <Link
            href="/login"
            className="whitespace-nowrap rounded-[7px] px-3 py-[7px] text-[13px] font-medium text-[#0a0a0a] transition-colors hover:bg-[#f4f4f5]"
          >
            Sign in
          </Link>
          <Link
            href={GET_STARTED_HREF}
            className={`${styles.primaryBtn} whitespace-nowrap rounded-[7px] bg-[#011F5B] px-[14px] py-[7px] text-[13px] font-semibold text-white hover:bg-[#0a2a75]`}
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}
