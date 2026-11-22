// Stripe's standard US card fee (2.9% + 30¢). Added for the team, it's sized so that after Stripe takes its fee from
// the whole payment, the organization still gets the full price. (No database here: the Payments card uses it too.)
export const CARD_PERCENT = 2.9;
export const CARD_CENTS = 30;
export const cardFee = (cents: number) =>
  cents <= 0 ? 0 : Math.ceil((cents + CARD_CENTS) / (1 - CARD_PERCENT / 100)) - cents;
