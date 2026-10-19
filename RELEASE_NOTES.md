# Public research release — 19 October 2026

The review follow-up isolates browser drafts by account and reviewer role, resets
answers when identity changes, cancels pending saves on logout, and discards
unattributed legacy drafts. Queue draft indicators use the same identity scope.
Audit-history requests now include the project being viewed. Four regression
tests cover restoring, listing, clearing, role/account changes, and legacy drafts.

Based on 11 July 2026 commit `1e068da10ff8b56f3dd6c34ce007374e071c562e`, the
latest available local commit before 25 July 2026, 00:00 UTC. Public Git history
starts fresh.

The release retains the paper's form, plan, pilot, extraction, evidence,
reviewer, adjudication, and export screens with the account, project, permission,
and job interfaces they require. The marketing website, admin/usage screens,
chat, activity browsing, notifications UI, issue reporting, standalone QA and
data cleaning, optional vocabulary management, and unused modules were removed.
Navigation and the entry page were simplified; local demo access goes to login.

The pinned dependency installation, Next.js production build, and TypeScript
checks passed. Historical React hook lint warnings remain. System fonts remove
the build's external font-download dependency. Hosted production configuration,
private Git history, API keys, and user data are not included.

Use the paired public backend. This historical code release is separate from
the current hosted application; live paid extraction and hosted infrastructure
were not exercised during packaging.
