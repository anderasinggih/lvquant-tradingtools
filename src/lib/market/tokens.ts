/* The tokens the dashboard tracks. Mints are canonical Solana mainnet addresses.
   Includes Solana core assets, top DeFi protocols, and leading meme tokens:
   SOL, BONK, WIF, POPCAT, PNUT, GOAT, MOODENG, BOME, MEW, JUP, RAY, DRIFT, PYTH, JTO, RENDER. */

export interface TokenInfo {
  mint: string
  symbol: string
  name: string
  decimals: number
  binanceSymbol?: string
  color?: string
}

export const TOKENS = {
  SOL: {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    binanceSymbol: "SOLUSDC",
    color: "#9945ff",
  },
  BONK: {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "Bonk",
    decimals: 5,
    binanceSymbol: "BONKUSDT",
    color: "#f89e2c",
  },
  WIF: {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    symbol: "WIF",
    name: "dogwifhat",
    decimals: 6,
    binanceSymbol: "WIFUSDT",
    color: "#e88b64",
  },
  POPCAT: {
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    symbol: "POPCAT",
    name: "Popcat",
    decimals: 9,
    color: "#e54d2e",
  },
  PNUT: {
    mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
    symbol: "PNUT",
    name: "Peanut the Squirrel",
    decimals: 6,
    color: "#f59e0b",
  },
  GOAT: {
    mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump",
    symbol: "GOAT",
    name: "Goatseus Maximus",
    decimals: 6,
    color: "#a855f7",
  },
  MOODENG: {
    mint: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY",
    symbol: "MOODENG",
    name: "Moo Deng",
    decimals: 6,
    color: "#ec4899",
  },
  BOME: {
    mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
    symbol: "BOME",
    name: "BOOK OF MEME",
    decimals: 6,
    binanceSymbol: "BOMEUSDT",
    color: "#22c55e",
  },
  MEW: {
    mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
    symbol: "MEW",
    name: "cat in a dogs world",
    decimals: 5,
    color: "#f43f5e",
  },
  JUP: {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    binanceSymbol: "JUPUSDT",
    color: "#2bd67b",
  },
  RAY: {
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    symbol: "RAY",
    name: "Raydium",
    decimals: 6,
    binanceSymbol: "RAYUSDT",
    color: "#307cf8",
  },
  DRIFT: {
    mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7",
    symbol: "DRIFT",
    name: "Drift",
    decimals: 6,
    binanceSymbol: "DRIFTUSDT",
    color: "#8b5cf6",
  },
  PYTH: {
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    symbol: "PYTH",
    name: "Pyth Network",
    decimals: 6,
    binanceSymbol: "PYTHUSDT",
    color: "#e11d48",
  },
  JTO: {
    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    symbol: "JTO",
    name: "Jito",
    decimals: 9,
    binanceSymbol: "JTOUSDT",
    color: "#10b981",
  },
  RENDER: {
    mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
    symbol: "RENDER",
    name: "Render Token",
    decimals: 8,
    binanceSymbol: "RENDERUSDT",
    color: "#ef4444",
  },
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    color: "#2775ca",
  },
} as const satisfies Record<string, TokenInfo>

export type TokenKey = keyof typeof TOKENS

/** Default trading pair watched by the bot */
export const TARGET_PAIR: { base: TokenInfo; quote: TokenInfo; label: string } = {
  base: TOKENS.SOL,
  quote: TOKENS.USDC,
  label: "SOL/USDC",
}

export const TRACKED_TOKENS: TokenInfo[] = [
  TOKENS.SOL,
  TOKENS.BONK,
  TOKENS.WIF,
  TOKENS.POPCAT,
  TOKENS.PNUT,
  TOKENS.GOAT,
  TOKENS.MOODENG,
  TOKENS.BOME,
  TOKENS.MEW,
  TOKENS.JUP,
  TOKENS.RAY,
  TOKENS.DRIFT,
  TOKENS.PYTH,
  TOKENS.JTO,
  TOKENS.RENDER,
]
