'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import styles from './landing.module.css';
import { crimsonPro, jetbrainsMono } from './fonts';
import { useReducedMotion } from './motion';
import { LandingNav } from './LandingNav';
import { Hero } from './Hero';
import { WorkflowRail } from './WorkflowRail';
import { ReviewSection } from './ReviewSection';
import { RobSection } from './RobSection';
import { SynthesisSection } from './SynthesisSection';
import { TeamSection } from './TeamSection';
import { IoSection } from './IoSection';
import { FaqSection } from './FaqSection';
import { LandingFooter } from './LandingFooter';

export function LandingPage() {
  const rm = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const initialDarkRef = useRef<boolean | null>(null);

  // The landing page is light-only. Same behaviour as the previous page:
  // remember whether the app was dark, strip the class while here (including
  // whenever ThemeContext re-applies it), and restore it on the way out.
  useEffect(() => {
    initialDarkRef.current = document.documentElement.classList.contains('dark');
    return () => {
      if (initialDarkRef.current) document.documentElement.classList.add('dark');
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, [resolvedTheme]);

  return (
    <div className={`${styles.root} ${crimsonPro.variable} ${jetbrainsMono.variable}`}>
      <LandingNav />
      <Hero rm={rm} />
      <WorkflowRail rm={rm} />
      <ReviewSection rm={rm} />
      <RobSection rm={rm} />
      <SynthesisSection rm={rm} />
      <TeamSection rm={rm} />
      <IoSection rm={rm} />
      <FaqSection rm={rm} />
      <LandingFooter />
    </div>
  );
}
