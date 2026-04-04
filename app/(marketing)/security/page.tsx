export default function SecurityPage() {
  return (
    <>
      <div className="mkt-page-hero">
        <span className="mkt-page-label">Security</span>
        <h1 className="mkt-page-title">Your research data<br />stays <em>yours.</em></h1>
        <p className="mkt-page-lead">
          eviStreams is built on infrastructure you can trust. Here&rsquo;s exactly how we protect
          your documents, extraction data, and team credentials.
        </p>
      </div>

      <div className="mkt-content">

        <div className="mkt-section">
          <p className="mkt-section-title">Infrastructure</p>
          <div className="mkt-security-grid">
            <div className="mkt-security-item">

              <div className="mkt-security-item-title">AWS Hosted</div>
              <div className="mkt-security-item-body">All services run on Amazon Web Services infrastructure in US regions, benefiting from AWS&rsquo;s physical and network security.</div>
            </div>
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">TLS Everywhere</div>
              <div className="mkt-security-item-body">All data in transit is encrypted using TLS 1.2+. We enforce HTTPS across every endpoint — no plaintext communication.</div>
            </div>
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">Encrypted at Rest</div>
              <div className="mkt-security-item-body">Documents and extraction data are stored with encryption at rest. Database backups are encrypted automatically.</div>
            </div>
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">Secure Object Storage</div>
              <div className="mkt-security-item-body">PDF documents are stored in isolated object storage with time-limited pre-signed URLs. Files are never exposed via public permanent links.</div>
            </div>
          </div>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Authentication &amp; access control</p>
          <div className="mkt-security-grid">
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">Supabase Auth</div>
              <div className="mkt-security-item-body">Authentication is handled by Supabase Auth, which provides secure email/password login, session management, and JWT-based access tokens.</div>
            </div>
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">Project Isolation</div>
              <div className="mkt-security-item-body">Data is scoped strictly by project. Users only see documents, forms, and results within projects they belong to — there is no cross-project data access.</div>
            </div>
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">Row-Level Security</div>
              <div className="mkt-security-item-body">PostgreSQL row-level security policies enforce access rules at the database layer — not just the application layer. A misconfiguration can&rsquo;t expose your data.</div>
            </div>
            <div className="mkt-security-item">
              <div className="mkt-security-item-title">No Stored Credentials</div>
              <div className="mkt-security-item-body">We never store raw passwords. Authentication tokens are short-lived and rotated automatically. API keys used by the extraction pipeline are scoped and auditable.</div>
            </div>
          </div>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Data handling</p>
          <p>
            Your uploaded documents and extracted data are used solely to power the features you
            explicitly invoke — extraction pipelines, manual review, consensus reconciliation, and export.
            We do not use your research content to train models or share it with third parties.
          </p>
          <p>
            AI extraction pipelines send document content to large language model APIs (e.g. OpenAI) for
            processing. This is scoped to the specific extraction job you initiate. If your research
            involves sensitive patient data, review your data handling obligations before uploading
            identifiable information.
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Questions or concerns</p>
          <p>
            If you have specific security questions, want to report a vulnerability, or need a security
            review before using eviStreams with sensitive data, please{' '}
            <a
              href="https://www.linkedin.com/company/center-for-integrative-global-oral-health/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-link mkt-link-ext"
            >
              reach out via LinkedIn
            </a>
            {' '}or visit our{' '}
            <a href="/contact" className="mkt-link">contact page</a>.
          </p>
        </div>

      </div>
    </>
  );
}
