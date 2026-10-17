import { Keypair, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js"
import bs58 from "bs58"

import { getConnection, getRpcProvider } from "./connection"
import { EnvConfigError } from "./errors"
import { withRpcRetry } from "./retry"

/* Wallet layer (PRD §4.1). Non-custodial: the key is read from the local `.env` only, is never
   logged, and is never sent anywhere. Nothing here falls back to fake data — if a value is missing
   or the RPC fails, it throws and the caller reports it. */

/** Whether both wallet env vars are present (does not validate their contents). */
export function isWalletConfigured(): boolean {
  return Boolean(process.env.SOLANA_RPC_URL?.trim() && process.env.SOLANA_PRIVATE_KEY?.trim())
}

/**
 * Decode `SOLANA_PRIVATE_KEY` into a 64-byte secret key.
 * Accepts base58 (Phantom / Solflare / Backpack export) or the JSON byte array `solana-keygen` writes.
 */
function decodeSecretKey(raw: string): Uint8Array {
  const value = raw.trim()
  try {
    const bytes = value.startsWith("[")
      ? Uint8Array.from(JSON.parse(value) as number[])
      : bs58.decode(value)
    if (bytes.length !== 64) {
      throw new Error(`expected 64 bytes, got ${bytes.length}`)
    }
    return bytes
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`SOLANA_PRIVATE_KEY is not a valid base58 key or JSON array: ${detail}`)
  }
}

function readPrivateKey(): string {
  const value = process.env.SOLANA_PRIVATE_KEY?.trim()
  if (!value) throw new EnvConfigError(["SOLANA_PRIVATE_KEY"])
  return value
}

/** Load the bot keypair from `SOLANA_PRIVATE_KEY`. */
export function loadKeypair(): Keypair {
  return Keypair.fromSecretKey(decodeSecretKey(readPrivateKey()))
}

/** The wallet's public key. */
export function getWalletPublicKey(): PublicKey {
  return loadKeypair().publicKey
}

export interface SolBalance {
  /** base58 address the balance belongs to */
  address: string
  /** balance in lamports */
  lamports: number
  /** balance in SOL */
  sol: number
}

/**
 * Read the wallet's real SOL balance from the configured RPC (with retry on transient failures).
 * Throws `EnvConfigError` when configuration is missing, or `RpcRequestError` when the RPC fails.
 */
export async function getSolBalance(): Promise<SolBalance> {
  const connection = getConnection()
  const provider = getRpcProvider().name
  const publicKey = getWalletPublicKey()
  const lamports = await withRpcRetry(
    () => connection.getBalance(publicKey, "confirmed"),
    { operation: "getBalance", provider },
  )
  return { address: publicKey.toBase58(), lamports, sol: lamports / LAMPORTS_PER_SOL }
}
