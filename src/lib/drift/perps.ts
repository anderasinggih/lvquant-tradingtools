import {
  DriftClient,
  initialize,
  type DriftEnv,
  OrderType,
  PositionDirection,
  convertToNumber,
  QUOTE_PRECISION,
  BASE_PRECISION,
  type IWallet,
} from "@drift-labs/sdk"

import { getConnection } from "@/lib/solana/connection"
import { loadKeypair } from "@/lib/solana/wallet"

/* Drift Protocol Perp client (Solana Perpetual Futures & Leverage Engine).
   Non-custodial: uses the same local SOLANA_PRIVATE_KEY and Helius RPC connection.
   Enables opening LONG (profit when price rises) and SHORT (profit when price drops)
   with up to 20x leverage on SOL-PERP and other Solana perpetual markets. */

let cachedDriftClient: DriftClient | null = null

export async function getDriftClient(): Promise<DriftClient> {
  if (cachedDriftClient) return cachedDriftClient

  // Typecast connection and wallet to avoid duplicate @solana/web3.js type identity mismatch in sub-dependencies
  const connection = getConnection() as unknown
  const keypair = loadKeypair()

  const wallet: IWallet = {
    publicKey: keypair.publicKey as unknown as IWallet["publicKey"],
    signTransaction: async (tx: unknown) => {
      if (tx && typeof tx === "object" && "version" in tx) {
        ;(tx as unknown as { sign: (signers: unknown[]) => void }).sign([keypair])
      } else if (tx && typeof tx === "object" && "partialSign" in tx) {
        ;(tx as unknown as { partialSign: (signers: unknown[]) => void }).partialSign([keypair])
      }
      return tx as any
    },
    signAllTransactions: async (txs: unknown[]) => {
      for (const tx of txs) {
        if (tx && typeof tx === "object" && "version" in tx) {
          ;(tx as unknown as { sign: (signers: unknown[]) => void }).sign([keypair])
        } else if (tx && typeof tx === "object" && "partialSign" in tx) {
          ;(tx as unknown as { partialSign: (signers: unknown[]) => void }).partialSign([keypair])
        }
      }
      return txs as any
    },
  }

  const env: DriftEnv = "mainnet-beta"
  initialize({ env })

  const driftClient = new DriftClient({
    connection: connection as any,
    wallet,
    env,
    activeSubAccountId: 0,
  })

  await driftClient.subscribe()
  cachedDriftClient = driftClient
  return driftClient
}

export interface OpenPerpPositionParams {
  marketIndex?: number // 0 = SOL-PERP
  direction: "LONG" | "SHORT"
  amountSol: number
  orderType?: "MARKET" | "LIMIT"
  priceUsd?: number
  leverage?: number
}

/** Open a leveraged perpetual position (LONG or SHORT) on Drift */
export async function openPerpPosition(params: OpenPerpPositionParams): Promise<{
  txSignature: string
  direction: string
  amountSol: number
  marketIndex: number
}> {
  const driftClient = await getDriftClient()
  const marketIndex = params.marketIndex ?? 0 // SOL-PERP default

  // Check if Drift User Account exists
  const user = driftClient.getUser()
  const userExists = await user.exists()
  if (!userExists) {
    throw new Error(
      "Drift user account not initialized for this wallet. Please deposit initial margin (USDC or SOL) into Drift first."
    )
  }

  const direction =
    params.direction === "LONG" ? PositionDirection.LONG : PositionDirection.SHORT

  const baseAssetAmount = driftClient.convertToPerpPrecision(params.amountSol)

  const txSignature = await driftClient.placePerpOrder({
    orderType: OrderType.MARKET,
    marketIndex,
    direction,
    baseAssetAmount,
  })

  return {
    txSignature,
    direction: params.direction,
    amountSol: params.amountSol,
    marketIndex,
  }
}

/** Get active perpetual positions on Drift */
export async function getActiveDriftPositions(): Promise<
  Array<{
    marketIndex: number
    marketName: string
    direction: "LONG" | "SHORT"
    baseAmount: number
    quoteAmountUsd: number
    unrealizedPnlUsd: number
  }>
> {
  const driftClient = await getDriftClient()
  const user = driftClient.getUser()
  const userExists = await user.exists()
  if (!userExists) return []

  const activePositions: Array<{
    marketIndex: number
    marketName: string
    direction: "LONG" | "SHORT"
    baseAmount: number
    quoteAmountUsd: number
    unrealizedPnlUsd: number
  }> = []

  const perpPositions = user.getActivePerpPositions()
  for (const pos of perpPositions) {
    const baseAmount = convertToNumber(pos.baseAssetAmount, BASE_PRECISION)
    if (baseAmount !== 0) {
      const quoteAmountUsd = convertToNumber(pos.quoteAssetAmount, QUOTE_PRECISION)
      const pnlBn = user.getUnrealizedPNL(false, pos.marketIndex)
      const unrealizedPnlUsd = convertToNumber(pnlBn, QUOTE_PRECISION)

      activePositions.push({
        marketIndex: pos.marketIndex,
        marketName: pos.marketIndex === 0 ? "SOL-PERP" : `PERP-${pos.marketIndex}`,
        direction: baseAmount > 0 ? "LONG" : "SHORT",
        baseAmount: Math.abs(baseAmount),
        quoteAmountUsd: Math.abs(quoteAmountUsd),
        unrealizedPnlUsd,
      })
    }
  }

  return activePositions
}
