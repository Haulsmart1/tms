// A code-native illustration of supported records, never a live customer view.
export default function ProductBoard({ compact = false }: { compact?: boolean }) {
  return <figure className={`product-board${compact ? " product-board-compact" : ""}`}>
    <figcaption className="board-caption"><span>TMS Wizard / Workflow view</span><span>Illustrative example data</span></figcaption>
    <div className="board-body">
      <div className="board-sidebar" aria-hidden="true"><b>TW</b><span className="board-active">Jobs</span><span>Planning</span><span>POD</span><span>Invoicing</span></div>
      <div className="board-content">
        <div className="board-title"><div><p className="brand-eyebrow">THE TRANSPORT OFFICE</p><h2>Keep the job together.</h2></div><span className="board-label">Job record</span></div>
        <div className="board-job"><span className="board-reference">EXAMPLE-001</span><strong>Collection to delivery</strong><span>Vehicle &amp; driver assigned</span></div>
        <ol className="board-route"><li><span className="route-marker"/><div><small>COLLECTION</small><strong>Birmingham depot</strong><span>Load details &amp; instructions</span></div></li><li><span className="route-marker route-marker-end"/><div><small>DELIVERY</small><strong>Manchester delivery point</strong><span>Recipient &amp; delivery evidence</span></div></li></ol>
        <div className="board-handover"><div><span className="board-check" aria-hidden="true">✓</span><strong>Proof of delivery</strong><small>Photos · Notes · Documents</small></div><div><span className="board-check" aria-hidden="true">→</span><strong>Customer invoice</strong><small>Charges · Payments · Statements</small></div></div>
      </div>
    </div>
    <p className="board-footnote">A workflow illustration, not a screenshot or live operational record.</p>
  </figure>;
}
