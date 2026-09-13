# Tiket Eksekusi — Kampanye Pengukuran Paper 1 Revisi

Sepuluh tiket, dikerjakan berurutan. Tiap tiket berisi **scope**, **out of scope**,
**acceptance criteria**, dan **prompt siap tempel** untuk Claude Code.

Prasyarat sekali di awal: salin `CLAUDE.md`, `EXPERIMENT_PRD.md`, dan
`REVISION_ROADMAP.md` ke root repo `plasma-ecc-OK`, lalu commit.

Aturan pakai: satu tiket per sesi Claude Code. Jangan gabung T1–T9 dalam satu
prompt. Setelah tiap tiket, baca ringkasannya dan jalankan sendiri
`forge test` / `make verify` sebelum lanjut.

---

## T0 — Gap analysis (wajib pertama, read-only)

**Scope:** membaca kode yang ada dan melaporkan selisihnya terhadap PRD. Tidak
ada perubahan kode sama sekali.

**Out of scope:** menulis file apa pun kecuali `docs/GAP_ANALYSIS.md`.

**Acceptance criteria:**
- Ada `docs/GAP_ANALYSIS.md` berisi: (a) di mana digest dihitung sekarang di
  `PlasmaChainUTXO.sol`, (b) apakah `createBlock`/`createBlockChunked` bisa
  dipasangi strategy tanpa mengubah semantik blok, (c) daftar fungsi operator di
  `RootChainUTXO.sol` beserta modifier-nya, (d) apakah `ECCAccumulator.sol` sudah
  lengkap di repo, (e) daftar asumsi PRD yang tidak cocok dengan kode nyata.
- Tidak ada rekomendasi yang dieksekusi, hanya dilaporkan.

**Prompt:**

```
Baca CLAUDE.md dan EXPERIMENT_PRD.md lebih dulu.

Tiket T0, read-only. Jangan ubah kode apa pun.

Petakan kode yang ada terhadap PRD:
1. Di file dan fungsi mana digest blok dihitung sekarang (L2), dan bagaimana
   alurnya dari transferUtxoBatch -> pendingUtxos -> createBlock ->
   createBlockChunked -> submitBlock ke L1.
2. Apakah langkah digest bisa dipisah ke sebuah ICommitStrategy tanpa mengubah
   semantik pembuatan blok? Kalau tidak, jelaskan hambatannya dan usulkan
   alternatif (misal salinan kontrak per varian).
3. Daftar semua fungsi onlyOperator di RootChainUTXO.sol beserta apa yang
   ditulisnya ke state L1.
4. Apakah libraries/ECCAccumulator.sol ada dan lengkap? Kalau tidak, sebutkan
   yang hilang.
5. Daftar asumsi di PRD bagian 4.1 dan 6 yang tidak cocok dengan kode nyata.

Tulis hasilnya ke docs/GAP_ANALYSIS.md. Jangan menyarankan perbaikan yang
langsung dikerjakan; ini laporan.
```

---

## T1 — Validasi trik ecrecover (dikerjakan sebelum varian dibangun)

**Scope:** library kecil + test yang membuktikan `ecrecover` bisa memverifikasi
`A == k·G`.

**Out of scope:** integrasi ke kontrak commit.

**Acceptance criteria:**
- `contracts/src/commit/EcrecoverMulCheck.sol` dengan fungsi
  `eqScalarMulG(uint256 k, uint256 ax, uint256 ay) -> bool`.
- Test membandingkan hasilnya dengan `scalarMul` referensi untuk ≥ 100 nilai `k`
  acak berseed, plus kasus batas `k = 1`, `k = 2`, `k = N-1`, dan kasus negatif
  (titik salah harus ditolak).
- Gas per pemanggilan dilaporkan.
- Kalau tidak bisa dibuat cocok: tulis `docs/ECRECOVER_TRICK.md` yang menjelaskan
  kenapa gagal, dan varian ASC-ecrecover dicoret dari kampanye. Jangan dipaksakan.

**Prompt:**

```
Tiket T1. Baca EXPERIMENT_PRD.md bagian 4.2.

Implementasikan dan buktikan trik ecrecover untuk memverifikasi A == k*G di
secp256k1: ecrecover(0, v, Gx, mulmod(k, Gx, N)) mengembalikan address(k*G).

1. Buat contracts/src/commit/EcrecoverMulCheck.sol dengan
   eqScalarMulG(uint256 k, uint256 ax, uint256 ay) returns (bool).
   Tentukan v yang benar dari paritas Gy, dan tolak k = 0 atau k >= N.
2. Buat contracts/test/EcrecoverMulCheck.t.sol yang membandingkan hasilnya
   dengan scalarMul dari libraries/ECCAccumulator.sol untuk 100 nilai k acak
   (seed tetap, catat di test), plus k = 1, 2, N-1, dan minimal 3 kasus negatif
   (titik yang salah harus menghasilkan false).
3. Laporkan gas per pemanggilan dari test.

Kalau triknya tidak bisa dibuat cocok, JANGAN dipaksakan: tulis
docs/ECRECOVER_TRICK.md yang menjelaskan persisnya apa yang gagal, dan berhenti.
```

---

## T2 — Varian commit E1

**Scope:** tujuh implementasi commit di balik satu antarmuka.

**Out of scope:** benchmark, harness, pengukuran.

**Acceptance criteria:**
- `ICommitStrategy.sol` + `CommitBaseline`, `CommitASCNaive`, `CommitASC1SM`,
  `CommitASCEcrecover`, `CommitScalar`, `CommitKeccak`, `CommitMerkle`
  (OpenZeppelin 5.5.0 `Bytes32PushTree`, depth 20).
- `CommitKeccak` menolak `ids` yang tidak menaik ketat (ada test negatifnya).
- Semua varian dipanggil lewat jalur `createBlock` yang sama; hanya langkah
  digest yang berbeda.
- Kompilasi via-IR, optimizer 200, tanpa warning baru.

**Prompt:**

```
Tiket T2. Baca EXPERIMENT_PRD.md bagian 4.1 dan docs/GAP_ANALYSIS.md.

Implementasikan tujuh varian commit di contracts/src/commit/ di balik satu
antarmuka ICommitStrategy, mengikuti pendekatan yang direkomendasikan di
GAP_ANALYSIS.md:

- CommitBaseline: baca ids, tanpa digest (kontrol biaya storage-read)
- CommitASCNaive: scalarMul + pointAdd per elemen (kode lama)
- CommitASC1SM: addmod per elemen, satu scalarMul di akhir
- CommitASCEcrecover: addmod per elemen, titik dikirim lewat hint, diverifikasi
  dengan EcrecoverMulCheck (lewati kalau T1 gagal)
- CommitScalar: simpan skalar s saja
- CommitKeccak: wajib ids menaik ketat, keccak256(abi.encodePacked(ids))
- CommitMerkle: OpenZeppelin 5.5.0 Bytes32PushTree, depth 20, keccak komutatif

Syarat: jalur pemanggilan dari createBlock identik untuk semua varian, hanya
langkah digest yang berbeda. Jangan mengubah semantik pembuatan blok.
Jangan menjalankan benchmark apa pun di tiket ini.
```

---

## T3 — Test paritas on-chain vs off-chain

**Scope:** membuktikan digest Solidity == digest TypeScript untuk tiap varian.

**Acceptance criteria:**
- Test paritas untuk ≥ 50 set acak berseed, ukuran n ∈ {1, 2, 10, 100}.
- Termasuk kasus `e mod N` (elemen ≥ N) dan elemen duplikat.
- Perbedaan sekecil apa pun = test merah, bukan toleransi.

**Prompt:**

```
Tiket T3.

Buat test paritas yang membuktikan setiap varian commit menghasilkan digest yang
sama di Solidity dan di implementasi TypeScript (elliptic 6.6.1 / viem):
- 50 set acak berseed, n dalam {1, 2, 10, 100}
- sertakan elemen >= N (uji reduksi mod N) dan elemen duplikat
- bandingkan byte per byte, tanpa toleransi

Boleh pakai ffi Foundry atau skrip Node yang membandingkan keluaran keduanya;
pilih yang paling sederhana dan jelaskan pilihannya di README test.
```

---

## T4 — Test exploit E4

**Scope:** lima test di PRD §8.

**Acceptance criteria:**
- `ExploitA1_ExitGriefing.t.sol`: attacker bukan operator, τ acak, exit jujur
  batal, `spent(utxoId) == true`, gas dicatat.
- `ExploitA2_UnbackedExit.t.sol`: operator meregistrasi UTXO tanpa deposit, exit
  selesai, nilai tertarik dicatat.
- `PropVacuity.t.sol`: 100 elemen yang tidak pernah ditambahkan tetap verify.
- `PropNonBinding.t.sol`: dua multiset berbeda, digest identik (dua konstruksi:
  `+δ/−δ` dan elemen penyeimbang `e*`).
- Nama test final dan tidak diganti lagi (dikutip di paper).
- Hasil diekspor ke `data/raw/<RUN_ID>/e4_exploits.jsonl`.

**Prompt:**

```
Tiket T4. Baca EXPERIMENT_PRD.md bagian 8.

Buat lima test Foundry yang membuktikan klaim keamanan di paper:
1. ExploitA1_ExitGriefing.t.sol - attacker (bukan operator) membatalkan exit
   jujur dengan tau acak dan W = A_bs - tau*G. Assert exit dibatalkan dan
   spent(utxoId) true. Catat gas.
2. ExploitA2_UnbackedExit.t.sol - operator meregistrasi exit UTXO yang tidak
   pernah didepositkan lalu menariknya. Catat nilai yang tertarik.
3. PropVacuity.t.sol - 100 elemen acak yang tidak pernah ditambahkan tetap lolos
   verifikasi witness.
4. PropNonBinding.t.sol - dua multiset berbeda menghasilkan digest identik;
   buktikan dua konstruksi: tukar +delta/-delta, dan elemen penyeimbang e*.

Nama file dan nama fungsi test ini dikutip di paper, jadi anggap final.
Ekspor hasil (nama test, status, gas) ke data/raw/<RUN_ID>/e4_exploits.jsonl.
Jangan memperbaiki kerentanannya di tiket ini.
```

---

## T5 — Harness benchmark

**Scope:** infrastruktur pengukuran, belum kampanye.

**Acceptance criteria:**
- `bench/harness/` berisi `runner.ts`, `record.ts`, `anvil.ts`, `accounts.ts`,
  `rng.ts`.
- Record JSONL persis mengikuti skema PRD §3.2, termasuk `env_hash`.
- Snapshot/revert per run, warm-up dibuang, urutan sel diacak per repetisi
  dengan seed tercatat.
- Durasi pakai `process.hrtime.bigint()`, 3 desimal.
- `data/raw/` dibuat append-only; runner menolak menimpa `RUN_ID` yang sudah ada.
- Smoke run (1 repetisi, T = 500) berhasil dan menghasilkan JSONL yang valid.

**Prompt:**

```
Tiket T5. Baca EXPERIMENT_PRD.md bagian 3.

Bangun harness benchmark di bench/harness/: runner.ts, record.ts, anvil.ts,
accounts.ts, rng.ts.

Syarat:
- Skema record JSONL persis seperti PRD 3.2, termasuk env_hash dari versi tool
  dan konfigurasi.
- Isolasi: evm_snapshot sebelum run, W batch warm-up yang dibuang, evm_revert
  sesudahnya.
- Urutan sel diacak per repetisi dengan seed deterministik yang ikut dicatat.
- Durasi dengan process.hrtime.bigint(), simpan 3 desimal, jangan dibulatkan.
- Gas dari receipt.gasUsed, bukan estimateGas.
- Runner menolak menulis ke RUN_ID yang direktorinya sudah ada.

Terakhir jalankan SATU smoke run (1 repetisi, T = 500, sel deferred saja) untuk
membuktikan harness jalan, lalu tunjukkan 2 baris JSONL hasilnya. Jangan
menjalankan kampanye penuh.
```

---

## T6 — Skrip kampanye E1 dan E2

**Acceptance criteria:**
- `bench/e1_commit_cost.ts`: 7 varian × n ∈ {10, 100, 1000}, L2; L1 hanya
  n = 100 dengan `N_L1` terpisah dan dapat dikonfigurasi.
- Chunking terdeteksi otomatis: kalau satu tx melebihi batas gas, catat jumlah
  chunk dan gas tiap chunk.
- `bench/e2_sync_gas.ts`: 9 fungsi di PRD §5, cold dan warm dicatat terpisah,
  `batchSyncUtxoSpent` diukur pada 10/50/100 UTXO.
- Semua tx L1 menyimpan receipt penuh ke `data/receipts/<RUN_ID>/`.
- Dry-run mode (`--dry-run`) yang tidak mengirim tx L1.

**Prompt:**

```
Tiket T6. Baca EXPERIMENT_PRD.md bagian 4.3 dan 5.

Tulis bench/e1_commit_cost.ts dan bench/e2_sync_gas.ts di atas harness T5.

E1: 7 varian x n dalam {10, 100, 1000} untuk gas L2 createBlock; untuk n = 100
juga ukur L1 submitBlock (gas, calldata bytes, jumlah tx, tx hash) dengan jumlah
repetisi L1 yang terpisah dan bisa dikonfigurasi. Deteksi otomatis kalau butuh
chunking dan catat gas per chunk.

E2: ukur gas 9 fungsi di PRD bagian 5, cold-state dan warm-state terpisah,
batchSyncUtxoSpent pada 10/50/100 UTXO. Simpan receipt L1 lengkap ke
data/receipts/<RUN_ID>/.

Sediakan flag --dry-run yang menjalankan semua bagian L2 tanpa mengirim satu pun
transaksi L1. Jalankan hanya dry-run di tiket ini; kampanye L1 saya jalankan
sendiri.
```

---

## T7 — Skrip kampanye E3

**Acceptance criteria:**
- 5 sel (ASC/Merkle × inline/deferred + Keccak deferred), ditambah sub-varian
  `ASC inline-1SM` kalau sudah ada dari T2.
- K ≥ 20 akun, pasangan acak berseed, B = 100, C = 3, T ∈ {500, 1000, 1500, 2000}.
- N repetisi dari konfigurasi, default 30; urutan sel diacak per repetisi.
- Mencatat `ops_completed`, `ops_failed`, `ops_retried`, array latency per batch.
- Estimasi durasi kampanye dicetak sebelum mulai, dan minta konfirmasi kalau
  perkiraannya di atas 30 menit.

**Prompt:**

```
Tiket T7. Baca EXPERIMENT_PRD.md bagian 6.

Tulis bench/e3_throughput.ts di atas harness T5 untuk desain faktorial:
primitive {ASC, Merkle} x placement {inline, deferred}, plus kontrol
Keccak-deferred. Kalau varian ASC inline-1SM tersedia, tambahkan sebagai sel
keenam.

Parameter: K >= 20 akun (pasangan pengirim-penerima acak berseed), B = 100,
C = 3, T dalam {500, 1000, 1500, 2000}, N dari konfigurasi (default 30),
warm-up W = 3 batch, urutan sel diacak per repetisi.

Catat per run: ops_completed, ops_failed, ops_retried, array latency per batch,
durasi hrtime.

Sebelum mulai, cetak estimasi durasi kampanye dan minta konfirmasi kalau lebih
dari 30 menit. Di tiket ini jalankan hanya 1 repetisi T = 500 sebagai smoke test.
```

---

## T8 — Analisis, tabel, gambar

**Acceptance criteria:**
- `aggregate.py`: `data/raw` → `data/processed/*.csv` (deskriptif lengkap:
  mean, SD, median, p95, min, max, N, CI 95%, gagal/retry).
- `stats.py`: ANOVA dua arah, Welch, Mann-Whitney, Holm, Cohen's d, bootstrap CI
  rasio, TOST dengan ε dari `ANALYSIS_PLAN.md` → `stats.json`.
- `make_tables.py`: menghasilkan `tab_commit_cost.tex`, `tab_op_gas.tex`,
  `tab_throughput.tex`, `tab_exploits.tex`, `tab_params.tex`.
- `make_figures.py`: `fig_throughput.pdf` dengan error bar CI 95%.
- Idempoten: dijalankan dua kali menghasilkan berkas identik byte per byte.
- Kalau sebuah sel belum ada datanya, tabel keluar dengan `\fillin{...}`, bukan
  angka karangan.

**Prompt:**

```
Tiket T8. Baca EXPERIMENT_PRD.md bagian 7 dan 11.

Tulis analysis/aggregate.py, stats.py, make_tables.py, make_figures.py.

aggregate.py: data/raw/<RUN_ID>/*.jsonl -> data/processed/<RUN_ID>/*.csv dengan
mean, SD, median, p95, min, max, N, CI 95%, jumlah gagal dan retry per sel.

stats.py: ANOVA dua arah pada ops/s (T = 2000), kontras ASC-deferred vs
Merkle-deferred (Welch + Mann-Whitney + Cohen's d + CI selisih), kontras
ASC-inline vs ASC-deferred (rasio + bootstrap CI 10000), koreksi Holm, cek
Shapiro-Wilk dan Levene, dan TOST dengan epsilon dari ANALYSIS_PLAN.md.
Keluaran ke stats.json.

make_tables.py dan make_figures.py hanya membaca CSV dan stats.json - tidak ada
perhitungan di dalamnya. Hasilkan tab_commit_cost.tex, tab_op_gas.tex,
tab_throughput.tex, tab_exploits.tex, tab_params.tex, dan fig_throughput.pdf
dengan error bar CI 95%.

Wajib: idempoten (dua kali jalan = berkas identik), dan kalau sebuah sel belum
punya data, keluarkan \fillin{...} - jangan pernah mengisi angka perkiraan.
```

---

## T9 — Freeze, verify, dokumentasi

**Acceptance criteria:**
- `ANALYSIS_PLAN.md` (ε, daftar uji, daftar kontras) siap dan di-commit sebelum
  kampanye.
- `make freeze` membuat tag `paper1-rev1-frozen` dan menulis manifest lingkungan.
- `scripts/verify.sh` mengecek D1–D7 dan keluar non-zero kalau ada yang gagal.
- `README.md` berisi langkah reproduksi lengkap + perkiraan waktu + kebutuhan ETH
  Sepolia.

**Prompt:**

```
Tiket T9. Baca EXPERIMENT_PRD.md bagian 0, 9, dan 14.

1. Tulis ANALYSIS_PLAN.md: daftar uji statistik, daftar kontras yang dilaporkan,
   margin ekuivalensi epsilon = 3% dengan TOST, dan aturan kalau asumsi
   normalitas dilanggar. Ini dibekukan sebelum kampanye.
2. Tambahkan target Makefile: freeze, e1, e2, e3, tables, verify.
   freeze membuat tag paper1-rev1-frozen dan menulis manifest lingkungan
   (versi tool, hash foundry.toml dan package-lock.json, info CPU/OS) ke
   data/raw/<RUN_ID>/manifest.json.
3. Implementasikan scripts/verify.sh sesuai spesifikasi D1-D7 (saya sertakan
   versi awalnya di execution pack; sesuaikan path ke repo ini).
4. Tulis README.md: prasyarat, urutan perintah, perkiraan durasi tiap kampanye,
   dan perkiraan ETH Sepolia yang dibutuhkan.
```

---

## Setelah semua tiket

Urutan menutup pekerjaan (kamu yang jalankan, bukan Claude Code):

1. `git tag paper1-rev1-frozen` lewat `make freeze`
2. Jalankan E1, E2 (dengan L1 Sepolia), lalu E3 kampanye penuh, di mesin idle
3. `make tables`
4. Ganti tabel hasil di `main_rev1.tex` menjadi `\input{paper/tables/...}`
5. Isi `\todo` interpretasi, compile, `make verify`
6. Rilis tag → Zenodo DOI → isi Data Availability
