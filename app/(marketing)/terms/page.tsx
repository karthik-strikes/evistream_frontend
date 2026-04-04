export default function TermsPage() {
  return (
    <>
      <div className="mkt-page-hero">
        <span className="mkt-page-label">Terms</span>
        <h1 className="mkt-page-title">Terms of <em>service.</em></h1>
        <p className="mkt-page-lead">
          Full terms of service are being drafted. Here&rsquo;s the baseline while we work on it.
        </p>
      </div>

      <div className="mkt-content">

        <div className="mkt-section">
          <p className="mkt-section-title">Usage</p>
          <p>
            eviStreams is provided for academic and research use by teams conducting systematic reviews
            and evidence synthesis. By using the platform, you agree to use it only for lawful purposes
            and in ways that do not infringe on the rights of others.
          </p>
          <p>
            You are responsible for the content you upload. Do not upload documents you do not have
            the right to process, and do not upload personally identifiable patient data unless you
            have appropriate consent and compliance measures in place.
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Your data</p>
          <p>
            You retain ownership of all documents you upload and all extraction results you produce.
            We do not claim any rights over your research content. You may export or delete your data
            at any time.
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Availability</p>
          <p>
            eviStreams is currently in active development. We make no guarantees of uptime or continued
            availability of specific features. We will do our best to notify users of breaking changes
            or planned downtime.
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Contact</p>
          <p>
            For questions about these terms, please{' '}
            <a
              href="https://www.linkedin.com/company/center-for-integrative-global-oral-health/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-link mkt-link-ext"
            >
              contact us via LinkedIn
            </a>
            . Comprehensive terms of service will be published here when the platform moves to broader release.
          </p>
        </div>

      </div>
    </>
  );
}
