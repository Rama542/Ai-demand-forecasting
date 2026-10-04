import { Suspense } from "react";

/**
 * Every page that reads query params must sit inside a Suspense boundary, or
 * Next refuses to prerender it. This keeps that wiring in one place instead of
 * repeated per page.
 */
export function SuspenseSlot({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function PageFallback() {
  return (
    <main className="page">
      <div className="stack">
        <span className="skeleton" style={{ display: "block", width: 220, height: 30 }} />
        <span className="skeleton" style={{ display: "block", width: 380, height: 15 }} />
        <div className="metric-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="metric" key={index}>
              <span className="skeleton" style={{ display: "block", width: "55%", height: 10 }} />
              <span className="skeleton" style={{ display: "block", width: "70%", height: 22, marginTop: 8 }} />
            </div>
          ))}
        </div>
        <span className="skeleton" style={{ display: "block", width: "100%", height: 320 }} />
      </div>
    </main>
  );
}