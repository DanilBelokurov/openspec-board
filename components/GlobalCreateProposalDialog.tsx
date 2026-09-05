"use client";

import { CreateProposalDialog } from "./CreateProposalDialog";
import { useCreateProposal } from "./CreateProposalContext";

/**
 * Global instance of the create-proposal dialog. Mounted once in
 * the root layout so the dialog is available from any page — the
 * board, the detail page, etc. The dialog itself reads its
 * visibility / initial-values from the shared
 * CreateProposalContext, which any client component can drive via
 * `useCreateProposal().open({...})`.
 *
 * TopBar no longer renders the dialog itself — it only triggers
 * `createProposal.open()` for its "Новый proposal" button.
 */
export function GlobalCreateProposalDialog() {
  const createProposal = useCreateProposal();
  return (
    <CreateProposalDialog
      open={createProposal.isOpen}
      initialTitle={createProposal.initial?.title}
      initialDescription={createProposal.initial?.description}
      initialJiraUrl={createProposal.initial?.jiraUrl}
      onClose={() => createProposal.close()}
    />
  );
}