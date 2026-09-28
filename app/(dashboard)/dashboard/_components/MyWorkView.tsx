'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { HomeEnvelope, HomeExtractionTask, HomeWork, Workflow } from '@/types/home';
import { ContinueWide } from './ContinueCard';
import { Pill, QuietLink, SeatBadge, SectionError, SkeletonRows, SmallLinkButton, Swatch, SEAT_NAME, type HomeTone } from './ui';

type Q = { data?: HomeEnvelope<HomeWork>; isLoading: boolean; isError: boolean; refetch: () => void };

function Group({ wf, title, count, link, children }: {
  wf: Workflow; title: string; count: string; link: { href: string; label: string }; children: ReactNode;
}) {
  const id = `mw-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 px-4 py-3.5 dark:border-[#1f1f1f]">
        <Swatch wf={wf} />
        <h2 id={id} className="m-0 text-[16px] font-semibold leading-6 text-[#0a0a0a] dark:text-zinc-100">{title}</h2>
        <span className="text-[13px] text-gray-500 dark:text-zinc-400">{count}</span>
        <QuietLink href={link.href} className="ml-auto">{link.label}</QuietLink>
      </div>
      <div role="region" aria-labelledby={id} tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">{children}</table>
      </div>
    </section>
  );
}

function Head({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((c, i) => (
          <th key={i} scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500 dark:text-zinc-500">{c}</th>
        ))}
      </tr>
    </thead>
  );
}

const td = 'border-t border-gray-100 px-4 py-2.5 dark:border-[#1f1f1f]';

function extractionState(t: HomeExtractionTask): { tone: HomeTone; label: string } {
  if (t.forms_total > 0 && t.forms_saved >= t.forms_total) return { tone: 'amber', label: 'Not yet finished' };
  if (Object.values(t.form_states).some(s => s !== 'todo')) return { tone: 'blue', label: 'In progress' };
  return { tone: 'gray', label: 'Pending' };
}

export function MyWorkView({ q, readOnly, onShowOverview }: { q: Q; readOnly: boolean; onShowOverview: () => void }) {
  if (q.isLoading) {
    return <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]"><SkeletonRows rows={5} /></div>;
  }
  if (q.isError) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1f1f1f] dark:bg-[#111111]">
        <SectionError what="your assignments" onRetry={q.refetch} />
      </div>
    );
  }
  const w = q.data?.status === 'ready' ? q.data.data : null;
  if (!w) return null;

  const ext = w.extraction.filter(t => t.status !== 'completed' && t.status !== 'skipped');
  const extStates = ext.map(extractionState);
  const inProg = extStates.filter(s => s.label !== 'Pending').length;
  const pending = extStates.length - inProg;
  const readyCons = w.consensus.filter(c => c.state === 'ready').length;
  const empty = !ext.length && !w.consensus.length && !w.rob.length && !w.synthesis.length;

  if (empty) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#111111]">
        <p className="m-0 text-[14px] font-medium text-[#0a0a0a] dark:text-zinc-100">No assignments in this project.</p>
        <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-zinc-400">
          Nothing is allocated to you here. Project-wide progress is on the{' '}
          <button type="button" onClick={onShowOverview} className="border-0 bg-transparent p-0 font-medium text-[#0a0a0a] underline underline-offset-2 dark:text-zinc-100">Project overview</button>.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ContinueWide q={q} readOnly={readOnly} />

      {ext.length > 0 && (
        <Group wf="forms" title="Extraction assignments" count={`${inProg} in progress · ${pending} pending`}
          link={{ href: '/manual-extraction', label: `Open queue · ${ext.length}` }}>
          <Head cols={['Document', 'Your role', 'Forms saved', 'State', '']} />
          <tbody>
            {ext.map((t, i) => {
              const st = extStates[i];
              const form = t.next_form_id ?? w.forms[0]?.form_id;
              return (
                <tr key={t.assignment_id}>
                  <td className={`${td} font-medium text-[#0a0a0a] dark:text-zinc-100`}>{t.document_label}</td>
                  <td className={td}><span className="inline-flex items-center gap-2 text-gray-600 dark:text-zinc-400"><SeatBadge seat={t.role} />{SEAT_NAME[t.role]}</span></td>
                  <td className={`${td} tabular-nums text-gray-600 dark:text-zinc-400`}>{t.forms_saved} / {t.forms_total}</td>
                  <td className={td}><Pill tone={st.tone}>{st.label}</Pill>{!t.ready && <span className="ml-2 text-[12px] text-gray-500">Not ready to open</span>}</td>
                  <td className={`${td} text-right`}>
                    {t.ready && form && !readOnly && (
                      <SmallLinkButton href={`/manual-extraction?form=${encodeURIComponent(form)}&doc=${encodeURIComponent(t.document_id)}`}>Open</SmallLinkButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Group>
      )}

      {w.consensus.length > 0 && (
        <Group wf="consensus" title="Extraction consensus" count={`${readyCons} ready · ${w.consensus.length - readyCons} waiting`}
          link={{ href: '/consensus', label: `Open queue · ${w.consensus.length}` }}>
          <Head cols={['Document', 'Form', 'Readers', 'State', '']} />
          <tbody>
            {w.consensus.map(c => (
              <tr key={`${c.document_id}:${c.form_id}`}>
                <td className={`${td} font-medium text-[#0a0a0a] dark:text-zinc-100`}>{c.document_label}</td>
                <td className={`${td} text-gray-600 dark:text-zinc-400`}>{c.form_name}</td>
                <td className={`${td} text-gray-600 dark:text-zinc-400`}>{c.readers}</td>
                <td className={td}>{c.state === 'ready' ? <Pill tone="green">Ready</Pill> : <Pill tone="slate">Waiting</Pill>}</td>
                <td className={`${td} text-right`}>
                  {c.state === 'ready' && !readOnly && (
                    <SmallLinkButton href={`/consensus?form=${encodeURIComponent(c.form_id)}&doc=${encodeURIComponent(c.document_id)}`}>Review</SmallLinkButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Group>
      )}

      {w.rob.length > 0 && (
        <Group wf="neutral" title="Risk-of-bias work" count={`${w.rob.length} assessment${w.rob.length === 1 ? '' : 's'}`}
          link={{ href: '/risk-of-bias?screen=dashboard', label: 'Open assessments' }}>
          <Head cols={['Study · target', 'Protocol seat', 'Domains', 'State', '']} />
          <tbody>
            {w.rob.map(r => {
              const st: { tone: HomeTone; label: string } = r.state === 'progress'
                ? { tone: 'blue', label: 'Preliminary saved' }
                : r.state === 'consensus_needed' ? { tone: 'slate', label: 'Consensus needed' } : { tone: 'gray', label: 'Not started' };
              return (
                <tr key={`${r.seat}:${r.document_id}:${r.target_id}`}>
                  <td className={td}>
                    <span className="font-medium text-[#0a0a0a] dark:text-zinc-100">{r.study_label}</span>
                    <span className="text-gray-500 dark:text-zinc-400"> · {r.target_label}</span>
                  </td>
                  <td className={td}><span className="inline-flex items-center gap-2 text-gray-600 dark:text-zinc-400"><SeatBadge seat={r.seat} />{SEAT_NAME[r.seat]}</span></td>
                  <td className={`${td} tabular-nums text-gray-600 dark:text-zinc-400`}>{r.domains_judged} / {r.domains_total}</td>
                  <td className={td}><Pill tone={st.tone}>{st.label}</Pill></td>
                  <td className={`${td} text-right`}>
                    {!readOnly && (
                      <SmallLinkButton href={`/risk-of-bias?screen=workspace&study=${encodeURIComponent(r.document_id)}&target=${encodeURIComponent(r.target_id)}`}>Open</SmallLinkButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Group>
      )}

      {w.synthesis.length > 0 && (
        <Group wf="consensus" title="Synthesis approvals" count={`${w.synthesis.length} awaiting you`}
          link={{ href: '/synthesis', label: 'Open syntheses' }}>
          <Head cols={['Synthesis', 'Version', 'Required from you', 'State', '']} />
          <tbody>
            {w.synthesis.map(s => (
              <tr key={s.group_id}>
                <td className={`${td} font-medium text-[#0a0a0a] dark:text-zinc-100`}>{s.title}</td>
                <td className={`${td} text-gray-600 dark:text-zinc-400`}>v{s.version}</td>
                <td className={`${td} text-gray-600 dark:text-zinc-400`}>{s.required}</td>
                <td className={td}><Pill tone="blue">Awaiting approval</Pill></td>
                <td className={`${td} text-right`}>
                  {!readOnly && <SmallLinkButton href={`/synthesis?screen=workspace&id=${encodeURIComponent(s.group_id)}&tab=results`} primary>Approve</SmallLinkButton>}
                </td>
              </tr>
            ))}
          </tbody>
        </Group>
      )}

      {w.responsibilities.length > 0 && (
        <p className="m-0 text-[12px] text-gray-400 dark:text-zinc-500">
          Your responsibilities in this project: {w.responsibilities.join(' · ')}. Counts are your own assignments; project-wide totals are on Project overview.
        </p>
      )}
    </div>
  );
}
