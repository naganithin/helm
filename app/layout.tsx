import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// One UI typeface; a monospace face only for big headline numbers and addresses. Self-hosted, no layout shift.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Helm · AI-managed portfolios on NEAR",
  description: "Describe a portfolio in plain English. Helm projects it with Monte Carlo on real prices and runs a stop-loss agent for it.",
};

// Sets the palette (and its tone) before first paint. It sits in <body>, not <head>: wallet extensions (Meteor)
// inject scripts into <head>, which made React's hydration see a different element there.
const THEME = "try{var p=localStorage.getItem('helm:palette')||'harbor',t={harbor:'dark',chalk:'light',cream:'light',sand:'dark'},e=document.documentElement;if(!t[p])p='harbor';e.dataset.palette=p;e.dataset.theme=t[p]}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-palette="harbor" data-theme="dark" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME }} suppressHydrationWarning />
        {children}
      </body>
    </html>
  );
}