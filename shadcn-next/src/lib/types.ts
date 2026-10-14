import type { PhoneId } from "@/lib/phones";

export type Borrower = {
  id: string;
  name: string;
  organization: string;
  createdAt: string;
};

export type LoanInfo = { borrowerId: string; borrowedAt: string };
export type ReturnInfo = { borrowerId: string; returnedAt: string };

export type PhoneState = {
  id: PhoneId;
  status: "available" | "borrowed";
  currentLoan?: LoanInfo;
  lastReturn?: ReturnInfo;
};

export type PhoneStateMap = Record<PhoneId, PhoneState>;

export type AppState = {
  borrowers: Borrower[];
  phones: PhoneStateMap;
  bannerMessages: string[];
  serverTime: string;
};
