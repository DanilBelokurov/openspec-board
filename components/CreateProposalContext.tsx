"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CreateProposalInitial {
  title: string;
  description: string;
  jiraUrl: string;
}

interface CreateProposalContextValue {
  isOpen: boolean;
  initial: CreateProposalInitial | null;
  open: (initial?: Partial<CreateProposalInitial>) => void;
  close: () => void;
}

const CreateProposalContext = createContext<CreateProposalContextValue>({
  isOpen: false,
  initial: null,
  open: () => {},
  close: () => {},
});

export function CreateProposalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initial, setInitial] = useState<CreateProposalInitial | null>(null);

  const open = useCallback((next?: Partial<CreateProposalInitial>) => {
    setInitial(
      next
        ? {
            title: next.title ?? "",
            description: next.description ?? "",
            jiraUrl: next.jiraUrl ?? "",
          }
        : null,
    );
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({ isOpen, initial, open, close }),
    [isOpen, initial, open, close],
  );

  return (
    <CreateProposalContext.Provider value={value}>
      {children}
    </CreateProposalContext.Provider>
  );
}

export function useCreateProposal(): CreateProposalContextValue {
  return useContext(CreateProposalContext);
}