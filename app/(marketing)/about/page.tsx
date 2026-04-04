export default function AboutPage() {
  return (
    <>
      <div className="mkt-page-hero">
        <span className="mkt-page-label">About</span>
        <h1 className="mkt-page-title">Built by researchers,<br />for <em>researchers.</em></h1>
        <p className="mkt-page-lead">
          eviStreams was created at the University of Pennsylvania to solve a real problem:
          extracting structured data from hundreds of research papers is slow, error-prone, and expensive.
          We built the tool we wished existed.
        </p>
      </div>

      <div className="mkt-content">

        <div className="mkt-section">
          <p className="mkt-section-title">The origin</p>
          <p>
            Systematic reviews are the gold standard for evidence-based medicine — but the data extraction
            phase is brutal. A single review can require a team of researchers to manually read and annotate
            hundreds of papers, field by field, with every decision subject to inter-rater review.
          </p>
          <p>
            eviStreams started as an internal tool at the{' '}
            <a
              href="https://www.dental.upenn.edu/research/center-for-integrative-global-oral-health/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-link mkt-link-ext"
            >
              Center for Integrative Global Oral Health
            </a>{' '}
            (CIGOH) at Penn Dental Medicine, University of Pennsylvania. The team needed a way to accelerate
            evidence synthesis for global oral health research — and existing tools didn&rsquo;t cut it.
          </p>
          <p>
            What began as a workflow experiment grew into a full platform: AI-generated extraction pipelines,
            human review, consensus reconciliation, and structured export — end to end.
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">What we believe</p>
          <div className="mkt-cards">
            <div className="mkt-card">
              <div className="mkt-card-title">Rigor shouldn&rsquo;t be slow</div>
              <div className="mkt-card-body">Automation should serve scientific rigor, not replace it. We keep humans in the loop at every step that matters.</div>
            </div>
            <div className="mkt-card">
              <div className="mkt-card-title">Consensus is the ground truth</div>
              <div className="mkt-card-body">When AI and multiple reviewers disagree, the reconciliation process is where the real work happens. We built a tool for exactly that.</div>
            </div>
            <div className="mkt-card">
              <div className="mkt-card-title">Data quality is the product</div>
              <div className="mkt-card-body">Structured, source-grounded extraction data that you can trust downstream. Every field traceable to its source.</div>
            </div>
          </div>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">The research center</p>
          <p>
            CIGOH at Penn Dental Medicine focuses on integrative approaches to global oral health research,
            with an emphasis on evidence synthesis, systematic reviews, and clinical research methodology.
            eviStreams is one of several tools developed to support high-quality evidence production.
          </p>
          <div className="mkt-social-row">
            <a
              href="https://www.dental.upenn.edu/research/center-for-integrative-global-oral-health/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-social-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              Penn Dental Medicine
            </a>
            <a
              href="https://www.linkedin.com/company/center-for-integrative-global-oral-health/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-social-btn"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
                <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
              </svg>
              LinkedIn
            </a>
            <a
              href="https://www.instagram.com/pdmcigoh/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-social-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
              </svg>
              Instagram
            </a>
          </div>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Get started</p>
          <p>
            eviStreams is currently available for research teams. If you&rsquo;re running systematic reviews
            and want to dramatically reduce extraction time without sacrificing quality,{' '}
            <a href="/register" className="mkt-link">create an account</a> or{' '}
            <a href="/contact" className="mkt-link">reach out to us</a>.
          </p>
        </div>

      </div>
    </>
  );
}
