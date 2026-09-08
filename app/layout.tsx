import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "MarketMind AI", description: "AI powered market intelligence" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
