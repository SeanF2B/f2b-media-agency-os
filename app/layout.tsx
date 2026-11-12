import type { Metadata } from "next";

import "./globals.css";
import "./f2b-brand-accessible.css";
import "./ai-history.css";

export const metadata: Metadata = {
  title: "F2B Media Agency OS",
  description: "A private operations workspace for clients, projects, time and agency profitability.",
  manifest: "/manifest-v5.webmanifest",
  appleWebApp: {
    capable: true,
    title: "F2B Agency",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      { url: "/f2b-apple-touch-icon-v5.png?v=20261022-3", sizes: "180x180", type: "image/png" },
    ],
    icon: [
      { url: "/favicon.ico?v=20261022-2", sizes: "32x32", type: "image/x-icon" },
    ],
    shortcut: "/favicon.ico?v=20261022-2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<script src="/f2b-client-switcher.js" defer /></body>
    </html>
  );
}
