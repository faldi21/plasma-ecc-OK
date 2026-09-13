# Verifikasi Gas Pasca-Ekstraksi ECCMath — HASIL: SELISIH SIGNIFIKAN, BUKAN NOL

**Status: BERHENTI, menunggu keputusan.** Sesuai instruksi tugas ini: kalau
selisih tidak nol, laporkan dan jangan lanjut — perlu diputuskan apakah
kampanye E1 diukur pada kode sebelum atau sesudah ekstraksi `ECCMath.sol`.

---

## Metodologi

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
   sisa di working tree (`forge build` di HEAD dikonfirmasi tetap bersih
   setelahnya).

---

## Hasil

| n | Sebelum ekstraksi (`9fdd117`) | Sesudah ekstraksi (`a5c5991`/HEAD) | Selisih (gas) | Selisih (%) |
|---|---:|---:|---:|---:|
| 10 | 11,548,750 | 9,634,060 | **-1,914,690** | **-16.58%** |
| 100 | 155,135,414 | 94,250,167 | **-60,885,247** | **-39.25%** |

Negatif = **lebih murah** setelah ekstraksi. Selisih meningkat tajam
seiring n membesar — bukan konstanta, bukan noise pengukuran.

---

## Kenapa ini terjadi (hipotesis, belum diverifikasi sampai level opcode)

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

Kalau hipotesis ini benar, penghematan **membesar secara non-linear seiring
n** persis karena sifat kuadratik biaya memori — cocok dengan pola
16.58% (n=10) → 39.25% (n=100) yang teramati. Ini **belum** diverifikasi
dengan trace opcode-level (`forge test -vvvv` gas breakdown per opcode);
kalau perlu presisi lebih tinggi soal akar penyebab, itu langkah lanjutan
terpisah.

---

## Implikasi untuk kampanye

Refactor `ECCMath` **bukan** operasi bebas biaya (*not* a no-op) terhadap
kontrak yang benar-benar diukur. Ini mengubah baseline `PlasmaChainUTXO`
sendiri secara material (16-39% lebih murah), **terlepas** dari tujuh
kontrak commit-variant baru (`CommitASCNaive`, dll.) yang memang sengaja
dibuat baru untuk E1.

Ini **tidak membatalkan** `ECCAccumulatorParityTest` — hasil komputasi
(titik x,y) memang terbukti identik. Yang berubah murni **biaya**, bukan
**hasil**.

Dua opsi konkret (perlu keputusanmu):

1. **Kampanye E1 diukur pada kode SESUDAH refactor (HEAD saat ini)** —
   berarti baseline `PlasmaChainUTXO.createBlock()` yang dipakai sebagai
   titik rujuk *"cara lama"* (`CommitASCNaive`, yang secara sengaja meniru
   `accumulator.add()` apa adanya) sebenarnya sudah lebih murah 16-39% dari
   apa yang benar-benar berjalan di `PlasmaChainUTXO.sol` versi sebelum
   ticket T1+T2 ini. Kalau paper/laporan menyebut angka lama (~165M gas
   dari sesi kalibrasi jauh sebelumnya) sebagai pembanding, angka itu
   **tidak lagi cocok** dengan kode HEAD — perlu diukur ulang dari nol
   dengan kode saat ini untuk konsistensi.

2. **Kampanye E1 diukur pada kode SEBELUM refactor** (`9fdd117`, atau
   revert `ECCMath` extraction) — mempertahankan angka `PlasmaChainUTXO`
   yang identik dengan versi yang sudah pernah dikalibrasi/dilaporkan
   sebelumnya (termasuk yang mungkin sudah masuk draft paper), tapi berarti
   `contracts/src/commit/*.sol` (yang mengimpor `ECCMath` langsung) perlu
   direkonsiliasi — apakah tetap pakai `ECCMath` untuk variannya sendiri
   (karena itu kode BARU, tidak terikat baseline lama), sementara
   `PlasmaChainUTXO.sol` yang diukur tetap versi lama tanpa `ECCMath`.

Saya tidak mengambil keputusan ini secara sepihak — silakan pilih salah
satu (atau arahan lain) untuk saya lanjutkan.
