import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CrewGuard", template: "%s · CrewGuard" },
  description: "Regulatory compliance validation and violation explanation for airline crew rosters",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
