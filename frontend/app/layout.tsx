import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "TopicTube",
  description: "X and YouTube discussion insight mapper",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
