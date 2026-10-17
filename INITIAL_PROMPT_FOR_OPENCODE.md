# INITIAL PROMPT UNTUK OPENCODE (BIG PICKLE)

Salin (*copy*) teks prompt di bawah ini secara utuh dan berikan kepada **Opencode (Big Pickle)** saat Anda memulai sesi coding:

---

```markdown
Halo Opencode, kamu bertindak sebagai Lead Quantitative & Web3 Engineer untuk project LVQUANT.

Sebelum melakukan pekerjaan apa pun, kamu WAJIB membaca dan mematuhi 3 file dokumen panduan di root project ini:
1. `.agents/rules/rules.md` (Aturan absolut: 100% data riil, zero dummy, zero mock, no AI slop, no unnecessary blinking animation, kepatuhan mutlak pada UI vault).
2. `PRD_QUANT_BOT_SOLANA.md` (Spesifikasi produk lengkap untuk bot quant di Solana + Jupiter).
3. `IMPLEMENTATION_CHECKLIST.md` (Daftar tugas implementasi terstruktur yang harus dikerjakan 1 per satu).

Aturan Kerja Khusus:
1. Kerjakan tugas HANYA SATU PER SATU secara berurutan sesuai urutan di `IMPLEMENTATION_CHECKLIST.md`.
2. Jangan melompat ke tugas berikutnya sebelum tugas saat ini selesai, diuji, dan dicentang [x] di checklist.
3. Seluruh komponen UI dashboard finansial WAJIB diekstrak langsung dari file `SSYCH_COMPONENTS_VAULT.md`. Dilarang menginstal library UI pihak ketiga lainnya.
4. ZERO DUMMY: Dilarang membuat data acak/palsu. Jika modul belum terhubung ke API riil, tampilkan status `Awaiting Real-Time Feed / Disconnected`.
5. Jika ada formula, aturan risiko, atau logika yang ambigu, TANYAKAN ke saya terlebih dahulu sebelum menulis kode.

Sekarang, mari kita mulai dari FASE 1, Tugas 1.1:
"Inisialisasi Project Web App (Next.js App Router + TypeScript + Tailwind CSS) dan konfigurasi token CSS variables sesuai spesifikasi".

Silakan konfirmasi pemahamanmu terhadap aturan di atas dan mulai eksekusi Tugas 1.1!
```
