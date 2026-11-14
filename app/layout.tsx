import type { Metadata, Viewport } from "next";
import "./globals.css";

// Relative asset paths: the static build runs from any folder or URL (phone home-screen app, artifact link, file server).
const base = process.env.GITHUB_PAGES === "true" ? "/IB" : process.env.STATIC_EXPORT === "1" ? "." : "";

// No pinch/double-tap zoom: two-thumb play on a phone must not zoom the page.
export const viewport: Viewport = { themeColor: "#101e28", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export const metadata: Metadata = {
  manifest: `${base}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "EVADER", statusBarStyle: "black-translucent" },
  title: "EVADER",
  description: "EVADER Alpine Extreme: a 3D snowboarding game with rigid-body snow physics, freestyle tricks, three mountains and replays.",
  icons: {
    icon: `${base}/favicon.svg`,
    shortcut: `${base}/favicon.svg`,
    apple: `${base}/icon-192.png`,
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
