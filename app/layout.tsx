import type { Metadata } from "next";
import "./globals.css";

const TITLE = "SafeShift — safety ratings for AI agents";
const DESCRIPTION =
  "The pre-deployment crash test for AI agents. Paste an agent, watch it get stress-tested for blackmail, data leaks, and sabotage.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "SafeShift",
  authors: [{ name: "TANUJA CHURENDRA" }],
  creator: "TANUJA CHURENDRA",
  publisher: "TANUJA CHURENDRA",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "SafeShift",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
