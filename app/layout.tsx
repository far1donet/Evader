import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.GITHUB_PAGES === "true" ? "/IB" : "";

export const viewport: Viewport = { themeColor: "#101e28", width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "EVADER", statusBarStyle: "black-translucent" },
  title: "EVADER — Ride the mountain",
  description: "Drop into EVADER: a playable 3D snowboarding prototype with mountain courses, freestyle tricks, rider customization and replays.",
  icons: {
    icon: `${basePath}/favicon.svg`,
    shortcut: `${basePath}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
