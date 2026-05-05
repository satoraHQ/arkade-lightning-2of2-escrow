import type {
  FundingStatus,
  RegisterEscrowResponse,
} from '@arkade-peach-escrow-poc/shared';

export type SellerStep = 'wallet' | 'create' | 'fund' | 'release';

export interface SellerSession {
  step: SellerStep;
  offerId: string | null;
  /** The amount the seller offered, captured at create-offer time. */
  sellAmountSats: number | null;
  escrow: RegisterEscrowResponse | null;
  funding: FundingStatus | null;
  /** Set after the cooperative release ark-tx finalises. */
  arkTxid: string | null;
  /** Active Lendaswap LN→Arkade swap id, kept across page refreshes. */
  lnSwapId: string | null;
  /** BOLT11 invoice for the active swap, so the seller can re-display it. */
  lnInvoice: string | null;
}

export const EMPTY_SESSION: SellerSession = {
  step: 'wallet',
  offerId: null,
  sellAmountSats: null,
  escrow: null,
  funding: null,
  arkTxid: null,
  lnSwapId: null,
  lnInvoice: null,
};

const STORAGE_KEY = 'peach-poc-seller:session';

const VALID_STEPS = new Set<SellerStep>(['wallet', 'create', 'fund', 'release']);

export function loadSession(): SellerSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SellerSession>;
    if (!parsed.step) return null;
    const session: SellerSession = { ...EMPTY_SESSION, ...parsed };
    // Migrate sessions saved under an older step set (e.g. 'register'
    // existed before create+register were collapsed). Pick the first
    // valid step we have data for, falling back to 'wallet'.
    if (!VALID_STEPS.has(session.step)) {
      if (session.escrow) session.step = 'fund';
      else if (session.offerId) session.step = 'create';
      else session.step = 'wallet';
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session: SellerSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage full or disabled — silently drop persistence
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
