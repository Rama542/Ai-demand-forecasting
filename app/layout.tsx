import type { Metadata, Viewport } from "next";
import { brandScript, DEFAULT_HUE } from "@/components/Appearance";
import { ToastProvider } from "@/components/ui/Toast";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: {
    default: "MarketMind AI — Indian equity research workspace",
    template: "%s — MarketMind AI",
  },
  description:
    "Quantitative research for Indian equities: backtesting, regime diagnosis, scenario analysis, portfolio diagnostics and explainable forecasts. Every figure is computed from your own data.",
  applicationName: "MarketMind AI",
  openGraph: {
    title: "MarketMind AI",
    description:
      "Explainable quantitative research for Indian equities. Backtest strategies, diagnose market regime and see exactly what drives each forecast.",
    type: "website",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
};

/**
 * SLATE runs on Geist for text and IBM Plex Mono for every figure. They are
 * loaded exactly as the theme stylesheet expects, so the families named in
 * --tp-font-* resolve to the real faces rather than a system fallback.
 */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="slate" style={{ ["--tp-h" as string]: String(DEFAULT_HUE) }} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
        <script dangerouslySetInnerHTML={{ __html: brandScript }} />
      </head>
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
