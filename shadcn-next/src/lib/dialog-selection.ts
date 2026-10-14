import type { Borrower, PhoneState } from "@/lib/types";

export type PhoneDialogMode = "borrow" | "manage";

/** Selection a phone dialog starts with: first borrower (borrow) or the current borrower (manage). */
export const defaultBorrowerId = (
  mode: PhoneDialogMode | null,
  phoneState: PhoneState | null,
  borrowers: Borrower[]
): string | null => {
  if (!mode || !phoneState) return null;
  if (mode === "manage") return phoneState.currentLoan?.borrowerId ?? null;
  return borrowers[0]?.id ?? null;
};

/**
 * Keeps the user's choice across data refreshes; only falls back to the
 * default when the chosen borrower no longer exists (or nothing is chosen).
 */
export const resolveSelectedBorrowerId = (
  selected: string | null,
  mode: PhoneDialogMode | null,
  phoneState: PhoneState | null,
  borrowers: Borrower[]
): string | null => {
  if (selected && borrowers.some((borrower) => borrower.id === selected)) {
    return selected;
  }
  return defaultBorrowerId(mode, phoneState, borrowers);
};
