'use client';

/**
 * Risk of bias — RoB 2, following the review-protocol workflow.
 *
 *   First visit → Review protocol (sources, mapping, scope, effect, reviewers,
 *   study designs) → Study dashboard (Assessments, Summary) → New assessment
 *   (pick the target) → Workspace (Preliminary → Domains 1–5 → Overall).
 *   Review summary (`?screen=report`) is the whole project's figures and exports.
 *
 * Decisions made once for the whole review live on the protocol
 * (`rob_protocols`); reviewers only pick the target. Screens are URL-backed
 * (`?screen=`) so a reload lands where the reviewer was and Back undoes a move.
 *
 * Three rules carried over from the result-registry page:
 *  - the target is a RESULT (or, at outcome scope, one outcome) — never a paper;
 *  - D1 is answered once per study and read by every assessment of it;
 *  - the algorithm SUGGESTS each judgement (`rob2.ts`); the reviewer decides,
 *    and a judgement that differs from the suggestion needs a written reason.
 */

import { Suspense, useEffect } from 'react';
import { FolderOpen } from 'lucide-react';

import { DashboardLayout } from '@/components/layout';
import { EmptyState, Spinner } from '@/components/ui';
import { useProject } from '@/contexts/ProjectContext';

import { ComparisonsScreen } from './_components/ComparisonsScreen';
import { ConsensusScreen } from './_components/ConsensusScreen';
import { MappingScreen } from './_components/MappingScreen';
import { NewAssessment } from './_components/NewAssessment';
import { ProtocolScreen } from './_components/ProtocolScreen';
import { ReviewSummary } from './_components/ReviewSummary';
import { StudyDashboard } from './_components/StudyDashboard';
import { WelcomeScreen } from './_components/WelcomeScreen';
import { Workspace } from './_components/Workspace';
import { ROB_SCREENS, useRobNav, type RobScreen } from './_components/robUi';
import { scopeOf } from './_components/dashboardModel';
import { RobProvider, useRob } from './_lib/useRobData';

function Screens() {
  const rob = useRob();
  const { get, go } = useRobNav();
  const param = get('screen') as RobScreen;
  const requested: RobScreen | null = ROB_SCREENS.includes(param) ? param : null;

  // Until the protocol is set, everything but the protocol and mapping screens
  // is the first-visit checklist — assessing against an unset protocol would
  // stamp assessments with choices nobody made.
  const screen: RobScreen = !rob.protocolSet
    ? (requested === 'protocol' || requested === 'mapping' ? requested : 'welcome')
    : requested && requested !== 'welcome' ? requested : 'dashboard';

  // A dashboard with no study chosen opens the first one.
  const study = get('study');
  useEffect(() => {
    if (rob.loading) return;
    if ((screen === 'dashboard' || screen === 'new') && !study && rob.studies[0]) {
      go({ study: rob.studies[0].id }, { replace: true });
    }
  }, [rob.loading, screen, study, rob.studies, go]);

  if (rob.loading) {
    return <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>;
  }

  switch (screen) {
    case 'welcome': return <WelcomeScreen />;
    case 'protocol': return <ProtocolScreen />;
    case 'mapping': return <MappingScreen />;
    case 'new': return <NewAssessment />;
    // The old in-workspace consensus mode now lives on its own screen.
    case 'workspace': return get('as') === 'consensus' ? <ConsensusScreen /> : <Workspace />;
    // Comparisons only exist at result scope; at outcome scope nothing waits on one.
    case 'comparisons': return scopeOf(rob) === 'result' ? <ComparisonsScreen /> : <StudyDashboard />;
    case 'consensus': return <ConsensusScreen />;
    case 'report': return <ReviewSummary />;
    default: return <StudyDashboard />;
  }
}

function RiskOfBiasPageInner() {
  const { selectedProject } = useProject();
  if (!selectedProject) {
    return (
      <DashboardLayout title="Risk of Bias">
        <EmptyState icon={FolderOpen} title="No project selected"
          description="Choose a project to assess its studies for risk of bias." />
      </DashboardLayout>
    );
  }
  return (
    <RobProvider>
      <DashboardLayout
        title="Risk of Bias"
        description="Assess bias per result with the tool configured for each study design"
      >
        <Screens />
      </DashboardLayout>
    </RobProvider>
  );
}

/**
 * `useSearchParams` only exists in the browser, so Next.js needs a fallback to
 * prerender this route.
 */
export default function RiskOfBiasPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout title="Risk of Bias">
          <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>
        </DashboardLayout>
      }
    >
      <RiskOfBiasPageInner />
    </Suspense>
  );
}
