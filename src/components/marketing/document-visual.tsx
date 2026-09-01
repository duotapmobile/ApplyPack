import { Check, FileText, Search } from "lucide-react";

export function DocumentVisual() {
  return (
    <div className="document-visual" aria-label="Illustration of job matches, a resume, and a cover letter">
      <div className="job-card-preview">
        <div className="preview-icon"><Search aria-hidden="true" size={19} /></div>
        <p className="preview-label">MATCH 04</p>
        <h2>Client Onboarding Coordinator</h2>
        <p>Remote in the United States</p>
        <ul>
          <li><Check aria-hidden="true" size={15} /> Training</li>
          <li><Check aria-hidden="true" size={15} /> Documentation</li>
          <li><Check aria-hidden="true" size={15} /> Progress tracking</li>
        </ul>
      </div>
      <div className="paper paper--resume">
        <span className="paper-kicker">TAILORED RESUME</span>
        <strong>Experience made clear</strong>
        <span className="paper-line paper-line--long" />
        <span className="paper-line" />
        <span className="paper-line paper-line--mid" />
        <span className="paper-section">RELEVANT EXPERIENCE</span>
        <span className="paper-line paper-line--long" />
        <span className="paper-line paper-line--mid" />
      </div>
      <div className="paper paper--letter">
        <FileText aria-hidden="true" size={20} />
        <span className="paper-kicker">COVER LETTER</span>
        <strong>Written for this employer</strong>
        <span className="paper-line paper-line--long" />
        <span className="paper-line paper-line--long" />
        <span className="paper-line" />
      </div>
      <div className="delivery-chip"><Check aria-hidden="true" size={18} /> Ready within 24 hours</div>
    </div>
  );
}
