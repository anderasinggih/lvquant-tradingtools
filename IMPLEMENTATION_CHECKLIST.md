# IMPLEMENTATION CHECKLIST — LVQUANT BOT & DASHBOARD

Checklist ini adalah panduan kerja langkah-demi-langkah yang akan dieksekusi secara berurutan dan disiplin oleh **Opencode (Big Pickle)**.
Setiap langkah wajib diverifikasi selesai dan lulus uji sebelum melangkah ke poin berikutnya.

---

## FASE 1: Project Setup & Fondasi UI (SSYCH Components Vault)
- [x] **1.1 Inisialisasi Project Web App**
  - Setup Next.js (App Router, TypeScript, Tailwind CSS) di workspace LVQUANT.
  - Setup konfigurasi Tailwind CSS (`tailwind.config.ts`, `globals.css`) dengan CSS variables warna token finansial (`--chart-up`, `--chart-down`, `--control-fill`, dll.).
- [x] **1.2 Ekstraksi Helper & Kontrol Dasar dari `SSYCH_COMPONENTS_VAULT.md`**
  - Ekstrak utility `cn()` (`lib/utils.ts`).
  - Ekstrak `control-classes.ts` (`THUMB`, `TRACK`, `BUTTON`, `FIELD`, `ICON_BUTTON`).
  - Ekstrak `components/ui/segmented-control.tsx`.
- [x] **1.3 Ekstraksi Komponen Visual Finansial dari `SSYCH_COMPONENTS_VAULT.md`**
  - Ekstrak `components/ui/live-figure.tsx` (rolling animated number untuk saldo & PnL).
  - Ekstrak `components/ui/chart-overlay.tsx` (AxisTag & magnetic crosshair helper).
  - Ekstrak `components/ui/price-scrubber.tsx` (interactive chart dengan crosshair & scrubbing).
  - Ekstrak komponen pendukung lain dari vault (`market-snapshot.tsx`, `index-card.tsx`).
- [x] **1.4 Assembly Dashboard UI (Tanpa Data Dummy)**
  - Susun layout dashboard utama: Header (Live Balance & Wallet info), Main Panel (Price Scrubber), Control Panel (Risk & Bot Parameters), Table Panel (Active Positions & Trade History).
  - Status awal saat belum terkoneksi feed riil: Tampilkan indikator `Awaiting Real-Time Feed / Disconnected` (Sesuai Aturan: ZERO DUMMY).

---

## FASE 2: Solana Wallet & Connection Layer (Non-Custodial)
- [x] **2.1 Wallet Management Module (Backend/Server Engine)**
  - Setup script `lib/solana/wallet.ts` untuk memuat Keypair Solana dari `.env` lokal (`SOLANA_PRIVATE_KEY`).
  - Validasi pembacaan alamat publik (Public Key) dan fungsi get SOL balance riil via RPC.
  - Setup endpoint API internal (`/api/wallet/balance`) untuk mengirimkan saldo riil ke frontend.
- [x] **2.2 RPC Connection & Provider Setup**
  - Setup koneksi RPC Solana (`@solana/web3.js`) dengan opsi RPC publik / Helius / Quicknode.
  - Setup handler retry & error handling transparan saat RPC drop atau rate limit.

---

## FASE 3: Real Market Data Feed & Price Engine
- [x] **3.1 Live Price Feed Integration**
  - Hubungkan endpoint feed harga riil (Jupiter Price API v2 / DexScreener API) untuk pair target (cth: SOL/USDC).
  - Setup polling / WebSocket interval untuk streaming harga real-time ke komponen `LiveFigure` dan `PriceScrubber`.
- [x] **3.2 Historical Candlestick / Series Generator**
  - Ambil data series harga historis riil (bukan angka acak) untuk timeframe (1D, 1W, 1M) agar chart menampilkan grafik pergerakan pasar yang sebenarnya.
  - Sumber: Binance public Klines (keyless, gratis) via `/api/market/history`; tanpa API key.

---

## FASE 4: Jupiter DEX Execution Engine
- [x] **4.1 Integrasi Jupiter Quote API**
  - Implementasi fungsi `getQuote(inputMint, outputMint, amount, slippageBps)` ke `https://api.jup.ag/swap/v1/quote`.
  - Logika verifikasi rute terbaik dan kalkulasi estimasi price impact.
  - `src/lib/jupiter/quote.ts` (`QuoteError`, normalisasi amount/slippage, ringkasan rute, `bestRoute` vs `mostReliableAmmsQuoteReport`, `priceImpactPct`/`priceImpactPercent`); route verifikasi `GET /api/jupiter/quote` (keyless; `JUPITER_API_KEY` opsional).
- [x] **4.2 Integrasi Jupiter Swap Transaction Builder**
  - Implementasi request serialized `VersionedTransaction` dari Jupiter Swap API.
  - Implementasi fungsi sign transaksi secara lokal menggunakan private key wallet bot.
  - `src/lib/jupiter/swap.ts` (`SwapBuildError`, `fetchSwapTransaction` → `POST /swap/v1/swap`, `deserializeSwapTransaction`, `signSwapTransaction` yang menolak fee payer ≠ wallet, `serializeSwapTransaction(Base64)`, `buildSignedSwapTransaction` one-shot pakai `loadKeypair()`); tipe swap di `src/lib/jupiter/types.ts`. Terverifikasi dgn keypair ephemeral: tx 686 byte ter-deserialize & tersign lokal (1/1 signature, fee payer = wallet).
- [x] **4.3 Priority Fees & Execution Submitter**
  - Tambahkan micro-tip Compute Budget (Priority Fee) agar transaksi cepat dikonfirmasi validator.
  - Pengiriman transaksi ke jaringan Solana via `sendRawTransaction` dengan konfirmasi `confirmed`.
  - Ekstraksi TX Hash Solscan untuk bukti audit on-chain.
  - `src/lib/solana/priority-fee.ts` (`estimatePriorityFee` — sampling `getRecentPrioritizationFees` per locked writable account, percentile → lamports, clamp `MAX_PRIORITY_FEE_LAMPORTS`; helper murni `percentile`/`unitPriceToLamports`). Env opsional `PRIORITY_FEE_PERCENTILE` (75) & `MAX_PRIORITY_FEE_LAMPORTS` (100000).
  - `src/lib/solana/submit.ts` (`submitSignedTransaction` — `sendRawTransaction` + `confirmTransaction` strategi blockhash/lastValidBlockHeight pada commitment `confirmed`; `TransactionSubmitError` + `classifySubmitError` utk blockhash expired / slippage (custom 6001) / insufficient funds / simulation failed; log diambil via `getLogs()`).
  - `src/lib/solana/explorer.ts` (parser URL Solscan `getSolscanTxUrl`/`solscanAddressUrl`, deteksi cluster dari RPC).
  - `src/lib/jupiter/execute.ts` (`executeSwap` + `writableAccountsForQuote` — menyatukan estimasi tip → build+sign → submit → receipt Solscan).
  - Terverifikasi live (RPC mainnet publik, keypair ephemeral tanpa dana): tip riil p75 = 2778 lamports, akun writable diturunkan dari rute, submit ditolak validator & terklasifikasi transparan `simulation_failed` tanpa mengirim dana.

---

## FASE 5: Risk Management & Circuit Breaker Engine
- [x] **5.1 Sizing Calculator**
  - Kalkulasi ukuran trade berdasarkan persentase saldo riil (maksimal 2–5% per trade).
  - `src/lib/risk/sizing.ts` (`calculateTradeSize` murni + `RiskSizingConfig`, `DEFAULT_RISK_SIZING_CONFIG` 2%/0.05 SOL; jaga % di 2–5 (lempar jika di luar), cap ke equity×pct, reserve SOL `DEFAULT_SOL_RESERVE_LAMPORTS` tak tersentuh; hasil `ok/reason` (`insufficient_sol_for_gas`/`no_balance`/`zero_size`) + `limitedBy` (`position_pct`/`balance`/`reserve`); helper presisi `rawToAmount`/`amountToRaw`/`usdToTokenRaw`).
  - `src/lib/risk/portfolio.ts` (`getWalletPortfolio` baca saldo riil SOL+USDC; `sizeNextTrade(side, config?)` gabungkan harga SOL/USDC live Jupiter → ukuran trade).
  - `src/lib/solana/wallet.ts` + `getSplTokenBalance(mint, owner?)` (baca saldo SPL via `getParsedTokenAccountsByOwner`).
  - Terverifikasi: 7 skenario (sell/buy 2%/5%, proteksi reserve 0.06→0.01 SOL `limitedBy:"reserve"`, gas-blocked 0.03 SOL, `no_balance`, presisi USDC besar) + live RPC baca saldo USDC nyata (akun Raydium authority > 17 jt USDC) lulus; config 6% ditolak.
- [x] **5.2 Hard Stop-Loss & Take-Profit Monitor**
  - Evaluasi harga setiap interval loop. Jika posisi aktif menyentuh batas rugi (cth: -3%), eksekusi swap balik ke SOL/USDC seketika.
  - `src/lib/risk/positions.ts` (`evaluateExit` murni/deterministik — prioritas stop-loss → take-profit → trailing stop; peak price high-water mark utk trailing; `validateExitConfig` + `DEFAULT_EXIT_CONFIG` 3%/6%).
  - `src/lib/risk/monitor.ts` (`PositionTracker` menyimpan posisi terbuka + majukan peak tiap tick; `evaluate`/`signals` mark-to-market. `closePosition` mengevaluasi ulang → `getQuote` balik base→quote → `executeSwap` (pipeline Fase 4) → PnL riil (basis proporsional bigint-safe); `executeExits` menutup tiap sinyal & menghapus posisi hanya setelah eksekusi terkonfirmasi; error swap dilempar & posisi tetap terlacak — ZERO silent no-op).
  - Terverifikasi: `tsc --noEmit`, `eslint`, `next build` lulus semua (0 error). Jalur swap-balik memakai engine Fase 4 yang sudah diverifikasi live.
- [x] **5.3 Daily Max Loss (Circuit Breaker)**
  - Melacak akumulasi rugi dalam 24 jam. Jika mencapai batas maksimal (misal -$15 atau -5% total equity), kunci bot dan ubah status ke `CIRCUIT_BREAKER_TRIPPED`.
  - `src/lib/risk/circuit-breaker.ts` (`DailyLossCircuitBreaker` murni/deterministik, dependency-free — `record`/`recordRealizedPnl` idempoten by `id` anti-double-count; window bergulir 24h (entri lama di-prune); trip saat rugi `>=` threshold = **min** dari `maxLossUsd` dan `maxLossPct×capitalUsd` (yang lebih ketat menang); latch `CIRCUIT_BREAKER_TRIPPED` + `lockedUntil = now + cooldownMs`; `canOpenBuy`/`assertCanOpenBuy` blokir beli (sell/exit tidak pernah diblokir); lock dilepas otomatis setelah 24 jam penuh; `tripManually`/`reset` untuk override operator; config divalidasi & misconfig dilempar).
  - Terverifikasi: 20 skenario runtime lulus (ACTIVE bersih, trip di cap USD, cap %-tighter, blokir beli + lock 24 jam penuh, lift setelah cooldown, rolling window meng-ages-out, idempoten, manual+reset, throw `CircuitBreakerError`, validasi config) + `tsc --noEmit`, `eslint`, `next build` lulus 0 error.
- [ ] **5.4 Tombol Darurat Manual (Panic Sell / Pause)**
  - Tombol di UI untuk membatalkan semua aktivitas dan melikuidasi posisi terbuka ke SOL/USDC secara instan.

---

## FASE 6: Live Testing Skala Mikro & Verifikasi
- [ ] **6.1 Dry-Run (Verifikasi Feed & Logika Sinyal)**
  - Jalankan bot dalam mode dry-run di data live untuk memastikan sinyal dan trigger Stop-Loss terpantau akurat di console/log.
- [ ] **6.2 Micro Test Swap (Transaksi Riil Nilai Sangat Kecil)**
  - Lakukan 1 kali swap riil dengan modal sangat kecil (~0.005 SOL atau ~$1) untuk memvalidasi:
    1. Quote berhasil didapat dari Jupiter.
    2. Transaksi ter-sign dengan aman.
    3. Transaksi terkonfirmasi di Solscan.
    4. Tampilan saldo di dashboard ter-update secara otomatis lewat `LiveFigure`.
