import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teams-to-MoM · AI Meeting Minutes",
  description: "Convert Microsoft Teams transcripts into executive-grade Meeting Minutes using Claude.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {children}
      </body>
    </html>
  );
}
