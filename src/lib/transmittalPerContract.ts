import type { TransmittalContract } from "./jobInfo";
import { normalizeTransmittalNumber } from "./transmittalNumber";
import type { TransmittalData } from "../types/tradeDocuments";

const CONTRACT_KEYS: TransmittalContract[] = ["paint", "wallcovering", "frp", "track"];

export function parseTransmittalNumbers(
  raw: unknown,
): Partial<Record<TransmittalContract, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<TransmittalContract, string>> = {};
  for (const key of CONTRACT_KEYS) {
    const value = o[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = normalizeTransmittalNumber(value);
    }
  }
  return out;
}

export function resolveTransmittalNumberForContract(
  data: Pick<TransmittalData, "transmittal_number" | "transmittal_numbers" | "contract">,
  contract: TransmittalContract,
): string {
  const fromMap = data.transmittal_numbers?.[contract];
  if (fromMap) return normalizeTransmittalNumber(fromMap);
  const hasAnyStored =
    data.transmittal_numbers && Object.keys(data.transmittal_numbers).length > 0;
  if (!hasAnyStored || contract === "paint") {
    return normalizeTransmittalNumber(data.transmittal_number);
  }
  return "TR-001";
}

/** Migrate legacy single `transmittal_number` and sync active contract field on read. */
export function normalizeTransmittalNumbersOnRead(
  raw: Partial<TransmittalData>,
  contract: TransmittalContract,
): Pick<TransmittalData, "transmittal_number" | "transmittal_numbers"> {
  let transmittal_numbers = parseTransmittalNumbers(raw.transmittal_numbers);
  const legacy = normalizeTransmittalNumber(raw.transmittal_number);
  if (!transmittal_numbers.paint && legacy) {
    transmittal_numbers = { ...transmittal_numbers, paint: legacy };
  }
  const transmittal_number = resolveTransmittalNumberForContract(
    { transmittal_number: legacy, transmittal_numbers, contract },
    contract,
  );
  return { transmittal_number, transmittal_numbers };
}

/** Persist the active contract tab's transmittal # into `transmittal_numbers`. */
export function mergeActiveTransmittalNumber(draft: TransmittalData): TransmittalData {
  const num = normalizeTransmittalNumber(draft.transmittal_number);
  return {
    ...draft,
    transmittal_number: num,
    transmittal_numbers: {
      ...draft.transmittal_numbers,
      [draft.contract]: num,
    },
  };
}

export function applyTransmittalContractNumber(
  draft: TransmittalData,
  contract: TransmittalContract,
): TransmittalData {
  return {
    ...draft,
    contract,
    transmittal_number: resolveTransmittalNumberForContract(draft, contract),
  };
}

export function bumpTransmittalNumberForContract(
  draft: TransmittalData,
  nextNumber: string,
): TransmittalData {
  const merged = mergeActiveTransmittalNumber(draft);
  const num = normalizeTransmittalNumber(nextNumber);
  return {
    ...merged,
    transmittal_number: num,
    transmittal_numbers: {
      ...merged.transmittal_numbers,
      [merged.contract]: num,
    },
  };
}
