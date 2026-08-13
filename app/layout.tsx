import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "euV2 data — F1 Telemetry Analytics",
  description: "Compare Formula 1 lap telemetry, timing deltas, driver inputs and corner performance.",
  icons: {
    icon: "/apex/assets/euv2-mark.png",
    shortcut: "/apex/assets/euv2-mark.png",
    apple: "/apex/assets/euv2-mark.png",
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
