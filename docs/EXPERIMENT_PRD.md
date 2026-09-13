# PRD Eksperimen — Paper 1 Revisi (Negative Result)

**Dokumen:** Product/Experiment Requirements Document
**Versi:** 1.0 — 12 September 2026
**Pemilik:** Faldi (UGM / UMKT)
**Terkait:** `main_rev1.tex` (draft revisi), `REVISION_ROADMAP.md`, `CATATAN REVIEWER.md`
**Repo:** `github.com/faldi21/plasma-ecc-OK`

---

## 0. Ringkasan dan Definition of Done

Draft revisi memuat **50 penanda `\fillin{}`**. PRD ini menetapkan eksperimen E1–E6 yang mengisi semuanya, beserta metodologi yang diminta reviewer (R1-5, R1-6, R1-7, R1-9, R1-13, R1-17, R2-M6, R2-M7, R2-M8).

**Definition of Done (seluruh paket):**

| # | Kriteria | Cara verifikasi |
|---|---|---|
| D1 | Semua 50 `\fillin{}` terisi dari satu *frozen dataset* | `grep -c '\\fillin' main_rev1.tex` = 0 |
| D2 | Semua tabel/gambar hasil digenerate otomatis dari data mentah | `make tables` menghasilkan file `.tex` identik dengan yang ada di paper |
| D3 | Tidak ada angka hasil yang diketik manual di `main_rev1.tex` | Tabel hasil di-`\input{}`, bukan ditulis inline |
| D4 | Data mentah level-run tersedia (bukan hanya agregat) | `data/raw/*.jsonl` berisi ≥ N baris per sel |
| D5 | Exploit A1 dan A2 punya test yang gagal/berhasil sesuai klaim paper | `forge test` hijau dengan nama test yang disebut di paper |
| D6 | Semua nomor L1 dapat ditelusuri ke receipt Sepolia | Kolom `tx_hash` terisi dan dapat dibuka di etherscan |
| D7 | Ada tag rilis + arsip Zenodo yang immutable | DOI aktif, tag terkunci |

**Aturan utama (jangan dilanggar):**

1. **Satu dataset beku.** Semua angka di abstrak, tabel, gambar, diskusi, dan kesimpulan berasal dari satu `RUN_ID`. Jika ada satu sel diulang, seluruh kampanye dijalankan ulang atau `RUN_ID` diberi versi baru. (R1-9)
2. **Kode dibekukan sebelum diukur.** Tag rilis dibuat lebih dulu; pengukuran memakai tag itu. Tidak ada perubahan kontrak di tengah kampanye. (R1-13)
3. **Angka lama dilarang dipakai.** 165M, 8,5M, 2.373, 2.294, 8,11, 125 ms, 301.558 — semuanya harus diukur ulang. Nilai lama hanya ada sebagai komentar di `main_rev1.tex` untuk pembanding sanity check.
4. **Analysis plan dibekukan sebelum melihat hasil**, termasuk margin ekuivalensi ε (Bagian 7.4).

---

## 1. Struktur repositori dan artefak

```
plasma-ecc-OK/
├─ contracts/
│  ├─ src/
│  │  ├─ RootChainUTXO.sol              # L1, tidak diubah selain fix A1 (branch terpisah)
│  │  ├─ PlasmaChainUTXO.sol            # L2
│  │  ├─ commit/                         # <-- BARU: 6 varian commit
│  │  │  ├─ ICommitStrategy.sol
│  │  │  ├─ CommitASCNaive.sol
│  │  │  ├─ CommitASC1SM.sol
│  │  │  ├─ CommitASCEcrecover.sol
│  │  │  ├─ CommitScalar.sol
│  │  │  ├─ CommitKeccak.sol
│  │  │  ├─ CommitMerkle.sol
│  │  │  └─ CommitBaseline.sol          # kontrol: hanya baca pending, tanpa digest
│  │  └─ libraries/ECCAccumulator.sol
│  └─ test/
│     ├─ ExploitA1_ExitGriefing.t.sol
│     ├─ ExploitA2_UnbackedExit.t.sol
│     ├─ PropVacuity.t.sol
│     ├─ PropNonBinding.t.sol
│     └─ FixA1_BoundChallenge.t.sol      # opsional, kalau fix dikerjakan
├─ bench/
│  ├─ e1_commit_cost.ts
│  ├─ e2_sync_gas.ts
│  ├─ e3_throughput.ts
│  ├─ e6_pipeline.ts                     # opsional
│  ├─ harness/{runner.ts,record.ts,anvil.ts,accounts.ts,rng.ts}
│  └─ config/manifest.json               # definisi sel + jumlah run
├─ data/
│  ├─ raw/<RUN_ID>/*.jsonl               # satu baris per run, immutable
│  ├─ receipts/<RUN_ID>/*.json           # receipt L1 lengkap
│  └─ processed/<RUN_ID>/*.csv           # hasil agregasi
├─ analysis/
│  ├─ aggregate.py                       # raw -> processed
│  ├─ stats.py                           # uji statistik
│  ├─ make_tables.py                     # processed -> paper/tables/*.tex
│  └─ make_figures.py                    # processed -> paper/figures/*.pdf
├─ paper/
│  ├─ tables/{tab_commit_cost.tex,tab_op_gas.tex,tab_throughput.tex,tab_exploits.tex,tab_params.tex}
│  └─ figures/fig_throughput.pdf
├─ ANALYSIS_PLAN.md                      # dibekukan sebelum run (Bagian 7.4)
├─ Makefile
└─ README.md
```

`Makefile` minimal:

```make
freeze:    ## tag + catat commit hash ke data/raw/<RUN_ID>/manifest.json
e1 e2 e3:  ## jalankan kampanye, tulis ke data/raw/<RUN_ID>/
tables:    ## analysis/make_tables.py + make_figures.py -> paper/
verify:    ## cek D1-D7
```

---

## 2. Spesifikasi lingkungan (dicatat otomatis di manifest tiap run)

| Item | Nilai | Cara ambil |
|---|---|---|
| CPU / RAM / OS | Ryzen 7 5800H, 16 GB, Ubuntu (versi persis) | `lscpu`, `free -g`, `lsb_release -d` |
| Foundry / Anvil | versi + commit | `anvil --version` |
| Solc | 0.8.30, via-IR, optimizer 200 | `foundry.toml` di-hash |
| Node.js / viem / elliptic | versi persis | `package-lock.json` di-hash |
| Governor CPU | `performance`, turbo state dicatat | `cpupower frequency-info` |
| Beban latar | idle, tidak ada VS Code / browser | catat `uptime` load average sebelum run |
| L1 | Sepolia, chainId 11155111 | `eth_chainId` |
| L2 | Anvil lokal, `--block-time 0` (auto-mine), gas limit 3e8 | argumen anvil dicatat penuh |

Aturan: **matikan hal yang bikin variansi** (VS Code, sinkron OneDrive, update otomatis). Reviewer akan melihat SD dan CI; noise tinggi merusak kesimpulan.

---

## 3. Harness bersama

### 3.1 Identitas run

```
RUN_ID   = YYYYMMDD-HHMMSS-<git short hash>      # contoh: 20260920-141233-a3f19c2
CELL_ID  = <experiment>.<variant>[.<n|T>]        # contoh: e1.asc_1sm.n100, e3.merkle.deferred.T2000
```

### 3.2 Skema record mentah (JSONL, satu baris per run)

Wajib sama untuk semua eksperimen; field yang tidak relevan diisi `null`.
Diperluas (bench/harness/record.ts, harness fix pasca-T5) dengan tiga field
opsional dan satu perluasan `status` -- semua tambahan bersifat aditif,
tidak mengubah makna field yang sudah ada:

- **`status`** sekarang salah satu dari `"ok"`, `"error"`,
  `"exceeds_block_gas_limit"`, `"pass"`, `"fail"`.
  `"exceeds_block_gas_limit"` adalah **hasil pengukuran**, bukan kegagalan
  harness: dipakai oleh sel `e1.*`/`sys.*` ketika `createBlock()` butuh gas
  lebih besar dari batas blok node yang sedang dipakai (dicek via
  `eth_estimateGas` **sebelum** mengirim transaksi -- kalau estimasi saja
  sudah ditolak node, transaksi TIDAK PERNAH dikirim, dan batas gas node
  TIDAK PERNAH dinaikkan hanya supaya sel itu "lolos"). `"pass"`/`"fail"`
  dipakai sel `e4.*` (exploit/property test), mencerminkan hasil assertion
  Foundry, bukan status transaksi.
- **`setup_tx_count`** (number\|null): untuk sel `e1.*`/`sys.*`, jumlah
  transaksi pada fase setup (funding via `createDepositUtxoBatch`) yang
  TIDAK ikut terukur di `duration_ms`/`gas_used` cell itu sendiri. Fase
  setup boleh dipecah jadi beberapa transaksi supaya masing-masing muat di
  bawah batas gas blok yang sama dengan yang membatasi `createBlock()`
  yang diukur.
- **`test_name`** (string\|null) dan **`assert_result`**
  (`"pass"`\|`"fail"`\|null): untuk sel `e4.*`, nama fungsi test Foundry
  dan hasil assertion-nya secara eksplisit -- redundan dengan
  `cell_id`/`status` menurut konvensi penamaan, tapi field terpisah supaya
  pembaca tidak perlu tahu konvensi itu untuk menemukannya.

**Pemisahan E1 vs E3 (wajib, harness fix pasca-T5):** sel yang mengukur
biaya `createBlock()` memakai prefix `e1.`/`sys.` dan mengisi
`function`/`n_elements`/`gas_used`/`gas_limit`; sel throughput memakai
prefix `e3.` dan mengisi `ops_completed`/`ops_failed`/`ops_retried`/
`latency_ms`, dengan `function`/`n_elements`/`gas_used` selalu `null`.
Jendela waktu sel `e3.*` = dari transaksi batch pertama dikirim sampai
receipt batch terakhir diterima -- **`createBlock()` tidak pernah
dipanggil di dalam jendela itu, atau di skrip E3 sama sekali.** Kalau
sebuah cell melakukan setup yang tidak boleh ikut terukur (deploy
kontrak, funding), ia mengoper `duration_ms` sendiri lewat
`CellResult.duration_ms` (bench/harness/runner.ts) untuk menimpa waktu
total `cell.fn()` yang diukur harness secara default.

```json
{
  "run_id": "20260920-141233-a3f19c2",
  "cell_id": "e1.asc_1sm.n100",
  "repetition": 7,
  "seed": 918273,
  "started_at": "2026-09-20T14:20:03.114Z",
  "duration_ms": 843.2,
  "layer": "L2",
  "function": "createBlock",
  "n_elements": 100,
  "gas_used": 1712043,
  "gas_limit": 300000000,
  "calldata_bytes": 132,
  "calldata_zero_bytes": 61,
  "calldata_nonzero_bytes": 71,
  "tx_count": 1,
  "tx_hash": "0x...",
  "block_number": 6421991,
  "ops_completed": 2000,
  "ops_failed": 0,
  "ops_retried": 0,
  "latency_ms": [12.1, 11.8, "..."],
  "status": "ok",
  "notes": null,
  "env_hash": "sha256:...",
  "setup_tx_count": 1,
  "test_name": null,
  "assert_result": null
}
```

Aturan: **jangan pernah menimpa file mentah**. Satu kampanye = satu direktori `data/raw/<RUN_ID>/`, read-only setelah selesai (`chmod -w`).

### 3.3 Isolasi antar-run

```
1. anvil_reset / evm_snapshot sebelum run     -> state awal identik
2. warm-up W batch (dibuang, tidak dicatat)
3. jalankan konfigurasi
4. catat record
5. evm_revert ke snapshot
```

Untuk pengukuran gas: **cold vs warm storage penting**. Tetapkan satu kebijakan dan tulis di paper: setiap run mengukur dari state yang sama persis setelah `evm_revert`, sehingga status cold/warm slot identik antar-varian. (Kalau tidak, ASC vs Merkle bisa beda hanya karena slot sudah warm.)

### 3.4 Randomisasi urutan (R1-6, R2-M8)

```ts
// satu repetisi = satu putaran atas SEMUA sel, urutan diacak
for (let r = 0; r < N; r++) {
  const cells = shuffle(allCells, seedFor(r));   // seed deterministik, dicatat
  for (const c of cells) { await runCell(c, r); }
}
```
Ini menghilangkan drift waktu dan efek urutan — persis keberatan reviewer terhadap deret non-monoton 2.000; 2.000; 2.373; 2.294.

---

## 4. E1 — Biaya commit per varian (RQ3)

**Menjawab:** R2-M6 (165M gas salah ~100×), R1-5 (pisah L2/L1), R1-18 (chunking), R2-m5 (ukuran digest).
**Mengisi:** Tabel `tab:commit-cost`, abstrak `\fillin{naive gas}`/`\fillin{1-SM gas}`, kesimpulan `\fillin{X}`/`\fillin{Y}`.

### 4.1 Varian yang harus diimplementasikan

Semua varian mengimplementasikan antarmuka yang sama dan dipanggil dari jalur `createBlock` yang sama, agar hanya langkah digest yang berbeda.

```solidity
interface ICommitStrategy {
    /// @param ids daftar UTXO id pending untuk blok ini
    /// @param hint data bantu opsional (dipakai varian ecrecover)
    /// @return digest komitmen blok yang akan dikirim ke L1
    function commit(uint256[] calldata ids, bytes calldata hint)
        external returns (bytes32[2] memory digest);
}
```

| Varian | Spesifikasi | Catatan |
|---|---|---|
| `CommitBaseline` | baca `ids`, jumlahkan panjang, tidak menghitung digest | **kontrol**: biaya dasar storage-read; semua varian lain dikurangi nilai ini untuk melihat biaya primitifnya |
| `CommitASCNaive` | untuk tiap `e`: `A = pointAdd(A, scalarMul(G, e mod N))` | kode lama apa adanya |
| `CommitASC1SM` | `s = addmod(s, e, N)` untuk tiap `e`; lalu `A = scalarMul(G, s)` sekali | koreksi R2-M6 |
| `CommitASCEcrecover` | `s` seperti di atas; `A` dikirim operator lewat `hint`; kontrak memverifikasi `A == s·G` dengan trik ecrecover | lihat 4.2 |
| `CommitScalar` | simpan `s` (32 byte), tanpa titik kurva | batas bawah teoretis untuk ASC |
| `CommitKeccak` | cek `ids` menaik ketat, `keccak256(abi.encodePacked(ids))` | binding, 32 byte |
| `CommitMerkle` | OpenZeppelin 5.5.0 `Bytes32PushTree`, depth 20, keccak komutatif | baseline |

### 4.2 Detail trik ecrecover (harus diverifikasi sendiri sebelum dipakai)

`ecrecover(h, v, r, s)` mengembalikan alamat dari titik `Q = r⁻¹ (s·R − h·G)`, dengan `R` titik ber-absis `r`.
Ambil `h = 0`, `r = Gx`, `R = G` (pilih `v` sesuai paritas `Gy`), dan `s = mulmod(k, Gx, N)`. Maka

```
Q = Gx⁻¹ · (k·Gx) · G = k·G
```

sehingga `ecrecover` memberi `address(k·G)` dengan biaya precompile 3.000 gas.

```solidity
// Verifikasi A == k*G tanpa scalarMul in-Solidity.
function eqScalarMulG(uint256 k, uint256 ax, uint256 ay) internal pure returns (bool) {
    require(k != 0 && k < N, "k out of range");
    address expected = address(uint160(uint256(keccak256(abi.encodePacked(ax, ay)))));
    address got = ecrecover(
        bytes32(0),
        V_FOR_G,                       // 27 atau 28 sesuai paritas Gy
        bytes32(GX),
        bytes32(mulmod(k, GX, N))
    );
    return got != address(0) && got == expected;
}
```

Catat dua hal di paper (jujur, jangan disembunyikan):
- Verifikasi ini menyamakan **alamat** (160 bit), bukan titik penuh; sebutkan implikasinya.
- Titik `A` harus dikirim sebagai calldata (≈64 byte), jadi hitung juga biaya calldata-nya.

**Sebelum dipakai:** tulis unit test yang membandingkan `eqScalarMulG(k, A.x, A.y)` dengan `scalarMul` referensi untuk ≥ 100 nilai `k` acak, termasuk `k = 1`, `k = N−1`. Kalau tidak cocok, laporkan apa adanya dan buang varian ini.

### 4.3 Prosedur

```
untuk n in {10, 100, 1000}:
  untuk varian in {baseline, asc_naive, asc_1sm, asc_ecrecover, scalar, keccak, merkle}:
    N repetisi:
      - siapkan n UTXO pending (isi deterministik, seed dicatat)
      - ukur gas createBlock di L2  (gasUsed dari receipt)
      - ukur gas + calldata + jumlah tx submitBlock di L1 Sepolia (n = 100 saja)
      - kalau perlu chunking: catat jumlah tx dan gas tiap chunk, jumlahkan
```

Catatan biaya: L1 Sepolia untuk `n = 100` × 7 varian × N repetisi bisa mahal dalam waktu. **Kompromi yang diperbolehkan dan harus disebut di paper:** L1 diukur dengan `N_L1 = 5` repetisi (gas L1 hampir deterministik), sementara L2 pakai `N ≥ 30`. Sebutkan dua N berbeda itu eksplisit di caption tabel.

### 4.4 Output → paper

| Kolom tabel `tab:commit-cost` | Field data |
|---|---|
| L2 construction gas (n=10/100/1000) | `mean(gas_used)` ± SD, filter `layer=L2, function=createBlock` |
| L1 anchoring gas | `sum(gas_used)` per blok, filter `layer=L1, function=submitBlock` |
| calldata (B) | `calldata_bytes` |
| L1 txs | `tx_count` |

Tambahan yang harus dilaporkan di teks: rasio `asc_naive / asc_1sm`, rasio `asc_1sm / keccak`, dan `asc_1sm − baseline` (biaya bersih primitif).

### 4.5 Kriteria terima

- Semua varian menghasilkan digest yang bisa diverifikasi ulang off-chain (cek paritas TypeScript vs Solidity).
- SD gas L2 < 1% dari mean (kalau tidak, ada sumber non-determinisme yang harus dijelaskan).
- `asc_naive` reproduksi ordo besaran lama (~10⁸ gas di n=100). Kalau jauh berbeda dari kampanye lama, selidiki sebelum lanjut.

### 4.6 Dua sel sistem tambahan: `sys.plasma_v0` vs `sys.plasma_eccmath`

**Latar belakang:** verifikasi terpisah (`docs/ECCMATH_REFACTOR_GAS.md`)
menemukan bahwa ekstraksi `ECCMath.sol` (T1+T2, commit `a5c5991`) mengubah
gas `PlasmaChainUTXO.createBlock()` secara signifikan (-16.58% di n=10,
-39.25% di n=100) walau hasilnya (nilai `accumulatorValue`) identik —
diduga karena penghapusan alokasi memori heap `Point memory` berulang di
dalam loop 256-iterasi `scalarMul`, yang biayanya kuadratik terhadap total
memori per-transaksi.

**Keputusan:** kampanye E1 mengukur **kedua** versi sebagai sel terpisah,
bukan memilih salah satu:

| Sel | Kontrak | Fungsi diukur |
|---|---|---|
| `sys.plasma_v0` | `contracts/src/legacy/PlasmaChainUTXOV0.sol` | `createBlock()` |
| `sys.plasma_eccmath` | `contracts/src/PlasmaChainUTXO.sol` (saat ini) | `createBlock()` |

`PlasmaChainUTXOV0.sol` dan `ECCAccumulatorV0.sol` adalah salinan verbatim
dari commit `9fdd117` (pra-ekstraksi `ECCMath`), di-vendor ke
`contracts/src/legacy/`. Lihat header masing-masing file untuk detail
persis baris mana yang berbeda dari commit aslinya (nol untuk
`ECCAccumulatorV0.sol`; dua baris — import path dan nama contract — untuk
`PlasmaChainUTXOV0.sol`, keduanya wajib secara teknis untuk menghindari
tabrakan nama kompilasi dengan kontrak yang sedang berjalan). Kesetaraan
**nilai** (bukan biaya) sudah dibuktikan di `contracts/test/
PlasmaChainUTXOV0Parity.t.sol` untuk n ∈ {1, 10, 100}.

**⚠️ Konteks berbeda dari 7 sel bench (4.1–4.5) — jangan dibandingkan
lintas konteks:**

| | Sel bench (`bench.commit_*`) | Sel sistem (`sys.plasma_*`) |
|---|---|---|
| Tujuan | Mengisolasi biaya **primitif kriptografi** (digest step murni) | Mengukur biaya **sistem nyata yang di-deploy** |
| `ECCMath.sol` dipakai? | Ya, di semua varian ASC — kode baru, tugasnya isolasi algoritma | Hanya di `sys.plasma_eccmath`; `sys.plasma_v0` sengaja TIDAK pakai (meniru tata letak memori lama apa adanya) |
| Storage/fungsi sekitar | Minimal, tujuh kontrak tipis, tanpa logika UTXO/exit/transfer lain | Kontrak penuh `PlasmaChainUTXO`, termasuk seluruh state UTXO/transfer/withdrawal yang tidak diukur `bench.*` |
| Bisa dibandingkan gas absolut dengan sel lain di tabel yang sama? | Ya, sesama `bench.*` | Ya, sesama `sys.*` (`sys.plasma_v0` vs `sys.plasma_eccmath`) |
| Bisa dibandingkan gas absolut `bench.*` vs `sys.*`? | **Tidak.** Konteks eksekusi berbeda (kontrak minimal vs kontrak penuh) — angka `bench.commit_asc_naive` TIDAK dimaksudkan sama dengan bagian `accumulator.add()` di dalam `sys.plasma_eccmath`, meski algoritmanya sama. | (idem) |

Kalau paper mengutip kedua kelompok sel, harus eksplisit menyebut mana
yang mana dan mengapa tidak diperbandingkan langsung (lihat tabel di atas).

**Prosedur (RQ tambahan: apakah selisih `sys.plasma_v0` vs
`sys.plasma_eccmath` tumbuh superlinear terhadap n, sesuai hipotesis
memory-expansion?):**

```
untuk n in {10, 25, 50, 100, 200}:
  untuk sel in {sys.plasma_v0, sys.plasma_eccmath}:
    N repetisi (sama seperti 4.1–4.5, N >= 30 untuk L2):
      - deploy kontrak segar
      - isi n UTXO pending via createDepositUtxoBatch, dipecah jadi
        beberapa transaksi setup kalau perlu supaya tiap transaksi muat
        di bawah batas gas blok node (catat jumlah transaksi setup)
      - estimasi gas createBlock() lebih dulu (eth_estimateGas) TANPA
        mengirim transaksi; kalau estimasi > batas gas blok node yang
        sedang dipakai (lihat manifest: `anvil_launch_args`), catat
        status "exceeds_block_gas_limit" dan lanjut ke repetisi/sel
        berikutnya -- JANGAN naikkan batas gas node hanya supaya sel itu
        lolos (batas itu sendiri bagian dari objek ukur)
      - kalau muat: kirim transaksi, ukur gas createBlock() (gasUsed dari
        receipt)
      - kalau bisa diambil: catat jumlah word memori puncak (MSIZE sebelum
        return, atau dari trace -vvvv/debug_traceTransaction kalau tersedia
        di Anvil) untuk pemeriksaan langsung hipotesis kuadratik, bukan
        cuma dugaan dari pola gas
```

**Implikasi nyata untuk `sys.plasma_v0` di n besar:** `PlasmaChainUTXOV0.sol`
masih memanggil `accumulator.add()` per elemen (O(n) scalarMul, seperti
`sys.plasma_eccmath` sebelum diperbaiki M6). Dengan batas gas blok node
yang sebenarnya (mis. 300.000.000, dicatat di manifest), sel `sys.plasma_v0`
pada n yang cukup besar **diperkirakan** akan menghasilkan
`status: "exceeds_block_gas_limit"`, bukan angka gas — ini valid dan
diharapkan, bukan kegagalan kampanye. Tabel hasil (`tab:commit-cost`) harus
melaporkan pada n berapa titik ini terjadi untuk tiap sel, bukan
menyembunyikannya dengan menaikkan batas gas hanya untuk sel itu.

**Kriteria terima tambahan:**

- Kalau hipotesis memory-expansion benar: `(gas_v0[n] − gas_eccmath[n])`
  harus tumbuh **lebih cepat dari linear** terhadap n (mis. rasio
  `Δgas[200] / Δgas[10]` jauh lebih besar dari `200/10 = 20`). Kalau
  ternyata linear atau sublinear, hipotesis di `docs/ECCMATH_REFACTOR_GAS.md`
  salah dan perlu direvisi — laporkan apa adanya, jangan dipaksakan cocok.
- `sys.plasma_v0` di n=100 harus reproduksi ordo besaran yang sudah
  diverifikasi manual di `docs/ECCMATH_REFACTOR_GAS.md` (155,135,414 gas,
  dari pengukuran satu-kali di luar kampanye resmi) dalam toleransi wajar
  (variasi struktur data `_ids`/seed bisa geser angka sedikit, tapi ordo
  besarannya — puluhan hingga ratusan juta gas — harus konsisten).

---

## 5. E2 — Overhead sinkronisasi L1 (RQ3, dilema A3)

**Menjawab:** R2-M5 ("Tabel 5 menghilangkan biaya sync L1"), R1-5.
**Mengisi:** Tabel `tab:op-gas`.

Ukur gas per pemanggilan, masing-masing N repetisi, **cold-state dan warm-state dicatat terpisah**:

| Fungsi | Layer | Parameter uji |
|---|---|---|
| `deposit` / `depositETH` | L1 | 1 UTXO |
| `createDepositUtxo` (relay) | L2 | 1 UTXO |
| `transferUtxoBatch` | L2 | B = 100, dilaporkan per operasi dan per tx |
| `syncUtxoSpent` | L1 | 1 UTXO |
| `batchSyncUtxoSpent` | L1 | 10 / 50 / 100 UTXO → laporkan per-UTXO |
| `updateUtxoBlock` | L1 | 1 UTXO |
| `registerExitUtxo` | L1 | 1 exit UTXO |
| `startExit` | L1 | dengan witness 64 B |
| `finalizeExit` | L1 | setelah EXIT_PERIOD (pakai `evm_increaseTime` di fork lokal Sepolia kalau perlu) |

**Turunan wajib:** biaya L1 amortisasi per transfer L2 =
`(gas submitBlock + Σ gas sync per blok) / jumlah transfer per blok`.
Angka ini yang menjawab keberatan "premis skaling gugur". Laporkan untuk n = 100.

---

## 6. E3 — Throughput faktorial 2×2 + kontrol (RQ4)

**Menjawab:** R1-7, R2-M7, R1-8, R2-M8, R1-6, R1-20.
**Mengisi:** Tabel `tab:throughput`, Gambar `fig:throughput`, `\fillin{K}`, `\fillin{W}`, `\fillin{N≥30}`, `\fillin{ε}`, statistik ANOVA, `\fillin{ratio}`, `\fillin{X}%` di abstrak.

### 6.1 Desain

| Faktor | Level |
|---|---|
| Primitive | ASC, Merkle |
| Placement | inline (update tiap transfer), deferred (update di block boundary) |
| Kontrol | Keccak digest × deferred |

5 sel × 4 nilai T {500, 1.000, 1.500, 2.000} × N ≥ 30 repetisi = ≥ 600 run. Estimasi durasi: 1 run ≈ 1–3 detik + reset; total sekitar 1–2 jam per kampanye penuh. Bisa ditambah.

**Catatan penting:** untuk sel `ASC × inline` gunakan **dua sub-varian** kalau memungkinkan: `inline-naive` (scalarMul per transfer, ini yang dulu menghasilkan 8,11 ops/s) dan `inline-1SM` (`addmod` per transfer). Kalau `inline-1SM` ternyata nyaris sama cepat dengan deferred, itu bukti tambahan yang kuat bahwa "deferred commitment" bukan kontribusi — sangat sejalan dengan framing paper.

### 6.2 Parameter workload

| Parameter | Nilai | Alasan |
|---|---|---|
| K akun pengirim | **≥ 20** (bukan 3) | R3 minta workload representatif |
| Pola | pasangan pengirim–penerima acak seragam, seed dicatat | menghindari pola sirkular yang tidak realistis |
| B (batch) | 100 | sama dengan kampanye lama, agar bisa dibandingkan |
| C (konkurensi) | 3 | idem; catat bahwa ini parameter, bukan temuan |
| W (warm-up) | **3 batch** | buang efek JIT/koneksi |
| T | 500, 1.000, 1.500, 2.000 | idem kampanye lama |

### 6.3 Metrik dan definisinya (R1-7)

| Metrik | Definisi operasional |
|---|---|
| `ops/s` | jumlah transfer UTXO logis yang sukses ÷ wall-clock dari submit batch pertama sampai receipt batch terakhir |
| `L2 tx/s` | jumlah transaksi L2 terkirim ÷ wall-clock yang sama (= ops/s ÷ B) |
| `latency` | per batch: submit → receipt; dilaporkan median dan p95, **bukan** hanya mean |
| `ops_failed`, `ops_retried` | dihitung dari `Promise.allSettled` + revert |

Di paper: jangan pernah menyebutnya "TPS" tanpa kualifikasi. Gunakan "hot-path UTXO operations/s".

### 6.4 Ukur durasi dengan benar

Masalah di kampanye lama: durasi 0,25 s dan 0,50 s yang terlalu bulat menandakan resolusi/pembulatan waktu yang buruk.

```ts
const t0 = process.hrtime.bigint();
...
const t1 = process.hrtime.bigint();
const durationMs = Number(t1 - t0) / 1e6;   // simpan dengan 3 desimal, jangan dibulatkan
```

---

## 7. Rencana analisis statistik (dibekukan sebelum run)

Tulis ini ke `ANALYSIS_PLAN.md` dan commit **sebelum** kampanye dijalankan; sebut di paper bahwa rencananya dibekukan lebih dulu.

### 7.1 Statistik deskriptif (semua sel)
mean, SD, median, p95, min, max, N, CI 95% mean (t-student), jumlah gagal/retry.

### 7.2 Uji utama
- **Two-way ANOVA** pada `ops/s` untuk T = 2.000: efek utama Primitive, efek utama Placement, interaksi. Laporkan F, df, p, partial η².
- **Kontras utama RQ4:** ASC-deferred vs Merkle-deferred → Welch t-test + Mann-Whitney U + Cohen's d + CI selisih.
- **Kontras placement:** ASC-inline vs ASC-deferred → rasio + CI (bootstrap 10.000 resample).
- **Koreksi ganda:** Holm across semua kontras yang dilaporkan dalam satu tabel.

### 7.3 Asumsi
Cek normalitas (Shapiro–Wilk) dan homoskedastisitas (Levene). Kalau dilanggar: laporkan Welch/Mann-Whitney sebagai uji utama dan ANOVA sebagai sekunder. Jangan diam-diam mengganti uji setelah melihat p.

### 7.4 Margin ekuivalensi ε (wajib, R1-6)
Reviewer melarang klaim "statistically indistinguishable" tanpa uji. Tetapkan **sebelum** analisis:

> ε = 3% dari mean sel referensi (Merkle-deferred). Dua sel disebut *praktis setara* hanya jika CI 95% selisih relatif seluruhnya berada dalam ±ε (TOST, two one-sided tests, α = 0,05).

Kalau tidak setara dan tidak berbeda signifikan → tulis "tidak dapat disimpulkan pada N ini", bukan "setara".

### 7.5 Skrip
`analysis/stats.py` (scipy + statsmodels) membaca `data/processed/<RUN_ID>/*.csv` dan menulis `data/processed/<RUN_ID>/stats.json`; `make_tables.py` hanya membaca `stats.json` — tidak ada perhitungan di dalam template tabel.

---

## 8. E4 — Test case exploit (RQ2)

**Menjawab:** R1-1, R1-2, R2-M4, R3.
**Mengisi:** Tabel `tab:exploits`, `\fillin{gas}` di Serangan A1, `\fillin{test file name and commit}`.

| Test | File | Isi | Hasil yang diharapkan |
|---|---|---|---|
| T1 | `ExploitA1_ExitGriefing.t.sol` | user jujur `startExit`; attacker (address acak, bukan operator) memilih τ acak, hitung `W = A_bs − τ·G`, panggil `challengeExitWithSpendProof` | challenge **berhasil**, exit dibatalkan, `spent(utxoId) == true`, catat gas |
| T2 | `ExploitA2_UnbackedExit.t.sol` | operator `registerExitUtxo` untuk UTXO yang tidak pernah didepositkan, lalu exit + finalize | penarikan **berhasil**, catat nilai yang tertarik |
| T3 | `PropVacuity.t.sol` | untuk 100 nilai `e` acak yang tidak pernah ditambahkan, `verifyWithAccumulator(e, A_b − e·G, A_b)` | **selalu true** |
| T4 | `PropNonBinding.t.sol` | bangun S dan S′ = S dengan `e_i+δ`, `e_j−δ`; juga konstruksi T ∪ {e\*} | digest **identik** |
| T5 (opsional) | `FixA1_BoundChallenge.t.sol` | versi kontrak yang mewajibkan tx bytes + Merkle inclusion + input berisi utxoId + signature owner | T1 **revert**, challenge sah tetap berhasil |

Aturan penulisan test: nama test dan commit hash-nya dikutip di paper, jadi jangan ganti nama setelah paper ditulis. Setiap test mencetak gas lewat `vm.snapshotGas` atau `-vvv` dan hasilnya diekspor ke `data/raw/<RUN_ID>/e4_exploits.jsonl`.

**Disclosure:** kalau kontrak ini pernah/akan dipakai orang lain, perbaiki dulu di repo sebelum paper terbit, dan sebut statusnya di paper (`\todo` sudah disiapkan di Bagian IV-B).

---

## 9. E5 — Parameter dan reproducibility

**Mengisi:** Tabel `tab:params`, Data Availability.

| Item | Cara ambil | Masuk ke |
|---|---|---|
| `EXIT_PERIOD` | konstanta di `RootChainUTXO.sol` | `tab:params` |
| `CHALLENGE_PERIOD` | idem | `tab:params` |
| L2 block interval / aturan trigger | konfigurasi Plasma Service (waktu atau jumlah tx) | `tab:params` |
| Release tag + commit hash | `git tag -a paper1-rev1-frozen`, `git rev-parse HEAD` | `tab:params` + Data Availability |
| Zenodo DOI | hubungkan repo ke Zenodo, rilis tag → DOI otomatis | Data Availability |
| Arsip data | `data/raw`, `data/processed`, `paper/tables` masuk arsip | Data Availability |

Tambahkan `README.md` berisi langkah reproduksi persis: prasyarat, `make freeze`, `make e1 e2 e3`, `make tables`, waktu eksekusi perkiraan, dan berapa ETH Sepolia yang dibutuhkan.

---

## 10. E6 (opsional) — Full pipeline

Hanya kalau waktu memungkinkan. Kalau dikerjakan, laporkan terpisah dan jangan dicampur dengan hot-path.

- Alur: transfer L2 → `createBlock` → `submitBlock` ke Sepolia → tunggu konfirmasi.
- Parameter: block interval tetap (mis. 30 s), durasi ≥ 30 menit, ≥ 3 pengulangan.
- Metrik: ops/s end-to-end, waktu dari transfer sampai ter-anchor di L1 (median, p95), biaya L1 per operasi.
- Kalau tidak dikerjakan: **jangan** menaruh estimasi angka apa pun. Cukup nyatakan tidak diukur (draft saat ini sudah begitu).

---

## 11. Peta `\fillin{}` → sumber data

| Lokasi di `main_rev1.tex` | Penanda | Sumber |
|---|---|---|
| Abstrak baris 125 | naive gas, 1-SM gas | E1, n=100, L2 createBlock |
| Abstrak baris 128 | X% | E3, partial η² atau % variansi placement |
| Tabel params 657–662 | EXIT/CHALLENGE_PERIOD, interval, tag+hash | E5 |
| Bagian IV-B 751 | gas serangan A1 | E4 T1 |
| Bagian IV-B 767 | nama file test + commit | E4 |
| Setup 1000, 1021, 1023, 1032 | K, W, N, ε | E3 + ANALYSIS_PLAN |
| Tabel `tab:commit-cost` 1044–1060 | seluruh sel | E1 |
| Tabel `tab:op-gas` 1083–1100 | seluruh sel | E2 |
| Tabel `tab:throughput` 1119–1132 | seluruh sel | E3 |
| Teks RQ4 ~1148–1155 | F, p, η², selisih, CI, d, rasio | E3 + stats.json |
| Tabel `tab:exploits` 1185–1187 | gas + status after-fix | E4 |
| Threats 1197, 1296, 1303 | K, N | E3 |
| Kesimpulan 1319–1323 | X, Y, summary statistic | E1 + E3 |
| Data Availability 1334–1335 | DOI, tag, hash | E5 |

---

## 12. Urutan kerja dan estimasi

| Tahap | Isi | Estimasi |
|---|---|---|
| W1 | Implementasi 7 varian commit + unit test paritas on-chain/off-chain | 3–5 hari |
| W1 | Verifikasi trik ecrecover (kalau gagal, buang varian) | 1 hari |
| W2 | Harness: runner, record JSONL, randomisasi, snapshot/revert | 2–3 hari |
| W2 | E4 exploit test (bisa paralel, tidak butuh harness) | 1–2 hari |
| W3 | `ANALYSIS_PLAN.md` dibekukan + tag rilis + `make freeze` | 0,5 hari |
| W3 | Jalankan E1, E2 (termasuk L1 Sepolia) | 1–2 hari |
| W3 | Jalankan E3 kampanye penuh | 0,5–1 hari |
| W4 | `aggregate.py`, `stats.py`, `make_tables.py`, `make_figures.py` | 2–3 hari |
| W4 | Isi `\fillin`, tulis interpretasi `\todo`, compile, cek D1–D7 | 2 hari |
| W4 | Zenodo + finalisasi | 0,5 hari |

Total realistis: **3–4 minggu** kerja paruh waktu.

---

## 13. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Trik ecrecover tidak cocok dengan implementasi | satu varian hilang | Unit test lebih dulu; kalau gagal, laporkan apa adanya dan cukup pakai ASC-1SM |
| Gas L1 Sepolia bervariasi / ETH testnet habis | E1 kolom L1 kosong | Minta faucet lebih awal; N_L1 = 5; catat semua tx hash |
| Variansi throughput tinggi di mesin harian | CI lebar, kesimpulan lemah | Matikan aplikasi lain, governor performance, naikkan N, laporkan apa adanya |
| Hasil tidak sesuai prediksi (mis. keccak ternyata lebih mahal dari ASC-1SM) | narasi paper berubah | **Laporkan hasilnya, jangan ubah prediksinya.** Paper ini negative result — hasil yang mengejutkan justru nilai tambah, selama analisis aljabarnya tetap berdiri |
| Kontrak lama tidak bisa di-instrumentasi tanpa diubah | kontaminasi "kode yang diukur" | Pakai branch `paper1-frozen`; perubahan hanya event/gas-probe, dicatat di paper |
| Godaan memakai angka lama | penolakan lagi | Cek D3 di `make verify`: gagal kalau ada angka hasil yang di-hardcode di `.tex` |

---

## 14. Checklist sebelum menulis angka ke paper

- [ ] `ANALYSIS_PLAN.md` di-commit sebelum kampanye
- [ ] Tag rilis dibuat dan tidak berubah selama pengukuran
- [ ] Satu `RUN_ID` untuk semua tabel dan gambar
- [ ] N ≥ 30 per sel (kecuali L1 yang N-nya disebut eksplisit)
- [ ] Urutan sel diacak, seed tercatat
- [ ] Warm-up dibuang, bukan ikut dihitung
- [ ] Semua tx L1 punya hash yang bisa dibuka
- [ ] Gagal/retry dilaporkan, bukan disembunyikan
- [ ] Klaim "setara" hanya keluar dari TOST dengan ε yang sudah ditetapkan
- [ ] Semua tabel hasil di-`\input{}` dari `paper/tables/`
- [ ] `grep -c '\fillin' main_rev1.tex` = 0
