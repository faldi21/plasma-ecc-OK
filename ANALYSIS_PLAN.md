# ANALYSIS_PLAN.md — dibekukan sebelum kampanye penuh dijalankan

Status: **FROZEN** pada 2026-09-14, sebelum kampanye E1–E4 penuh dijalankan
(hanya smoke/dry-run yang sudah ada pada tanggal ini). Per `CLAUDE.md` IRON
RULE 6: rencana di berkas ini — uji statistik, margin ekuivalensi ε, daftar
kontras — tidak boleh diubah setelah melihat hasil kampanye penuh. Kalau
perlu revisi, catat di bagian "Riwayat perubahan" di bawah dengan alasannya
dan tanggal, jangan menimpa diam-diam.

Ini adalah dokumen rujukan untuk `analysis/stats.py` (docs/TICKETS.md T8).
Blok `analysis_plan.yml` di bawah dibaca langsung oleh `stats.py` saat
runtime (bukan angka yang disalin ulang ke kode) — mengubah margin ε atau
parameter lain di sini otomatis mengubah apa yang dipakai `stats.py`, jadi
perubahan macam itu SELALU eksplisit dan tercatat di riwayat git berkas
ini, tidak pernah diam-diam di dalam kode Python.

## 1. Statistik deskriptif (§7.1) — semua sel

Untuk setiap `cell_id` (E1/E2/E3) dengan status `ok`: mean, SD, median, p95,
min, max, N, CI 95% mean (t-Student, df = N-1), jumlah run berstatus gagal
(`error`, `exceeds_block_gas_limit`, `batch_timeout`) dan jumlah retry
(`ops_retried`), dilaporkan terpisah dari statistik run yang berhasil —
tidak pernah dicampur atau dibuang diam-diam. Dikerjakan oleh
`analysis/aggregate.py`, bukan `stats.py`.

## 2. Uji utama (§7.2)

- **Two-way ANOVA** pada `ops/s`, hanya pada baris E3 dengan `T = 2000`:
  faktor Primitive (ASC, Merkle) × Placement (inline, deferred). Laporkan
  F, df (numerator, denominator), p, dan partial η² untuk tiap efek utama
  dan interaksinya. Sel kontrol `keccak.deferred` TIDAK masuk desain 2×2
  ini (tidak punya pasangan inline) — dianalisis terpisah sebagai kontras
  tambahan (lihat di bawah).
- **Kontras utama RQ4:** `asc.deferred` vs `merkle.deferred` — Welch
  t-test, Mann-Whitney U, Cohen's d, CI 95% selisih mean.
- **Kontras placement:** `asc.inline` vs `asc.deferred` — rasio mean
  (inline/deferred) dengan CI 95% bootstrap (10.000 resample, seeded).
- **Kontrol Keccak:** `keccak.deferred` dibandingkan terhadap
  `asc.deferred` DAN `merkle.deferred` (dua kontras terpisah, metode sama
  seperti kontras utama RQ4 — Welch + Mann-Whitney + Cohen's d + CI).
- **Koreksi ganda:** Holm-Bonferroni diterapkan lintas SEMUA kontras
  pairwise yang dilaporkan bersama dalam satu tabel (RQ4, placement, dua
  kontrol Keccak — total 4 kontras pairwise per nilai T yang dianalisis).

## 3. Asumsi (§7.3)

Untuk setiap kontras pairwise: Shapiro–Wilk per kelompok (normalitas) dan
Levene (homoskedastisitas antar kelompok). Kalau salah satu dilanggar
(p < 0.05): laporkan Welch t-test/Mann-Whitney sebagai uji UTAMA dan ANOVA
klasik sebagai sekunder saja — keputusan ini otomatis berdasarkan hasil uji
asumsi, BUKAN dipilih manual setelah melihat p-value uji utama.

## 4. Margin ekuivalensi ε (§7.4, wajib — R1-6)

> ε = 3% dari mean sel referensi (`merkle.deferred`, pada T yang sama
> dengan kontras yang diuji). Dua sel disebut *praktis setara* hanya jika
> CI 95% selisih relatif (TOST, two one-sided tests, α = 0.05) seluruhnya
> berada dalam ±ε.

Kalau tidak setara dan tidak berbeda signifikan pada uji utama: laporkan
"tidak dapat disimpulkan pada N ini" — jangan pernah menulis "setara" tanpa
TOST lolos secara eksplisit.

## 5. Parameter beku (dibaca `analysis/stats.py`)

```yaml
# analysis_plan.yml — BEKU. Ubah nilai di sini = perubahan rencana analisis
# yang tercatat di git log, bukan di kode.
alpha: 0.05
equivalence_epsilon_pct: 3.0
equivalence_reference_cell: merkle.deferred
bootstrap_resamples: 10000
bootstrap_seed: 20260914
anova_t_value: 2000
anova_factors:
  primitive: [asc, merkle]
  placement: [inline, deferred]
main_contrasts:
  - id: rq4_asc_deferred_vs_merkle_deferred
    cell_a: asc.deferred
    cell_b: merkle.deferred
  - id: placement_asc_inline_vs_asc_deferred
    cell_a: asc.inline
    cell_b: asc.deferred
  - id: keccak_control_vs_asc_deferred
    cell_a: keccak.deferred
    cell_b: asc.deferred
  - id: keccak_control_vs_merkle_deferred
    cell_a: keccak.deferred
    cell_b: merkle.deferred
holm_correction_group: main_contrasts
```

## Amandemen 1 — perbandingan net-of-baseline

**Tanggal: 2026-09-15.** Ditulis SEBELUM ada data kampanye penuh — dipicu
oleh temuan STRUKTURAL dari satu pilot yang dibuang (lihat Latar), bukan
oleh hasil kampanye. Ini tidak menimpa Bagian 1–5 di atas; hanya menambah
aturan analisis baru untuk kelompok sel `bench.commit_*`, sesuai mekanisme
yang dijelaskan di pembuka berkas ini ("catat di bagian Riwayat perubahan
dengan alasannya dan tanggal, jangan menimpa diam-diam").

### Latar

Pilot 16–18 record (RUN_ID `20260914-225925-b62f671`, **dibuang, tidak
pernah dipakai sebagai data kampanye**) memperlihatkan bahwa
`createBlock()` di ketujuh varian `contracts/src/commit/*.sol` memuat
guard duplikat yang identik secara byte-for-byte —
`if (elements[el]) return false; elements[el] = true; count++` — berbiaya
kira-kira 20.000 gas/elemen (SSTORE dingin ke slot baru). Di n besar, suku
bersama ini mendominasi total gas dan menyamarkan perbedaan biaya antar
primitif digest yang sesungguhnya jadi objek RQ. Yang terlihat dari pilot
ini adalah STRUKTUR biaya (ada satu suku O(n) yang identik di semua
varian), **bukan arah atau besar efek antar varian** — 16–18 record dari
satu repetisi bukan dasar kesimpulan efek apa pun, dan tidak dipakai
sebagai itu di sini.

### Aturan untuk sel `bench.commit_*`

Besaran yang diuji adalah selisih terhadap baseline, dipasangkan per
`(n, repetition, seed)`:

```
delta(v, n, r) = gas(v, n, r) - gas(CommitBaseline, n, r)
```

Uji TOST (ekuivalensi, epsilon = `commit_cost_equivalence_epsilon_pct`%
dari mean gas `CommitBaseline` pada `n` yang sama — paired TOST, bukan
dua-sampel independen, karena `delta` sudah berupa pasangan), koreksi Holm
(satu keluarga per nilai `n`, lintas seluruh varian non-baseline yang
punya data pada `n` itu — mengikuti pola yang sudah ada di Bagian 2: satu
tabel = satu keluarga Holm), dan bootstrap CI (seeded, memakai
`bootstrap_resamples`/`bootstrap_seed` yang sama seperti Bagian 5 di atas,
resampling pasangan `(v,n,r)` bersama) semuanya dijalankan atas `delta`,
**TIDAK atas gas absolut**. Gas absolut tetap dilaporkan di tabel sebagai
kolom terpisah — deskriptif saja, bukan objek uji.

### Aturan untuk sel `sys.plasma_*`

**TIDAK dikurangi baseline apa pun.** Di sini total gas adalah objek yang
diminati — biaya nyata mengoperasikan sistem L2 penuh, bukan primitif
digest yang diisolasi. Angka `bench.*` dan `sys.*` tidak pernah
dibandingkan lintas kelompok (aturan yang sudah berlaku sebelum amandemen
ini; ditegaskan ulang di sini karena berkaitan langsung dengan aturan
net-of-baseline di atas).

### Kelayakan blok

Ambang kelayakan blok adalah `mainnet_block_gas_limit` = 36.000.000 gas,
dinyatakan sebagai batas gas blok Ethereum pada tanggal kampanye ini
dijalankan — bukan batas Anvil (`ANVIL_GAS_LIMIT` di `.env.paper1`, jauh
lebih tinggi, dipakai murni supaya kurva gas tetap terukur melewati batas
nyata, bukan untuk klaim kelayakan). Dicatat per record lewat field
`exceeds_mainnet_block_limit` (`bench/harness/record.ts`, pre-freeze
harness fix). Batas gas Anvil tidak pernah dipakai untuk klaim kelayakan
blok nyata.

### Provenance transaksi

Transaksi commit yang diukur diberi salt pada `maxPriorityFeePerGas`
(naik monoton per transaksi terukur, lihat `bench/e1_commit_cost.ts`)
semata-mata untuk menjamin `tx_hash` unik di seluruh RUN_ID — di bawah
isolasi snapshot/revert plus warm-up, dua sel berbeda bisa lahir dengan
transaksi ter-signed yang byte-identik tanpa salt ini (pre-freeze harness
fix). Salt ini HANYA mengubah fee/signature transaksi, tidak pernah
memengaruhi `gas_used`, yang tetap murni hasil eksekusi EVM.

### Parameter baru (dibaca `analysis/stats.py`)

```yaml
# analysis_plan_amendment_1.yml -- BEKU sejak 2026-09-15. Digabung dengan
# blok analysis_plan.yml di Bagian 5 di atas oleh stats.py (kunci baru,
# tidak ada tabrakan nama); blok Bagian 5 TIDAK diubah oleh amandemen ini.
commit_cost_baseline_variant: baseline
commit_cost_equivalence_epsilon_pct: 3.0
mainnet_block_gas_limit: 36000000
```

## Amandemen 2 — E3 dibekukan terpisah, satu Anvil per run

**Tanggal: 2026-09-17.** Ditulis **sebelum** E3 dijalankan ulang, bukan
sesudah — tidak ada satu pun angka E3 yang dilihat saat menyusun amandemen
ini. E1, E2, dan E4 sudah selesai dan terkunci; amandemen ini tidak
menyentuh keduanya.

### Latar

Percobaan E3 pada RUN_ID `20260916-161911-949ccf7` mati di run ke-17 dari
600. Mesinnya punya 13 GB RAM, dan Anvil dibunuh OOM killer:
`make: *** [Makefile.paper1:30: p1-anvil] Killed`. Direktori state Anvil
sempat membengkak sampai ~54 GB di disk.

Penyebabnya struktural, bukan kebetulan: E3 menjalankan 600 run (5 sel ×
4 nilai T × 30 repetisi), masing-masing sampai 2000 transaksi, **di atas
satu instance Anvil yang sama**. Rantainya tumbuh monoton sepanjang
kampanye sampai memori habis.

Bukti degradasinya terlihat di record sebelum mati
(`data/incidents/e3_partial_oom_0654.jsonl`, 17 record, semuanya
repetisi 0):

| # | cell | ops_completed | ops_failed | status |
|---|---|---|---|---|
| 2 | `e3.asc.deferred.T1000` | 900 | 100 | error |
| 7 | `e3.keccak.deferred.T1000` | 900 | 100 | error |
| 16 | `e3.keccak.deferred.T2000` | 1900 | 100 | error |
| 17 | `e3.merkle.inline.T2000` | 1000 | **1000** | error |

Run ke-17 kehilangan separuh operasinya tepat sebelum node mati.

### Alasan ilmiah

Ukuran rantai adalah **confound**. Dengan satu Anvil untuk 600 run,
keadaan awal tiap run tidak sama: sel yang kebetulan dijadwalkan belakangan
diukur di atas rantai yang jauh lebih besar dan node yang jauh lebih
terbebani. Throughput yang terukur kemudian turun karena **posisi dalam
antrean**, bukan karena primitif atau penempatan yang sedang dibandingkan —
persis jenis artefak urutan yang §3.4 sudah berusaha dihapus lewat
pengacakan urutan sel per repetisi. Pengacakan menyebar confound itu
merata, tetapi tidak menghilangkannya.

Karena itu setiap run sekarang dijalankan di atas **Anvil baru**: nyalakan
node, danai akun harness, deploy kontrak, ukur, matikan node, bersihkan
state-nya. Keadaan awal tiap run jadi identik, dan ukuran rantai berhenti
menjadi variabel. Jendela yang diukur tidak berubah: tetap hanya operasinya,
tanpa penyiapan.

Ini menyeragamkan keadaan awal — ia **tidak** mengubah apa yang diukur,
definisi metrik, rentang T, jumlah repetisi, ambang, atau uji statistik
mana pun. Bagian 1–5 dan Amandemen 1 di atas berlaku apa adanya untuk E3.

### Konsekuensi: E3 dibekukan terpisah

E3 dijalankan ulang dari nol dengan **RUN_ID dan tag sendiri**, terpisah
dari `20260916-161911-949ccf7` (tag `paper1-rev1-frozen`) yang memuat E1,
E2, dan E4. Dua dataset, dua direktori, masing-masing menunjuk commit-nya
sendiri — sengaja tidak digabung, supaya tiap angka tetap bisa ditelusuri
ke kode yang benar-benar menghasilkannya.

Pipeline analisis membaca E3 dari RUN_ID terpisah (`RUN_ID_E3` /
`--run-id-e3` di `analysis/*.py` dan `scripts/verify.sh`).

Alasan pemisahan ini dicatat di sini dan **akan disebut di bagian metode
paper**: E3 berjalan pada revisi harness yang lebih baru daripada E1/E2/E4,
dan pembacanya berhak tahu itu beserta alasannya.

### Penegasan

**E1, E2, dan E4 tidak diulang dan tidak diubah.** Datasetnya tetap di
`data/raw/20260916-161911-949ccf7/`, tetap read-only, tetap menunjuk tag
`paper1-rev1-frozen`. Perubahan siklus hidup Anvil hanya menyentuh
`bench/e3_throughput.ts`; tidak ada kontrak, rentang n, jumlah repetisi,
atau parameter beku yang berubah.

## Amandemen 3 — flush batch terakhir tiap run

**Tanggal: 2026-09-17.** Ditulis **sebelum** E3 dijalankan, sama seperti
Amandemen 2. Tidak ada angka E3 yang dilihat saat menyusunnya.

### Cacat

Dengan auto-mine, Anvil memproduksi blok ketika sebuah transaksi **masuk**.
Batch terakhir tiap run tidak punya transaksi penerus yang bisa menjadi
pemicu blok, sehingga menggantung sampai `BATCH_TIMEOUT_MS` (60 detik) dan
tercatat sebagai 100 ops gagal — di setiap run, di setiap sel.

Cacat ini sudah ada sebelumnya tetapi tersamarkan: pada node bersama yang
lama, trafik penyiapan sel berikutnya kebetulan menjadi pemicu itu.
Amandemen 2 (satu Anvil per run) menghapus penyamaran tersebut, sehingga
cacatnya muncul di setiap run.

### Bukti

Diambil langsung dari node saat sebuah batch menggantung:

| Pengamatan | Nilai | Artinya |
|---|---|---|
| status tx | `pending`, nonce 0 | diterima node, bukan nonce gap |
| gas limit tx | 280.000.000 | = `TRANSFER_BATCH_GAS` |
| block gas limit | 300.000.000 (konstan tiap blok) | dua tx 280M tidak muat dalam satu blok |
| base fee | turun, 1,0 → 0,167 gwei | **bukan** underpricing |
| produksi blok | berhenti total selama tx menunggu | tidak ada pemicu berikutnya |

### Perbaikan

Satu pemicu mine eksplisit (`evm_mine`) segera setelah batch terakhir
sebuah run **dikirim**. Aturannya seragam dan tanpa kekecualian:

- identik untuk **semua sel dan semua nilai T** — dipicu ketika jumlah
  transaksi terkirim mencapai `numBatches`, bukan berdasarkan sel, T, atau
  indeks batch tertentu;
- **tepat satu kali per run**, tidak pernah diulang. Kalau setelah flush
  masih ada ops yang gagal, itu dicatat apa adanya sebagai `ops_failed` —
  tidak ditambal dengan flush berulang;
- **jendela ukur tidak berubah**: tetap "batch pertama dikirim → receipt
  batch terakhir diterima". Flush terjadi di dalam jendela itu, sama
  seperti penantian receipt batch mana pun; jendela tidak dipotong maupun
  diperpanjang khusus untuk batch terakhir.

### Yang TIDAK diubah

`TRANSFER_BATCH_GAS` tetap **280.000.000**. Nilai itu sama untuk semua
sel, jadi ia tidak membiaskan perbandingan antarvarian; menurunkannya
setelah melihat hasil adalah penyetelan parameter pasca-hoc dan tidak bisa
dipertahankan. Rentang T, jumlah repetisi, K, B, C, W, ambang, dan seluruh
uji statistik juga tidak berubah.

### Catatan jujur untuk bagian metode

Karena gas limit per transaksi (280.000.000) jauh di atas kebutuhan nyata
sebuah batch (**~28,5 juta**, terukur dari `gasUsed` blok), **hanya satu
batch yang muat per blok**. Konsekuensinya, konkurensi C=3 tidak berarti
tiga batch diproses dalam satu blok: node tetap memprosesnya satu per
blok. Ini **dinyatakan sebagai konfigurasi pengukuran di bagian metode
paper**, bukan disembunyikan — angka throughput E3 harus dibaca sebagai
throughput di bawah konfigurasi ini, bukan sebagai batas atas sistem.

## Amandemen 4 — venue pengukuran dipisahkan dari layer protokol

*Ditambahkan 2026-09-17, **setelah** kampanye selesai dan kedua dataset
dibekukan.* Amandemen ini **tidak mengubah satu pun uji statistik, margin
ekuivalensi, daftar kontras, atau nilai terukur** (IRON RULE 6). Yang
diubah hanya **pelabelan di lapisan turunan** dan **aturan pemeriksaan
D6**. Data mentah tidak disentuh sama sekali.

### Temuan

Sepuluh record `e2.finalizeExit.slot_init` / `e2.finalizeExit.slot_update`
berlabel `layer: "L1"` ternyata **tidak diukur di Sepolia**, melainkan di
Anvil lokal. Buktinya di record itu sendiri: `block_number` bernilai
**107–108**, sementara seluruh record L1 lain berada di blok
**11.716.205–11.718.467**; `cast tx` atas hash-hash tersebut menjawab
`tx not found` di Sepolia; jarak antar-record ~1,6 detik, mustahil untuk
blok Sepolia ~12 detik.

Sebabnya sah dan memang terdokumentasi di docblock fungsi dan di field
`notes` tiap record: `finalizeExit` menuntut `evm_increaseTime` melewati
`EXIT_PERIOD`, yang tidak mungkin dilakukan di jaringan publik mana pun.

Empat pasang **hash kembar** di antara sepuluh record itu adalah
**konsekuensi wajar dari isolasi snapshot/revert di chain lokal**, bukan
pemakaian ulang hash dan bukan repetisi yang dilewati pengirimannya:
setiap repetisi dibungkus `evm_snapshot`/`evm_revert`, sehingga nonce,
`to`, calldata, dan gas limit identik; ECDSA Ethereum deterministik
(RFC 6979), jadi transaksi tertandatangani identik bit-per-bit dan
hash-nya pun identik. Transaksi baru tetap benar-benar dikirim pada setiap
repetisi — `tx_hash` dan `gas_used` tiap record berasal dari panggilan
`writeContract` dan receipt-nya sendiri, tanpa cabang dan tanpa cache.

Gas **88.723 identik di kesepuluh record** menunjukkan biaya
`finalizeExit` memang deterministik. **N=5 per sel tetap sah dengan
varians nol**: nol di sini adalah sifat operasi yang diukur, bukan gejala
sampel yang rusak.

### Keputusan

Tidak diukur ulang. Tidak ada record dibuang. Tidak ada salt ditambahkan
ke dataset yang sudah beku. Yang diperbaiki adalah pelabelan venue dan
aturan D6.

### Aturan turunan `venue` (normatif)

`analysis/common.py::venue_of()` menurunkan field baru `venue` untuk setiap
record. Field `layer` di `data/raw/` **tidak diubah**. Aturannya:

1. `block_number >= 1.000.000` → `venue = "sepolia"`; selain itu →
   `venue = "local"`. Record tanpa `block_number` sama sekali (eksekusi uji
   Foundry E4) → `"local"`, karena forge menjalankannya di EVM
   in-process.
2. **Korroborasi wajib, bukan opsional.** Record ber-`venue` `"local"`
   yang `layer`-nya `"L1"` dan punya `tx_hash` **harus** menjelaskan di
   `notes`-nya kenapa ia berjalan di luar jaringan publik (penanda:
   `local anvil`, `local devnet`, atau `not sepolia`). Record ber-`venue`
   `"sepolia"` **tidak boleh** mengaku lokal di `notes`. Kalau kedua
   sinyal bertentangan, fungsi ini **melempar `VenueConflict`** — tidak
   menebak, tidak memilih salah satu sinyal. Dataset sudah beku, jadi
   pertentangan berarti **aturannya** yang salah dan harus diturunkan
   ulang, bukan record yang diam-diam dipindah kelas.
3. Record `layer: "L2"` tidak dituntut penjelasan: seluruh L2 yang
   dievaluasi memang devnet Anvil (docs/EXPERIMENT_PRD.md §2.1), jadi
   lokal secara konstruksi.
4. `cell_venue()` menolak satu sel yang **bercampur** venue, karena
   rata-ratanya akan menggabungkan dua chain berbeda menjadi satu angka.

Ambang 1.000.000 tidak dapat disetel-setel: Sepolia berada di blok ≈11,72
juta saat kampanye berjalan (2026-09-16) dan Anvil selalu mulai dari blok
0. Dalam kedua dataset, **tidak ada satu pun record di antara blok 1.170
dan 11.716.074** — kedua populasi terpisah empat orde besaran.

Terapan pada dataset beku: **120 record `venue=sepolia`**, **10 record
`venue=local` ber-`layer` L1**, 5 record E4 di luar cakupan, dan 1.170
(+600 di dataset E3) record L2 yang lokal secara konstruksi.

### D6 dikaitkan ke venue

`scripts/verify.sh` D6 tidak lagi menuntut receipt untuk semua record L1:

- `venue = "sepolia"` → wajib punya `tx_hash` sah **dan** receipt di
  `data/receipts/<RUN_ID>/<hash>.json`.
- `venue = "local"` → receipt mustahil diambil (chain-nya sudah tidak
  ada), jadi yang diperiksa adalah yang memang bisa diperiksa: record
  punya `block_number`, punya `gas_used`, dan `notes`-nya menjelaskan
  kenapa pengukurannya lokal.
- Record E4 tetap di luar D6 (bukan transaksi chain sama sekali).

Ringkasan verify **selalu mencetak jumlah record per venue**, lolos atau
tidak, supaya angka itu terlihat dan tidak tersembunyi di balik status
PASS.

### Tabel memisahkan keduanya

`tab_op_gas.tex` blok L1 mendapat **kolom `Venue`** yang nilainya dibaca
dari kolom `venue` di CSV agregat — bukan ditulis tangan di
`make_tables.py`. Caption tabel L2 menyatakan venue-nya, juga diturunkan
dari data. Catatan kaki menjelaskan bahwa `finalizeExit` diukur di devnet
lokal karena memerlukan pemajuan waktu melewati masa tantangan exit.
Pembaca dapat melihat perbedaan itu tanpa membuka data mentah.

### Cacat yang tersingkap, untuk kampanye berikutnya

Dicatat di sini supaya tidak hilang; **tidak** diperbaiki pada dataset yang
sudah beku:

1. Penjaga duplikat `tx_hash` di `bench/harness/record.ts` hanya memeriksa
   `record.layer === "L2"`, sehingga sepuluh record `layer: "L1"` ini lolos
   tanpa peringatan sama sekali.
2. Perbaikan salt `maxPriorityFeePerGas` yang dulu dibuat untuk cacat
   provenance tx di E1 hanya diterapkan ke `bench/e1_commit_cost.ts` dan
   **tidak pernah dibawa** ke jalur `finalizeExit` di `bench/e2_sync_gas.ts`.

## Riwayat perubahan

- 2026-09-17: Amandemen 4 ditambahkan — venue pengukuran (`sepolia` /
  `local`) diturunkan terpisah dari `layer` protokol; D6 dikaitkan ke
  venue; `tab_op_gas` menandai venue tiap operasi. Dipicu temuan sepuluh
  record `e2.finalizeExit` berlabel L1 yang ternyata diukur di Anvil.
  Ditulis **setelah** kampanye; tidak mengubah uji, margin, kontras, atau
  nilai terukur mana pun — hanya pelabelan turunan dan aturan pemeriksaan.
- 2026-09-17: Amandemen 3 ditambahkan — flush eksplisit satu kali setelah
  batch terakhir tiap run (cacat auto-mine tanpa transaksi penerus),
  seragam di semua sel dan nilai T. `TRANSFER_BATCH_GAS` sengaja tidak
  diubah. Ditulis sebelum E3 dijalankan.
- 2026-09-17: Amandemen 2 ditambahkan — E3 dijalankan ulang dengan satu
  Anvil per run (menghapus confound ukuran rantai setelah OOM di run ke-17
  dari 600, mesin 13 GB) dan dibekukan terpisah dengan RUN_ID + tag
  sendiri. E1, E2, E4 tidak diulang dan tidak diubah. Ditulis sebelum E3
  dijalankan.
- 2026-09-15: Amandemen 1 ditambahkan — perbandingan net-of-baseline untuk
  `bench.commit_*` (TOST/Holm/bootstrap atas delta, bukan gas absolut) dan
  ambang kelayakan blok 36.000.000 gas, dipicu temuan struktural dari
  pilot 16-18 record yang dibuang (RUN_ID `20260914-225925-b62f671`,
  bukan hasil kampanye). Lihat bagian "Amandemen 1" di atas.
- 2026-09-14: dibuat, dibekukan sebelum kampanye penuh (T8, docs/TICKETS.md).
