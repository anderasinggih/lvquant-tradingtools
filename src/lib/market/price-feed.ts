import { fetchJupiterPrices } from "./jupiter"
import { TARGET_PAIR, type TokenInfo } from "./tokens"
import type { JupiterPrice, LiveMarketPrice, TokenQuote } from "./types"

/* Assembles the live target-pair price from Jupiter. If a token has no reliable price the API
   omits it; that is surfaced as an error, never filled with a fabricated number (Rules §1). */

/** The upstream returned no usable price for one or more requested mints. */
export class MissingPriceError extends Error {
  readonly mints: string[]
  constructor(mints: string[]) {
    super(`Jupiter Price API returned no usable price for: ${mints.join(", ")}`)
    this.name = "MissingPriceError"
    this.mints = mints
  }
}

function quoteFor(token: TokenInfo, price: JupiterPrice | undefined): TokenQuote | null {
  if (!price || !Number.isFinite(price.usdPrice) || price.usdPrice <= 0) return null
  return {
    mint: token.mint,
    symbol: token.symbol,
    usdPrice: price.usdPrice,
    decimals: price.decimals ?? token.decimals,
    liquidity: price.liquidity,
    priceChange24h: price.priceChange24h,
    blockId: price.blockId,
  }
}

/** Read the current price for a token pair (defaults to SOL/USDC). */
export async function getLiveMarketPrice(customBaseToken?: TokenInfo): Promise<LiveMarketPrice> {
  const base = customBaseToken ?? TARGET_PAIR.base
  const quote = TARGET_PAIR.quote
  const prices = await fetchJupiterPrices([base.mint, quote.mint])

  const baseQuote = quoteFor(base, prices[base.mint])
  const quoteQuote = quoteFor(quote, prices[quote.mint])
  const missing = [baseQuote ? null : base.mint, quoteQuote ? null : quote.mint].filter(
    (m): m is string => m !== null,
  )
  if (!baseQuote || !quoteQuote) throw new MissingPriceError(missing)

  const price = baseQuote.usdPrice / quoteQuote.usdPrice
  return {
    pair: `${base.symbol}/${quote.symbol}`,
    price,
    base: baseQuote,
    quote: quoteQuote,
    change24h: baseQuote.priceChange24h,
    blockId: baseQuote.blockId,
    source: "jupiter",
    fetchedAt: new Date().toISOString(),
  }
}
