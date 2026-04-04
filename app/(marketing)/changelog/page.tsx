export default function ChangelogPage() {
  return (
    <>
      <div className="mkt-page-hero">
        <span className="mkt-page-label">Changelog</span>
        <h1 className="mkt-page-title">What&rsquo;s <em>new.</em></h1>
        <p className="mkt-page-lead">
          Every release, every improvement. We ship continuously — here&rsquo;s what&rsquo;s landed.
        </p>
      </div>

      <div className="mkt-content">
        <div className="mkt-changelog">

          <div className="mkt-cl-entry">
            <div className="mkt-cl-meta">
              <div className="mkt-cl-version">v1.1</div>
              <div className="mkt-cl-date">Mar 2026</div>
              <span className="mkt-cl-tag feature">Feature</span>
            </div>
            <div className="mkt-cl-body">
              <h3>Consensus review overhaul &amp; draft auto-save</h3>
              <p>
                A major upgrade to the consensus workflow, plus quality-of-life improvements throughout
                the manual extraction experience.
              </p>
              <ul className="mkt-cl-list">
                <li>Unified field card design — agreed, single-source, and disputed fields all handled in one view</li>
                <li>Smart conflict counting — single-source fields no longer show as false conflicts</li>
                <li>Raw JSON values in agreed fields now display as clean readable strings</li>
                <li>Dynamic header updates as you resolve conflicts in real time</li>
                <li>Draft auto-save in manual extraction — your work survives page refreshes</li>
                <li>Fixed shared-state bug in subform fields (rob domain ratings now independent)</li>
                <li>AI-assisted mode prefills empty fields without overwriting your manual entries</li>
                <li>Keyboard shortcuts for Save (⌘S) and Save &amp; Next (⌘↵)</li>
              </ul>
            </div>
          </div>

          <div className="mkt-cl-entry">
            <div className="mkt-cl-meta">
              <div className="mkt-cl-version">v1.0</div>
              <div className="mkt-cl-date">Jan 2026</div>
              <span className="mkt-cl-tag launch">Launch</span>
            </div>
            <div className="mkt-cl-body">
              <h3>Initial release — end-to-end extraction platform</h3>
              <p>
                The first public release of eviStreams, built at Penn Dental Medicine&rsquo;s Center for
                Integrative Global Oral Health. Everything needed to run a systematic review extraction
                from upload to structured export.
              </p>
              <ul className="mkt-cl-list">
                <li><strong>Form Builder</strong> — define custom extraction schemas with typed fields, enums, and nested subforms</li>
                <li><strong>AI Extraction Pipeline</strong> — automated code generation and execution against uploaded PDFs</li>
                <li><strong>Manual Extraction</strong> — side-by-side PDF viewer with structured form filling</li>
                <li><strong>Consensus Review</strong> — compare AI and two human reviewers field by field, resolve conflicts</li>
                <li><strong>Document Management</strong> — upload and organize research paper PDFs by project</li>
                <li><strong>Live Pipeline Logs</strong> — real-time job monitoring with step-level status</li>
                <li><strong>Multi-project workspace</strong> — keep systematic reviews isolated and organized</li>
                <li><strong>Structured export</strong> — JSON and CSV output from extraction results</li>
                <li><strong>AI Chat (beta)</strong> — ask questions about your document corpus</li>
                <li><strong>QA tools</strong> — validate extraction quality before finalizing</li>
                <li><strong>Activity log</strong> — full audit trail of changes across the platform</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
