import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APEX DATA — F1 Telemetry Analytics",
  description: "Compare Formula 1 lap telemetry, timing deltas and driver inputs.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
