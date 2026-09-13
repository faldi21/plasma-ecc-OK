# CLAUDE.md — plasma-ecc-OK (kampanye pengukuran Paper 1 revisi)

Repo ini dipakai untuk menghasilkan angka pada paper *"Why Additive Elliptic-Curve
Set Commitments Do Not Help Ethereum Plasma: A Negative Result…"*. Spesifikasi
lengkap ada di `EXPERIMENT_PRD.md` (E1–E6) dan `REVISION_ROADMAP.md`.

Paper ini adalah **negative result**. Nilainya terletak pada kejujuran
pengukuran, bukan pada hasil yang bagus. Reviewer sebelumnya menolak paper versi
lama karena angka yang tidak konsisten dan perbandingan yang tidak simetris.
Aturan di bawah ini ada untuk mencegah hal itu terulang.

---

## IRON RULES — jangan dilanggar dalam keadaan apa pun

1. **Jangan pernah mengarang, menebak, memperkirakan, atau mengekstrapolasi nilai
   pengukuran.** Gas, ops/s, latency, ukuran calldata, jumlah transaksi: semua
   hanya boleh berasal dari eksekusi nyata yang tercatat di `data/raw/`. Kalau
   sebuah angka belum diukur, tulis `TODO(measure)` atau biarkan `\fillin{}` —
   jangan diisi dengan "nilai tipikal", "kurang lebih", atau nilai dari kampanye
   lama.
2. **Jangan pernah menulis, mengubah, menghapus, atau "merapikan" isi
   `data/raw/`.** Direktori itu append-only dan dikunci read-only setelah
   kampanye selesai. Kalau ada baris yang tampak salah, laporkan; jangan
   diperbaiki.
3. **Jangan menulis angka hasil langsung ke berkas `.tex`.** Semua tabel dan
   gambar hasil dihasilkan `analysis/make_tables.py` dan `analysis/make_figures.py`
   ke `paper/tables/` dan `paper/figures/`, lalu di-`\input{}` oleh paper.
4. **Jangan menyentuh kunci privat dan kredensial.** Jangan membaca, mencetak,
   menyalin, atau meng-commit isi `.env`. Rujuk variabel lewat namanya saja
   (`process.env.OPERATOR_PK`). Jangan pernah mengirim transaksi ke mainnet.
5. **Jangan mengubah kontrak setelah kampanye dimulai.** Setelah tag
   `paper1-rev1-frozen` dibuat, perubahan pada `contracts/src/` membatalkan
   dataset. Kalau perlu perubahan, bilang dulu — bukan langsung edit.
6. **Jangan mengubah rencana analisis setelah melihat hasil.** `ANALYSIS_PLAN.md`
   dibekukan sebelum kampanye. Uji statistik, margin ekuivalensi ε, dan daftar
   kontras tidak boleh diganti karena hasilnya kurang enak.
7. **Jangan menghaluskan hasil.** Kalau ASC ternyata lebih cepat, atau keccak
   ternyata lebih mahal, laporkan apa adanya. Kegagalan run, revert, dan retry
   ikut dilaporkan, tidak disembunyikan.

---

## Aturan kerja

- **Satu tiket, satu scope.** Kerjakan tiket yang diminta di `TICKETS.md` saja.
  Kalau menemukan masalah di luar scope, catat di akhir jawaban sebagai temuan,
  jangan langsung diperbaiki.
- **Baca dulu, ubah kemudian.** Sebelum menambah file di `contracts/src/`,
  baca kontrak yang ada dan laporkan kalau asumsi PRD tidak cocok dengan kode
  nyata.
- **Perubahan pada kontrak lama hanya untuk instrumentasi.** `RootChainUTXO.sol`
  dan `PlasmaChainUTXO.sol` yang diukur harus tetap setara dengan versi yang
  dievaluasi. Perbaikan kerentanan A1 dikerjakan di branch terpisah
  (`fix/a1-bound-challenge`), bukan di branch yang diukur.
- **Determinisme.** Setiap hal yang acak (pemilihan akun, isi UTXO, urutan sel)
  memakai seed yang dicatat ke record. Tidak ada `Math.random()` tanpa seed.
- **Commit kecil dan deskriptif.** Satu tiket = satu atau beberapa commit yang
  bisa dibaca. Jangan commit isi `data/raw/` bersama perubahan kode.

## Ekonomi eksekusi

- Jangan menjalankan kampanye penuh E3 (≥ 600 run) tanpa diminta. Yang dijalankan
  otomatis hanya *smoke run*: 1 repetisi, T = 500, untuk membuktikan harness
  jalan.
- Transaksi Sepolia memakai ETH testnet yang terbatas. Jangan mengirim transaksi
  L1 di luar tiket yang memang memintanya, dan jangan mengulang batch L1 yang
  gagal lebih dari sekali tanpa bertanya.

## Definisi metrik (jangan diubah sendiri)

- `ops/s` = transfer UTXO logis yang sukses ÷ wall-clock. **Bukan** TPS.
- `L2 tx/s` = transaksi L2 terkirim ÷ wall-clock = ops/s ÷ B.
- `latency` dilaporkan median dan p95, bukan hanya mean.
- Durasi diukur dengan `process.hrtime.bigint()`, disimpan 3 desimal, tidak
  dibulatkan.
- Gas diambil dari `receipt.gasUsed`, bukan dari estimasi (`estimateGas`).

## Struktur yang harus dipatuhi

```
contracts/src/commit/     varian commit (lihat PRD §4.1)
contracts/test/           test Foundry termasuk exploit
bench/harness/            runner, record, anvil, accounts, rng
bench/e1..e3, e6          skrip kampanye
data/raw/<RUN_ID>/        JSONL mentah (read-only setelah selesai)
data/receipts/<RUN_ID>/   receipt L1 lengkap
data/processed/<RUN_ID>/  hasil agregasi + stats.json
analysis/                 aggregate.py, stats.py, make_tables.py, make_figures.py
paper/tables/, figures/   keluaran generated, di-input oleh paper
ANALYSIS_PLAN.md          dibekukan sebelum kampanye
```

## Perintah

```
make freeze     # tag rilis + tulis manifest lingkungan ke data/raw/<RUN_ID>/
make e1|e2|e3   # jalankan kampanye (hanya kalau diminta eksplisit)
make tables     # data/processed -> paper/tables, paper/figures
make verify     # cek D1-D7 (scripts/verify.sh)
forge test -vv  # test kontrak + exploit
```

## Kalau ragu

Berhenti dan tanya. Menghasilkan angka yang salah jauh lebih mahal daripada
menunggu jawaban: paper versi sebelumnya ditolak justru karena itu.
