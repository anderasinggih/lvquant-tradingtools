import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedAccountData,
} from "@solana/web3.js"
import bs58 from "bs58"

import { getConnection, getRpcProvider, RPC_COMMITMENT } from "./connection"
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

/** An SPL token holding for one owner: the (single) token account and its decoded balance. */
export interface SplTokenBalance {
  mint: string
  /** the owner's associated token account for the mint ("" when none exists) */
  tokenAccount: string
  amountRaw: bigint
  decimals: number
  /** human amount (amountRaw / 10^decimals) */
  amount: number
}

/**
 * Read an owner's balance for a single SPL mint (`getParsedTokenAccountsByOwner`). When no token
 * account exists the balance is reported as zero — never fabricated. `owner` defaults to the bot
 * wallet. Throws `RpcRequestError` on a persistent RPC failure.
 */
export async function getSplTokenBalance(
  mint: string,
  owner?: PublicKey,
): Promise<SplTokenBalance> {
  const connection = getConnection()
  const provider = getRpcProvider().name
  const ownerKey = owner ?? getWalletPublicKey()
  const mintKey = new PublicKey(mint)

  const { value: accounts } = await withRpcRetry(
    () => connection.getParsedTokenAccountsByOwner(ownerKey, { mint: mintKey }, RPC_COMMITMENT),
    { operation: "getParsedTokenAccountsByOwner", provider },
  )

  let amountRaw = BigInt(0)
  let decimals = 0
  let tokenAccount = ""
  for (const { pubkey, account } of accounts) {
    const info = (account.data as ParsedAccountData).parsed?.info as
      | { tokenAmount?: { amount?: unknown; decimals?: unknown } }
      | undefined
    const raw = info?.tokenAmount?.amount
    if (typeof raw === "string" && /^\d+$/.test(raw)) amountRaw += BigInt(raw)
    if (typeof info?.tokenAmount?.decimals === "number") decimals = info.tokenAmount.decimals
    if (!tokenAccount) tokenAccount = pubkey.toBase58()
  }

  return {
    mint,
    tokenAccount,
    amountRaw,
    decimals,
    amount: decimals > 0 ? Number(amountRaw) / 10 ** decimals : Number(amountRaw),
  }
}
