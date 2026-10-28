import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";

export const metadata: Metadata = {
  title: {
    default: "LeadGun · Lead Intelligence",
    template: "%s · LeadGun",
  },
  description: "AI-powered lead discovery, enrichment, and outreach.",
};

export const viewport: Viewport = {
  themeColor: "#07090e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -right-40 -top-56 h-[620px] w-[620px] rounded-full bg-primary/10 blur-[140px]" />
          <div className="absolute -bottom-64 -left-32 h-[520px] w-[520px] rounded-full bg-secondary/6 blur-[140px]" />
          <div className="signal-grid absolute inset-0 opacity-60" />
        </div>
        <div className="relative z-10 flex min-h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1 lg:pl-[276px]">{children}</main>
        </div>
        <MobileNav />
      </body>
    </html>
  );
}
