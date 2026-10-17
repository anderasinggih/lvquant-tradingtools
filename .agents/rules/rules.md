# SYSTEM INSTRUCTIONS & PROJECT RULES: LVQUANT BOT

Rules ini bersifat **ABSOLUT** dan **WAJIB DIPATUHI** dalam setiap interaksi, perancangan, penulisan kode, dan eksekusi pada proyek LVQUANT.

---

## 1. Zero Dummy, Zero Mock, Zero Gimmick (100% Real Data & Execution)
- **DILARANG** menggunakan data dummy, mock data acak, hardcoded random PnL, atau data tipuan/gimmick.
- Semua data harga, orderbook, saldo wallet, dan riwayat transaksi **WAJIB 100% data riil** yang berasal dari on-chain Solana, RPC Helius/Quicknode, atau API resmi (Jupiter API, DexScreener/Birdeye).
- Jangan membuat simulasi palsu yang seolah-olah bot sedang profit atau menghasilkan uang padahal data tersebut buatan. Jika modul belum terkoneksi ke data feed riil, tampilkan status `Not Connected / Awaiting Data Feed`, jangan isi dengan angka bohongan.

## 2. No Fallback Diam-diam / No Fake Error Concealment
- Jika suatu API gagal, response error, atau koneksi putus, **JANGAN** membuat fallback diam-diam ke data palsu atau mengasumsikan transaksi berhasil.
- Error handling harus transparan: log error secara presisi, stop eksekusi transaksi yang berisiko, dan laporkan langsung ke log / user.

## 3. Strict Logic & No Over-Improvement (No Hallucinated Signals)
- **JANGAN** menambah-nambahi logika rumit, indikator berlebihan, atau fitur "AI prediksi" yang mengada-ada tanpa dasar matematis yang jelas.
- Jaga logika quant tetap deterministik, disiplin, dan sesuai spesifikasi yang disetujui.
- **JIKA BINGUNG / AMBIGU, TANYA KE USER!** Jangan pernah berasumsi atau menebak-nebak aturan risiko, ukuran lot, atau formula jika parameternya belum didefinisikan secara tegas.

## 4. UI Design Rules: WAJIB FULL 100% Menggunakan `SSYCH_COMPONENTS_VAULT.md`
- **KOMPONEN UI WAJIB 100% DIAMBIL DARI VAULT**: Seluruh elemen visual dashboard (chart, scrubber, segmented controls, live figure, switchers, buttons, inputs/fields, table, index card, market snapshot) **WAJIB FULL** diambil dan diimplementasikan langsung dari file [SSYCH_COMPONENTS_VAULT.md](file:///Volumes/LVNPC/ALL%20PROJECT/LVQUANT/SSYCH_COMPONENTS_VAULT.md).
- **DILARANG MENGGUNAKAN UI LIBRARY LAIN**: Dilarang menginstall atau menggunakan komponen dari library luar (seperti Shadcn eksternal sembarangan, Chakra, MUI, AntD, dll). Fondasi UI adalah murni komponen vault tersebut.
- **DILARANG AI SLOP, GIMMICK, & BADGE BERLEBIHAN**:
  - Dilarang menambahkan badge-badge hiasan yang tidak perlu (misal: "AI Powered", "Smart Algo", chip/tag dekoratif tak bermakna).
  - Dilarang menambahkan animasi berlebihan seperti dot blinking/pulsing tanpa fungsi, glow berlebihan, shimmer looping, atau efek grafis murahan yang tidak ada di vault. Animasi hanya diizinkan jika memang bawaan komponen vault (seperti transisi angka `LiveFigure` atau pergeseran scrubber).
- Penambahan elemen di luar vault hanya diizinkan secara minimal untuk:
  - Penataan layout container, padding, size, margin, dan grid responsive.
  - Komponen fungsional spesifik yang mutlak belum ada di vault (misalnya modal dialog konfirmasi transaksi/input API key) dengan **wajib mengadopsi token styling asli** dari `control-classes.ts` di dalam vault (`THUMB`, `TRACK`, `BUTTON`, `FIELD`, `ICON_BUTTON`).

## 5. Wallet & Capital Safety
- Karena sistem ini ditujukan untuk **uang riil**, setiap fungsi eksekusi swap / transaksi wajib memiliki verifikasi ganda:
  - Validasi balance sebelum eksekusi.
  - Validasi slippage maksimal.
  - Validasi batas maksimal loss harian (*Circuit Breaker*).
- Kunci privat (*Private Key*) tidak boleh di-hardcode ke file kode apa pun. Wajib via environment variable (`.env`).
