import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDD Sessions Board",
  description: "OpenSpec implementation sessions board",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}