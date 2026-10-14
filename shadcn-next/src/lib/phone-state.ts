import { PHONES, type PhoneId } from "@/lib/phones";
import type { PhoneState, PhoneStateMap } from "@/lib/types";

export const createDefaultPhoneStates = (): PhoneStateMap => {
  const map = {} as PhoneStateMap;
  for (const phone of PHONES) {
    map[phone.id] = { id: phone.id, status: "available" };
  }
  return map;
};

export const sanitizePhoneStates = (raw: unknown): PhoneStateMap => {
  const defaults = createDefaultPhoneStates();
  if (!raw || typeof raw !== "object") return defaults;
  const parsed = raw as Record<string, Partial<PhoneState>>;
  for (const phone of PHONES) {
    const value = parsed[phone.id];
    if (value) {
      defaults[phone.id] = {
        id: phone.id,
        status: value.status === "borrowed" ? "borrowed" : "available",
        currentLoan: value.currentLoan?.borrowerId
          ? {
              borrowerId: value.currentLoan.borrowerId,
              borrowedAt:
                value.currentLoan.borrowedAt ?? new Date().toISOString(),
            }
          : undefined,
        lastReturn: value.lastReturn?.borrowerId
          ? {
              borrowerId: value.lastReturn.borrowerId,
              returnedAt:
                value.lastReturn.returnedAt ?? new Date().toISOString(),
            }
          : undefined,
      };
    }
  }
  return defaults;
};

export const ensurePhoneState = (map: PhoneStateMap, phoneId: PhoneId) =>
  map[phoneId] ?? { id: phoneId, status: "available" };
