import type { Metadata } from "next";
import "./globals.css";
import { RepoBuildToaster } from "@/components/RepoBuildToaster";

export const metadata: Metadata = {
  title: "SDD — Доска сессий",
  description: "Доска сессий имплементации OpenSpec",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <RepoBuildToaster />
      </body>
    </html>
  );
}