// Outlined Lead Factory icon in the same line style as the other nav icons, still animated:
// smoke rises from the chimney and leads roll along the belt.
export function LeadFactoryOutlineIcon({ className = "" }: { className?: string }) {
  return <svg className={`lf-outline ${className}`} viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle className="lf-smoke lf-smoke-1" cx="18.5" cy="5.2" r="1.2" />
    <circle className="lf-smoke lf-smoke-2" cx="18.5" cy="5.2" r="1" />
    <path d="M3 21V12.5l4.5-2.8v2.8l4.5-2.8v2.8l4.5-2.8V7h3.5v14" />
    <path d="M2 21h20" />
    <path className="lf-belt" d="M5.5 17.5h11" />
    <circle className="lf-lead lf-lead-1" cx="6" cy="15.2" r=".9" />
    <circle className="lf-lead lf-lead-2" cx="6" cy="15.2" r=".9" />
  </svg>;
}
