/* The tokens the dashboard tracks. Mints are canonical Solana mainnet addresses. */

export interface TokenInfo {
  mint: string
  symbol: string
  name: string
  decimals: number
}

export const TOKENS = {
  SOL: {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
  },
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
} as const satisfies Record<string, TokenInfo>

export type TokenKey = keyof typeof TOKENS

/** The pair the price engine watches first (PRD §3: aset utama SOL/USDC). */
export const TARGET_PAIR: { base: TokenInfo; quote: TokenInfo; label: string } = {
  base: TOKENS.SOL,
  quote: TOKENS.USDC,
  label: "SOL/USDC",
}
