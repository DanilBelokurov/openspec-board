import type { Metadata } from "next";
import "./globals.css";
import { RepoBuildToaster } from "@/components/RepoBuildToaster";
import { CreateProposalProvider } from "@/components/CreateProposalContext";
import { GlobalCreateProposalDialog } from "@/components/GlobalCreateProposalDialog";

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
        <CreateProposalProvider>
          {children}
          <RepoBuildToaster />
          <GlobalCreateProposalDialog />
        </CreateProposalProvider>
      </body>
    </html>
  );
}