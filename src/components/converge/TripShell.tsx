import type { ReactNode } from "react";

export function TripShell({ children, navigation, narrow = false }: { children: ReactNode; navigation?: ReactNode; narrow?: boolean }) {
  return <main className={`converge${narrow ? " converge-narrow" : ""}`}>
    <nav className="app-nav" aria-label="Main navigation">
      <a className="wordmark" href="/" aria-label="Converge home">
        <svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="3" y="3" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="2" /><rect x="12" y="12" width="17" height="17" rx="5" fill="currentColor" /><path d="m17 21 3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Converge
      </a>
      <div className="nav-actions">{navigation || <a href="/">Plan a trip</a>}</div>
    </nav>
    {children}
  </main>;
}

export function TripHeading({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <header className="trip-heading"><div><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{children}</header>;
}
