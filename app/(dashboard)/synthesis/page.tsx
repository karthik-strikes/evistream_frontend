'use client';

/**
 * Synthesis — meta-analysis and structured synthesis, as a server-backed
 * workspace (design_handoff_synthesis v5; SPEC.md is the authority).
 *
 *   First visit → protocol (source forms + mapping, analysis defaults,
 *   planned analyses, roles) → Dashboard → New synthesis → Workspace
 *   (Target · Evidence · Harmonization · Pooling decision · Analysis ·
 *   Diagnostics · Results · History; SWiM swaps Analysis/Diagnostics for
 *   Structured synthesis).
 *
 * Screens are URL-backed (`?screen=&id=&tab=&form=&run=`), so a reload lands
 * where the reviewer was and Back undoes a move. Until the protocol is
 * confirmed, everything but the protocol and mapping screens is the Welcome
 * checklist. Human decisions create state; the engine creates numbers; nothing
 * is kept in localStorage.
 */

import { Suspense } from 'react';
import { FolderOpen } from 'lucide-react';

import { DashboardLayout } from '@/components/layout';
import { EmptyState, Spinner } from '@/components/ui';
import { useProject } from '@/contexts/ProjectContext';

import { DashboardScreen } from './_components/screens/DashboardScreen';
import { MappingScreen } from './_components/screens/MappingScreen';
import { NewSynthesisScreen } from './_components/screens/NewSynthesisScreen';
import { ProtocolScreen } from './_components/screens/ProtocolScreen';
import { WelcomeScreen } from './_components/screens/WelcomeScreen';
import { Workspace } from './_components/workspace/Workspace';
import { SYNTH_SCREENS, useSynthesisNav, type SynthScreen } from './_lib/nav';
import { SynthesisProvider, useSynthesis } from './_lib/useSynthesisData';

function Screens() {
  const syn = useSynthesis();
  const { get } = useSynthesisNav();
  const param = get('screen') as SynthScreen;
  const requested: SynthScreen | null = SYNTH_SCREENS.includes(param) ? param : null;

  const screen: SynthScreen = !syn.protocolConfirmed
    ? (requested === 'protocol' || requested === 'mapping' ? requested : 'welcome')
    : requested && requested !== 'welcome' ? requested : 'dashboard';

  if (syn.loading) {
    return <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>;
  }

  switch (screen) {
    case 'welcome': return <WelcomeScreen />;
    case 'protocol': return <ProtocolScreen />;
    case 'mapping': return <MappingScreen />;
    case 'new': return <NewSynthesisScreen />;
    case 'workspace': return <Workspace />;
    default: return <DashboardScreen />;
  }
}

function SynthesisPageInner() {
  const { selectedProject } = useProject();
  if (!selectedProject) {
    return (
      <DashboardLayout title="Synthesis">
        <EmptyState icon={FolderOpen} title="No project selected"
          description="Choose a project to synthesize its extracted results." />
      </DashboardLayout>
    );
  }
  return (
    <SynthesisProvider>
      <DashboardLayout title="Synthesis" description="Pool agreed results, or synthesize them without pooling">
        <Screens />
      </DashboardLayout>
    </SynthesisProvider>
  );
}

/** `useSearchParams` only exists in the browser, so Next.js needs a fallback to prerender. */
export default function SynthesisPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout title="Synthesis">
          <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>
        </DashboardLayout>
      }
    >
      <SynthesisPageInner />
    </Suspense>
  );
}
