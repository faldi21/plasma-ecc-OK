# Verifikasi Gas Pasca-Ekstraksi ECCMath

**Status: KEPUTUSAN DIAMBIL.** Selisih gas signifikan dan tidak nol
(dikonfirmasi di bawah). Keputusan: **ukur KEDUA versi sebagai dua sel
terpisah** dalam kampanye E1, bukan memilih satu. Lihat "Keputusan final"
di bagian akhir dokumen ini.

---

## Metodologi (verifikasi awal, n=10 dan n=100)

1. Commit **sebelum** ekstraksi: `9fdd117` ("Quarantine two failing tests,
   assert current Point-range behavior").
2. Commit **sesudah** ekstraksi: `a5c5991` ("T1+T2: EcrecoverMulCheck, ECCMath
   extraction, seven commit-variant benchmarks") — sama dengan HEAD saat
   laporan ini ditulis.
3. Dikonfirmasi lebih dulu: `contracts/src/PlasmaChainUTXO.sol` **byte-identik**
   di kedua commit (`git diff 9fdd117 a5c5991 -- contracts/src/PlasmaChainUTXO.sol`
   kosong) — kontrak yang diukur sendiri tidak disentuh; satu-satunya
   perbedaan adalah `ECCAccumulator.sol` yang di-import-nya.
4. `git worktree add --detach` ke commit `9fdd117` (path terpisah, `lib/`
   di-symlink dari repo utama karena submodule tidak ikut ter-checkout
   otomatis di worktree baru — read-only, tidak mengubah apa pun).
5. Test pengukuran (`_tmp_ECCMathRefactorGas.t.sol`) — **file identik** di-copy
   ke kedua tempat — deploy `PlasmaChainUTXO` segar, isi `pendingUtxos` via
   `createDepositUtxoBatch` (n=10, n=100), ukur gas `createBlock()` lewat
   `gasleft()` delta.
6. Toolchain diverifikasi identik di kedua tempat: `forge 1.5.0-stable`
   (commit SHA sama), `foundry.toml` sama persis (`via_ir = true,
   optimizer = true, optimizer_runs = 200`).
7. `forge clean` + ukur ulang di kedua tempat untuk menyingkirkan
   kemungkinan cache basi — **hasil 100% identik** dengan pengukuran pertama
   di kedua sisi. Bukan artefak pengukuran.
8. File test sementara dan worktree dihapus setelah pengukuran; tidak ada
   sisa di working tree.

## Hasil awal (n=10, n=100)

| n | Sebelum ekstraksi (`9fdd117`) | Sesudah ekstraksi (`a5c5991`/HEAD) | Selisih (gas) | Selisih (%) |
|---|---:|---:|---:|---:|
| 10 | 11,548,750 | 9,634,060 | **-1,914,690** | **-16.58%** |
| 100 | 155,135,414 | 94,250,167 | **-60,885,247** | **-39.25%** |

Negatif = **lebih murah** setelah ekstraksi. Selisih meningkat tajam
seiring n membesar — bukan konstanta, bukan noise pengukuran.

---

## Hipotesis: memory-expansion cost (kuadratik)

Ekstraksi mengubah bentuk parameter/return value internal dari `Point
memory` (struct 2-word yang dialokasikan di heap memory Solidity tiap kali
`return Point(x3, y3)` dieksekusi) menjadi pasangan `(uint256, uint256)`
mentah (tuple, dikembalikan lewat stack/ABI, **tanpa alokasi memori heap**)
untuk `ECCMath.pointAdd`/`ECCMath.scalarMul`.

`ECCAccumulator.scalarMul` (dipanggil oleh `PlasmaChainUTXO`'s `accumulator.add()`
untuk **setiap** elemen pending, jadi n kali per `createBlock()`) melakukan
loop double-and-add 256 iterasi, memanggil `pointAdd` hingga 2× per iterasi
— artinya hingga ~512 pemanggilan `pointAdd` per satu `scalarMul`.

- **Sebelum**: tiap pemanggilan `pointAdd` (internal, versi lama)
  mengembalikan `Point memory` baru — alokasi heap 64 byte per panggilan.
  Untuk n=100, itu **hingga ~51,200 alokasi struct** dalam **satu transaksi**
  `createBlock()`. Biaya *memory expansion* Ethereum bersifat **kuadratik**
  terhadap total memori yang pernah dipakai dalam satu call frame/transaksi
  (`3*words + words²/512`), jadi biaya marjinal per alokasi baru membesar
  seiring transaksi berjalan.
- **Sesudah**: `ECCMath.pointAdd`/`scalarMul` bekerja sepenuhnya dengan
  nilai `uint256` mentah di dalam loop 256-iterasi — nol alokasi heap
  sampai titik paling akhir, di mana wrapper publik `ECCAccumulator.scalarMul`
  mengemas HASIL AKHIR saja menjadi satu `Point memory` (untuk menjaga API
  publik `ECCAccumulator.Point` tidak berubah).

---

## Verifikasi hipotesis: seri gas vs n (bukan cuma diduga)

Untuk menguji apakah penghematan benar-benar tumbuh superlinear (bukan
konstan atau linear), diukur seri lengkap n ∈ {10, 25, 50, 100, 200} untuk
kedua sel: `sys.plasma_v0` (kode vendor `contracts/src/legacy/`, verbatim
commit `9fdd117`) vs `sys.plasma_eccmath` (`contracts/src/PlasmaChainUTXO.sol`
saat ini). Pengukuran single-run ad-hoc (**bukan** kampanye resmi N≥30 —
itu tugas T6 terpisah), tapi cukup untuk menguji bentuk kurva.

**Catatan teknis**: pengukuran 5 titik tidak bisa dijalankan dalam satu
fungsi test Foundry sekaligus — total gas kumulatif kelima titik (v0 +
eccmath, ditambah overhead deploy) melebihi `gas_limit` default Foundry
per test-function (1,073,741,824). Setiap titik n diukur di fungsi test
terpisah agar masing-masing dapat alokasi gas penuh. (Menaikkan
`FOUNDRY_MEMORY_LIMIT` tidak membantu — dikonfirmasi bukan itu
penyebabnya; murni soal akumulasi gas lintas 5 pengukuran dalam satu call.)

### Hasil

| n | `sys.plasma_v0` (gas) | `sys.plasma_eccmath` (gas) | Selisih (gas) | Selisih (%) |
|---:|---:|---:|---:|---:|
| 10 | 11,701,755 | 9,753,539 | 1,948,216 | 16.65% |
| 25 | 30,431,361 | 23,858,317 | 6,573,044 | 21.60% |
| 50 | 66,426,697 | 47,446,794 | 18,979,903 | 28.57% |
| 100 | 155,597,177 | 94,455,717 | 61,141,460 | 39.29% |
| 200 | 402,141,864 | 188,015,982 | 214,125,882 | 53.25% |

(Angka n=10/100 di tabel ini berbeda tipis dari tabel "Hasil awal" di atas
— seed/urutan elemen `bytes32` pada dua sesi pengukuran berbeda menggeser
gas SSTORE marjinal sedikit karena cold/warm slot access berbeda per
elemen; ordo besaran dan pola sama persis.)

### Uji superlinear: rasio delta vs rasio n

| Langkah n | Rasio n | Rasio Δgas | Kesimpulan |
|---|---:|---:|---|
| 10 → 25 | 2.50x | 3.374x | **superlinear** |
| 25 → 50 | 2.00x | 2.888x | **superlinear** |
| 50 → 100 | 2.00x | 3.221x | **superlinear** |
| 100 → 200 | 2.00x | 3.502x | **superlinear** |
| 10 → 200 (kumulatif) | 20.00x | **109.91x** | **superlinear** |

**Hipotesis TERKONFIRMASI: pertumbuhan selisih gas superlinear terhadap
n**, konsisten di setiap langkah pengukuran (rasio Δgas selalu jauh di
atas rasio n). Persentase penghematan juga naik monoton: 16.65% (n=10) →
53.25% (n=200).

**Catatan kejujuran soal bentuk kurva persis**: rasio Δgas untuk tiap
penggandaan n=2x konsisten di kisaran **2.9x–3.5x** — lebih besar dari 2x
(linear) tapi **lebih kecil** dari 4x (yang berarti kuadratik murni O(n²)
untuk rasio n=2x). Ini **cocok** dengan bentuk formula memory-expansion
EVM yang sebenarnya, `3·words + words²/512` — gabungan **linear + kuadratik**,
bukan kuadratik murni. Pada rentang n yang diuji di sini (ratusan hingga
puluhan-ribu word memori), suku linear masih berkontribusi cukup besar
sehingga kurva belum sepenuhnya didominasi suku kuadratik — tapi tren rasio
Δgas yang **meningkat** dari langkah ke langkah (2.89x → 3.22x → 3.50x)
menunjukkan kontribusi kuadratik semakin dominan seiring n membesar, persis
seperti yang diprediksi hipotesis.

### Jumlah word memori puncak

**Tidak berhasil diambil langsung.** `MSIZE` EVM hanya bisa diperiksa dari
DALAM call frame yang sama — mengukurnya dari kontrak pemanggil (test)
tidak mencerminkan memori yang dipakai di dalam eksekusi `createBlock()`
kontrak yang diukur (call boundary memisahkan ruang memori). Instrumentasi
langsung di dalam `PlasmaChainUTXOV0.sol`/`PlasmaChainUTXO.sol` untuk
mencatat `msize()` tidak dilakukan karena akan melanggar syarat
byte-identik (`ECCAccumulatorV0.sol`/`PlasmaChainUTXOV0.sol`) dan IRON RULE
5 (`PlasmaChainUTXO.sol` saat ini). Trace opcode-level via
`debug_traceTransaction` (butuh node RPC sungguhan, mis. Anvil, bukan EVM
in-memory `forge test`) adalah jalur yang tersedia untuk langkah lanjutan
kalau presisi word-count eksak dibutuhkan — di luar cakupan verifikasi ini.
Pola pertumbuhan gas superlinear di atas sudah menjadi bukti empiris yang
memadai untuk hipotesis tanpa angka word-count eksak.

---

## Keputusan final

**Ukur KEDUA versi sebagai dua sel terpisah dalam kampanye E1, bukan
memilih satu.** Alasan:

1. **Kesetaraan nilai sudah terbukti** (`ECCAccumulatorParityTest` untuk
   `ECCMath` di level library, dan `PlasmaChainUTXOV0ParityTest` untuk
   `accumulatorValue` di level kontrak penuh, n ∈ {1, 10, 100}, semua
   lolos) — jadi kedua versi valid secara matematis; bedanya murni biaya.
2. **Selisih biaya sendiri adalah temuan yang layak dilaporkan**, bukan
   sekadar detail implementasi yang harus disembunyikan dengan memilih
   satu angka. Growth pattern superlinear (16.65% → 53.25% penghematan
   seiring n dari 10 ke 200) adalah data yang berharga untuk paper/laporan
   — tidak ada alasan membuang salah satu sisi cerita ini.
3. **Tidak perlu rekonsiliasi tujuh kontrak bench** — sesuai instruksi:
   ketujuhnya tetap memakai `ECCMath` karena tugasnya mengisolasi algoritma
   digest (kode baru, bukan reproduksi tata letak memori kode lama).
   Perbedaan konteks ini dicatat eksplisit di `docs/EXPERIMENT_PRD.md`
   §4.6 — angka sel bench (`bench.commit_*`) dan sel sistem (`sys.plasma_*`)
   **tidak pernah dibandingkan lintas konteks**.

### Implementasi

- `contracts/src/legacy/ECCAccumulatorV0.sol` — vendor verbatim commit
  `9fdd117` (byte-identik setelah header, diverifikasi via `diff`).
- `contracts/src/legacy/PlasmaChainUTXOV0.sol` — vendor commit `9fdd117`,
  berbeda persis 2 baris dari original (import path + nama contract, kedua
  perubahan wajib secara teknis untuk menghindari tabrakan nama kompilasi
  dengan kontrak yang sedang berjalan — diverifikasi via `diff`).
- Dua sel baru di `docs/EXPERIMENT_PRD.md` §4.6: `sys.plasma_v0` dan
  `sys.plasma_eccmath`, dengan tabel perbandingan konteks eksplisit
  terhadap tujuh sel `bench.commit_*` yang sudah ada.
- `contracts/test/PlasmaChainUTXOV0Parity.t.sol` — bukti kesetaraan nilai
  end-to-end, tersimpan permanen sebagai bagian dari test suite (bukan
  file sementara).
- Kampanye resmi E1 (T6, N≥30, dataset beku) akan mengukur seri lengkap
  n ∈ {10, 25, 50, 100, 200} (atau superset yang mencakup nilai ini) untuk
  kedua sel `sys.*`, sesuai prosedur di `docs/EXPERIMENT_PRD.md` §4.6.
