export default function ContactPage() {
  return (
    <>
      <div className="mkt-page-hero">
        <span className="mkt-page-label">Contact</span>
        <h1 className="mkt-page-title">Get in <em>touch.</em></h1>
        <p className="mkt-page-lead">
          Questions about eviStreams, research collaborations, or just want to say hello —
          find us through any of these channels.
        </p>
      </div>

      <div className="mkt-content">

        <div className="mkt-section">
          <p className="mkt-section-title">Connect with us</p>
          <p>
            We&rsquo;re based at the Center for Integrative Global Oral Health (CIGOH) at Penn Dental
            Medicine, University of Pennsylvania. The best way to reach us is through LinkedIn or
            by visiting the research center page.
          </p>
          <div className="mkt-social-row">
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
              Research Center
            </a>
          </div>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">For specific enquiries</p>
          <div className="mkt-cards">
            <div className="mkt-card">
              <div className="mkt-card-title">Bug reports</div>
              <div className="mkt-card-body">Found something broken? Reach out via LinkedIn with a description of what happened and what you expected.</div>
            </div>
            <div className="mkt-card">
              <div className="mkt-card-title">Research collaboration</div>
              <div className="mkt-card-body">Interested in using eviStreams for your systematic review or in collaborating with CIGOH? We&rsquo;d love to hear from you.</div>
            </div>
            <div className="mkt-card">
              <div className="mkt-card-title">Security</div>
              <div className="mkt-card-body">To report a security vulnerability, please contact us privately via LinkedIn before any public disclosure.</div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
