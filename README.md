# LVQUANT — Quantitative Trading Tools & Terminal

Sistem Quantitative Trading & Execution Terminal untuk jaringan **Solana** yang terintegrasi langsung dengan agregator DEX terkemuka **Jupiter Protocol** (`api.jup.ag`).

Proyek ini dibangun dengan standar institusional: **100% Real Data & Execution** (Zero Mock, Zero Dummy, No Gimmick, No AI Slop) dan antarmuka visual finansial modern yang 100% patuh pada [SSYCH_COMPONENTS_VAULT.md](./SSYCH_COMPONENTS_VAULT.md).

---

## Fitur Utama

- **Real-Time Execution Engine**: Integrasi langsung dengan Jupiter DEX Aggregator (Ultra Swap / Exact-In & Exact-Out) dengan smart-routing antar seluruh DEX di Solana (Raydium, Orca, Meteora, dll.).
- **Self-Custody & Aman**: Non-custodial, private key disimpan lokal di `.env`, transaksi di-sign secara lokal tanpa perantara pihak ketiga.
- **Lapisan Manajemen Risiko Berlapis**:
  - Dynamic Position Sizing (2% - 5% max risk per trade).
  - Hard Stop-Loss & Trailing Stop-Loss on-chain.
  - 24h Daily Max Loss (*Circuit Breaker*) untuk proteksi modal riil.
  - MEV & Sandwich Attack Shield melalui integrasi Jito Block Engine & Dynamic Priority Fees.
- **Fintech Dashboard**:
  - Dibangun menggunakan **Next.js (App Router)**, **TypeScript**, dan **Tailwind CSS**.
  - Komponen murni dari **SSYCH Components Vault** (Price Scrubber magnetik, Live Figure rolling numbers, Segmented Control, dan Dark/Light theme).

---

## Tech Stack

| Layer | Teknologi |
| :--- | :--- |
| **Framework** | Next.js 16 (Turbopack, App Router) |
| **Language** | TypeScript 5 |
| **Styling** | Tailwind CSS v4 |
| **Animation** | Motion / React (Framer Motion) |
| **Blockchain** | Solana Mainnet-Beta (`@solana/web3.js`) |
| **DEX Aggregator** | Jupiter Swap API (`https://api.jup.ag`) |
| **RPC Provider** | Helius / Quicknode / Triton |

---

## Struktur Direktori

```text
├── .agents/                 # Workspace rules & pedoman absolut (anti-dummy, anti-slop)
├── src/
│   ├── app/                 # Next.js App Router (layout, globals.css dengan vault tokens)
│   ├── components/
│   │   └── ui/              # Komponen UI murni dari SSYCH Vault (control-classes, segmented-control, dll.)
│   └── lib/                 # Utility (cn helper, math quant, solana connection)
├── PRD_QUANT_BOT_SOLANA.md  # Product Requirement Document lengkap
├── IMPLEMENTATION_CHECKLIST.md # Status checklist tahapan eksekusi
└── SSYCH_COMPONENTS_VAULT.md # Vault komponen UI finansial
```

---

## Memulai (Quickstart)

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Jalankan Development Server
```bash
npm run dev
```
Buka browser di `http://localhost:3000`.

### 3. Build Produksi
```bash
npm run build
```

---

## Pedoman Integritas & Keamanan

Seluruh proses pengembangan diatur secara ketat oleh pedoman di `.agents/rules/rules.md`:
1. **Zero Dummy**: Tidak ada simulasi PnL buatan atau saldo palsu. Semua data harga, transaksi, dan saldo berasal 100% dari data riil on-chain / API resmi.
2. **Strict UI Vault Compliance**: Tidak menggunakan library UI luar yang tidak terstandar. Tidak ada badge kosmetik ("AI Powered") atau animasi berlebihan yang tidak perlu.
