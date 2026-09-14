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

## Riwayat perubahan

- 2026-09-15: Amandemen 1 ditambahkan — perbandingan net-of-baseline untuk
  `bench.commit_*` (TOST/Holm/bootstrap atas delta, bukan gas absolut) dan
  ambang kelayakan blok 36.000.000 gas, dipicu temuan struktural dari
  pilot 16-18 record yang dibuang (RUN_ID `20260914-225925-b62f671`,
  bukan hasil kampanye). Lihat bagian "Amandemen 1" di atas.
- 2026-09-14: dibuat, dibekukan sebelum kampanye penuh (T8, docs/TICKETS.md).
