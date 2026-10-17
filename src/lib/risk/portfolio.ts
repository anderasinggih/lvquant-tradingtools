import { getLiveMarketPrice } from "@/lib/market/price-feed"
import { TARGET_PAIR, TOKENS } from "@/lib/market/tokens"
import { getSolBalance, getSplTokenBalance } from "@/lib/solana/wallet"

import {
  calculateTradeSize,
  DEFAULT_RISK_SIZING_CONFIG,
  type RiskSizingConfig,
  type TradeSide,
  type TradeSizing,
} from "./sizing"

/* Live portfolio + sizing (Fase 5.1): reads the bot wallet's real SOL and USDC balances from RPC and
   the real SOL/USDC price from Jupiter, then sizes the next trade. Nothing is cached or guessed — a
   missing key or dead RPC throws and the caller reports it (Rules §1). */

export interface WalletPortfolio {
  /** SOL balance in lamports */
  solLamports: bigint
  /** USDC balance in raw (6-decimal) units */
  usdcRaw: bigint
  /** the wallet's USDC associated token account ("" when it does not exist yet) */
  usdcTokenAccount: string
  fetchedAt: string
}

/** Read the bot wallet's real SOL + USDC balances. */
export async function getWalletPortfolio(): Promise<WalletPortfolio> {
  const [sol, usdc] = await Promise.all([
    getSolBalance(),
    getSplTokenBalance(TOKENS.USDC.mint),
  ])
  return {
    solLamports: BigInt(sol.lamports),
    usdcRaw: usdc.amountRaw,
    usdcTokenAccount: usdc.tokenAccount,
    fetchedAt: new Date().toISOString(),
  }
}

export interface SizeNextTradeOptions {
  side: TradeSide
  /** risk config; defaults to the conservative {@link DEFAULT_RISK_SIZING_CONFIG} (2% / 0.05 SOL reserve). */
  config?: RiskSizingConfig
  /** override the live SOL/USD price (otherwise read from Jupiter) */
  baseUsdPrice?: number
  /** override the USDC price (defaults to the live price, or 1 when both overrides are supplied) */
  quoteUsdPrice?: number
}

/** The sized next trade, annotated with the live inputs it was computed from. */
export interface NextTradeSize extends TradeSizing {
  pair: string
  baseUsdPrice: number
  quoteUsdPrice: number
  portfolio: WalletPortfolio
}

/**
 * Read the wallet's real balances + the live SOL/USDC price and size the next trade for `side`.
 * Prices may be overridden (e.g. with a mid the strategy already holds) to avoid a second feed call.
 */
export async function sizeNextTrade(options: SizeNextTradeOptions): Promise<NextTradeSize> {
  const { base, quote } = TARGET_PAIR
  const needsPrice = options.baseUsdPrice === undefined || options.quoteUsdPrice === undefined

  const [portfolio, price] = await Promise.all([
    getWalletPortfolio(),
    needsPrice ? getLiveMarketPrice() : Promise.resolve(null),
  ])

  const baseUsdPrice = options.baseUsdPrice ?? price!.base.usdPrice
  const quoteUsdPrice = options.quoteUsdPrice ?? price!.quote.usdPrice

  const sizing = calculateTradeSize({
    side: options.side,
    base,
    quote,
    baseBalanceRaw: portfolio.solLamports,
    quoteBalanceRaw: portfolio.usdcRaw,
    baseUsdPrice,
    quoteUsdPrice,
    config: options.config ?? DEFAULT_RISK_SIZING_CONFIG,
  })

  return {
    ...sizing,
    pair: TARGET_PAIR.label,
    baseUsdPrice,
    quoteUsdPrice,
    portfolio,
  }
}
