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

## Riwayat perubahan

- 2026-09-14: dibuat, dibekukan sebelum kampanye penuh (T8, docs/TICKETS.md).
