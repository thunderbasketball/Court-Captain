import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BRAND_SCRIPT } from "@/lib/brand-script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CourtCaptain",
  description: "CourtCaptain: Thunder Basketball and Scenic City Basketball teams, practices, rosters and leagues",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning // the brand script below marks it before the app loads
    >
      <head>
        {/* The loading screen's logo (app/Splash.tsx), set once as the page arrives. */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
