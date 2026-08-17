import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RiverLine SDD",
  description:
    "Field tool for local floodplain officials to record flood damage and compute the FEMA 50% substantial-damage ratio.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Field tool is used one-handed outdoors; user-controlled zoom stays on.
  themeColor: "#0b1b2b",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
