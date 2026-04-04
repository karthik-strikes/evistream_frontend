export default function PrivacyPage() {
  return (
    <>
      <div className="mkt-page-hero">
        <span className="mkt-page-label">Privacy</span>
        <h1 className="mkt-page-title">Privacy <em>policy.</em></h1>
        <p className="mkt-page-lead">
          A full privacy policy is in progress. In the meantime, here&rsquo;s what matters most.
        </p>
      </div>

      <div className="mkt-content">

        <div className="mkt-section">
          <p className="mkt-section-title">The short version</p>
          <p>
            eviStreams is a research tool built at Penn Dental Medicine. We collect only the data
            necessary to run the platform — account credentials, uploaded documents, and extraction
            results. We do not sell your data, share it with advertisers, or use your research content
            for any purpose beyond what you explicitly request.
          </p>
          <p>
            Documents you upload are stored securely and accessible only within your project. Extraction
            results belong to you and can be exported or deleted at any time.
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">What we collect</p>
          <div className="mkt-section">
            <h3>Account information</h3>
            <p>Your email address and hashed password (managed by Supabase Auth). We do not store raw passwords.</p>
            <h3>Uploaded documents</h3>
            <p>PDFs you upload for extraction are stored in encrypted object storage. They are used solely to run extraction jobs you initiate.</p>
            <h3>Extraction data</h3>
            <p>Form structures, extraction results, and reviewer annotations you create within the platform.</p>
            <h3>Usage logs</h3>
            <p>Basic activity logs (job runs, page loads) for debugging and improving the platform. We do not build behavioral profiles.</p>
          </div>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">AI processing</p>
          <p>
            When you run an AI extraction job, document content is sent to third-party large language model
            APIs to perform extraction. This is limited to the specific job you trigger and governed by the
            respective provider&rsquo;s data policies. Do not upload documents containing identifiable
            patient data without ensuring compliance with applicable regulations (HIPAA, GDPR, etc.).
          </p>
        </div>

        <div className="mkt-section">
          <p className="mkt-section-title">Questions</p>
          <p>
            For questions about your data or to request deletion of your account and associated data,
            please{' '}
            <a
              href="https://www.linkedin.com/company/center-for-integrative-global-oral-health/"
              target="_blank"
              rel="noopener noreferrer"
              className="mkt-link mkt-link-ext"
            >
              contact us via LinkedIn
            </a>
            . A comprehensive privacy policy will be published here when the platform moves to broader release.
          </p>
        </div>

      </div>
    </>
  );
}
