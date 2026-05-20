import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teams-to-MoM · AI Meeting Minutes · Deloitte",
  description: "Convert Microsoft Teams transcripts into executive-grade Meeting Minutes using Claude.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=Libre+Franklin:wght@300;400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
