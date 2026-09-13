# Diagnosa Dua Test yang Gagal

Bagian 1–2 di bawah adalah diagnosa awal (**read-only**, tidak ada kode yang
diubah untuk menghasilkannya). Bagian "Tindak Lanjut" dan seterusnya adalah
eksekusi rekomendasi karantina + test baru, dengan IRON RULE 5 dipatuhi:
`ECCAccumulator.sol`, `PlasmaChainUTXO.sol`, `PlasmaChainUTXOMerkle.sol`,
`RootChainUTXO.sol` **tidak disentuh**. Semua temuan diverifikasi dengan
`forge test --mt <nama> -vvvv` dan pembacaan source langsung.

---

## 1. `DebugAccumulator.testVerify` (`contracts/src/test/DebugAccumulator.sol`)

### 1.1 Baris yang gagal dan pesan assert

Bukan `assert`/`require` yang gagal — ini **panic runtime Solidity**:

```
[FAIL: panic: arithmetic underflow or overflow (0x11);
 counterexample: ...
 args=[0xac6438f1d3ef3a0a6f009cbfbe40c2acb5abcd42bc0157e4e4cfaa515e713bf8,
       Point({ x: 115792089237316195423570985008687907853269984665640564039457584007913129639932,
               y: 88342715392362684191240199672417987545372058 })]]
```

Trace (`-vvvv`) menunjukkan urutan event persis: `emit ElementPoint(...)`
(baris 85 `DebugAccumulator.sol`, artinya `scalarMul` sukses) tereksekusi,
lalu **revert terjadi sebelum** `emit ComputedAccumulator(...)` (baris 93)
sempat tercapai. Ini mempersempit lokasi ke satu pemanggilan di antara
keduanya: baris 88–91, `ECCAccumulator.pointAdd(witness, elementPoint)`.

Di dalam `pointAdd` (`contracts/src/libraries/ECCAccumulator.sol:94-132`),
titik persisnya adalah **baris 114**:

```solidity
uint256 dx = addmod(p2.y, P - p1.y, P);  // baris 113
uint256 dx = addmod(p2.x, P - p1.x, P);  // baris 114  <-- underflow di sini
```

`p1` di sini adalah `witness` (parameter pertama `pointAdd(witness,
elementPoint)`). `p1.x` = `witness.x` = `115792...639932`. Bandingkan
dengan `P` (konstanta secp256k1 di baris 14 file yang sama):

```
P       = 115792089237316195423570985008687907853269984665640564039457584007908834671663
witness.x = 115792089237316195423570985008687907853269984665640564039457584007913129639932
```

`witness.x > P` — sehingga `P - p1.x` adalah pengurangan `uint256` yang
hasilnya negatif, dan Solidity ^0.8.x (checked arithmetic default) me-revert
dengan panic 0x11 alih-alih membiarkan wraparound.

### 1.2 Penyebab

**Bug di kontrak (library), bukan di test, bukan mismatch ekspektasi** —
dengan catatan penting soal *jenis* bug ini (lihat 1.3).

`ECCAccumulator.pointAdd()` (dan turunannya, `scalarMul`, `verify`,
`verifyWithAccumulator`, `add`) **tidak pernah memvalidasi bahwa koordinat
`Point` yang diterima sebagai parameter sungguh `< P`** sebelum dipakai
dalam operasi `P - koordinat`. Tipe `Point { uint256 x; uint256 y; }` tidak
punya invariant bawaan Solidity yang memaksa "x dan y harus elemen field
valid (`< P`) dan harus benar-benar terletak pada kurva
(`y² = x³ + 7 mod P`)" — itu tanggung jawab pemanggil, dan tidak ada
pengecekan itu di manapun dalam file ini.

Fuzzer Foundry (bukan input acak seragam murni — Foundry sengaja
mem-bias ke nilai tepi seperti dekat `type(uint256).max`) menemukan bahwa
memberi `witness.x` sedikit di atas `P` langsung membuat fungsi ini panic,
alih-alih mengembalikan `false` secara terkendali.

**Bukan bug di test** dalam artian "assert salah" — fungsi `testVerify` ini
memang tidak punya satupun `assertTrue`/`assertEq`. Ia murni fungsi logging
debug (lihat 1.4) yang kebetulan cocok konvensi penamaan `test*` sehingga
di-fuzz otomatis oleh Foundry meski **tidak pernah dirancang jadi test**.

### 1.3 Apakah ini menyangkut `verify()` menerima/menolak witness untuk elemen sembarang?

**Tidak — dan ini penting untuk dipahami secara presisi.**

Kegagalan ini terjadi **sebelum** perbandingan boolean apa pun sempat
dievaluasi. Alurnya:

```
testVerify(element, witness)
  → scalarMul(G, element mod N) = elementPoint   [SUKSES, emit ElementPoint]
  → pointAdd(witness, elementPoint)               [PANIC di sini]
  → (tidak pernah tercapai) computedAcc.x == accumulator.value.x
  → (tidak pernah tercapai) return result
```

Nilai yang dipakai pada kasus gagal ini:

| Variabel | Nilai |
|---|---|
| `element` | `0xac6438f1d3ef3a0a6f009cbfbe40c2acb5abcd42bc0157e4e4cfaa515e713bf8` |
| `witness.x` | `115792089237316195423570985008687907853269984665640564039457584007913129639932` (**> P**, invalid field element) |
| `witness.y` | `88342715392362684191240199672417987545372058` |
| `accumulator.value` | `(GX, GY)` — titik generator, **tidak pernah berubah** karena test ini tidak pernah memanggil `add()` atau `setAccumulator()` sebelum fuzzing |

`witness` yang di-fuzz di sini adalah nilai `uint256` mentah sembarang, ia
**bukan** hasil konstruksi witness yang sah secara aritmetika kurva (seperti
`w = A - e·G` yang dijelaskan Remark 1 di paper). Klaim paper soal *vacuity*
(`verify()` menerima witness untuk elemen apa pun **selama witness dihitung
dengan benar** dari akumulator target) berbicara tentang witness yang
**valid sebagai titik kurva** (koordinatnya otomatis `< P` karena berasal
dari operasi `pointAdd`/`scalarMul` yang sudah ter-reduksi modulo `P`).
Fuzz test ini justru menguji kasus yang **lebih ekstrem**: witness yang
bahkan bukan elemen field yang valid sama sekali (hampir pasti juga bukan
titik yang benar-benar berada di kurva, karena fuzzer tidak memeriksa
`y² = x³ + 7 mod P`).

**Kesimpulan:** kegagalan ini **tidak membuktikan maupun membantah** klaim
vacuity paper (M2/Remark 1). Ia mengungkap masalah yang **berbeda dan
belum disebut** reviewer manapun: `pointAdd`/`scalarMul`/`verify` bukan
fungsi total atas seluruh ruang `Point` — pemanggil yang mengirim koordinat
di luar rentang field (`>= P`) akan membuat transaksi **revert** (panic),
bukan mendapat jawaban `true`/`false` yang terkendali. Ini relevan untuk
`startExit`/`challengeExitWithSpendProof` di `RootChainUTXO.sol` yang
menerima `witness` dari `calldata` tanpa validasi rentang serupa — artinya
pemanggil (jujur maupun jahat) yang salah format witness-nya akan membuat
transaksinya sendiri revert, bukan diam-diam lolos atau ditolak.

### 1.4 Rekomendasi

**Karantina** — pindahkan `DebugAccumulator.sol` keluar dari jalur temuan
otomatis Foundry (`contracts/test/` atau apa pun yang cocok pola nama
`test*`), misalnya ke `contracts/src/legacy/` atau ganti nama fungsi
`testVerify` → `debugVerify`. Alasan:

- File ini secara eksplisit berlabel *"Debug contract to test and log
  accumulator verification"* — tujuannya alat debug manual, bukan
  regression test otomatis.
- Ia tidak punya satupun assertion; "lolos" atau "gagal" di bawah Foundry
  tidak mencerminkan niat aslinya.
- Kalaupun ingin dipertahankan sebagai **regression test sungguhan** untuk
  menguji perilaku `pointAdd` pada input di luar rentang field (finding
  yang sah dan bernilai — lihat 1.3), itu harus ditulis ulang sebagai test
  eksplisit dengan `vm.expectRevert()` yang menyatakan *"witness dengan
  koordinat ≥ P harus revert dengan panic 0x11"* — bukan dibiarkan sebagai
  fuzz call tanpa assertion pada fungsi debug yang kebetulan tertangkap
  Foundry.
- Tidak direkomendasikan memperbaiki `pointAdd` di sini — itu keluar dari
  scope diagnosa ini (instruksi eksplisit: jangan ubah kode), dan
  memperbaikinya (mis. menambah `require(x < P && y < P)`) adalah keputusan
  desain yang perlu didiskusikan dulu karena berdampak ke `IRON RULE #5`
  di `CLAUDE.md` (jangan ubah kontrak yang sedang diukur).

---

## 2. `TestWithdrawal.testStartExit` (`contracts/test/TestWithdrawal.t.sol`)

### 2.1 Baris yang gagal dan pesan assert

```
[FAIL: Invalid transaction proof] testStartExit() (gas: 1438027)
```

Trace `-vvvv` mengonfirmasi lokasi persis: `require` di
`RootChain.sol:140-143` (kontrak **legacy**, bukan `RootChainUTXO.sol`):

```solidity
require(
    ECCAccumulator.verifyWithAccumulator(txHash, witness, blockAccumulator),
    "Invalid transaction proof"
);
```

Backtrace runtime:
```
at 0x8833aBE60468e6bA5FEe1b10e80AB08cC362b873.startExit
at TestWithdrawal.testStartExit
```

Trace juga mengonfirmasi eksekusi **melewati** cek sebelumnya
(`require(blockNumber <= currentPlasmaBlock, "Invalid block")` — kalau ini
yang gagal, pesannya akan berbeda), jadi kegagalan murni terjadi di
pembandingan witness terhadap `blockAccumulator`.

### 2.2 Penyebab

**Bukan bug di kontrak** (logika `require` benar — ia memang harus menolak
kalau `witness + txHash·G ≠ blockAccumulator`), dan **bukan bug murni di
struktur test** (test valid secara sintaks, memakai pola Foundry yang
benar). Penyebabnya adalah **data test yang bergantung pada state live
network yang tidak dipin (non-deterministic dari waktu ke waktu)**,
dikombinasikan dengan target kontrak yang **legacy**.

Detail:

1. `setUp()` memanggil `vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"))`
   **tanpa nomor blok** — artinya fork mengambil state Sepolia **terkini**
   (kapanpun `forge test` dijalankan), bukan snapshot historis yang tetap.
2. Kontrak yang di-load: `RootChain` (`import "../src/RootChain.sol"` di
   baris 5 — sesudah path fix T0, efektif `../contracts/src/RootChain.sol`),
   dibaca dari address `vm.envAddress("ROOT_CHAIN_ADDRESS")`. Ini adalah
   kontrak **account-based lama**, bukan `RootChainUTXO.sol` yang dipakai
   sistem UTXO aktif (dikonfirmasi silang dengan `docs/temuan.md`: *"Kontrak
   account-based sebaiknya dianggap legacy dan jangan dicampur dengan
   kontrak UTXO"*).
3. `txHash`, `witness.x`, `witness.y`, dan `blockNumber = 2` di-hardcode di
   baris 21–31, dengan komentar *"Witness from backend (generated when
   block 2 was created)"* — nilai ini ditangkap manual dari satu sesi
   interaksi nyata di masa lalu terhadap instance kontrak tertentu.
4. Karena fork memakai *latest block* (bukan blok yang dipin ke saat
   witness itu ditangkap), `plasmaBlocks[2].accumulatorValue` yang dibaca
   sekarang adalah apa pun yang **sekarang** tersimpan di address itu di
   Sepolia — yang bisa jadi kosong/berbeda kalau kontrak sudah pernah
   di-deploy ulang ke address yang sama secara berbeda, atau memang
   berbeda dari yang diasumsikan test karena rentang waktu yang panjang
   sejak nilai itu ditangkap.

Ini masuk kategori **"ekspektasi test tidak sesuai dengan kondisi yang
dijamin"**: test mengasumsikan state on-chain akan selalu identik dengan
saat data hardcode diambil, padahal desainnya (`fork` tanpa pin blok)
justru menjamin sebaliknya — state bisa berbeda kapan saja.

### 2.3 Bagian khusus verify (relevan juga untuk paper)

Sama seperti kasus 1, `require` di sini **berhasil dievaluasi sampai
selesai** (tidak panic) dan **mengembalikan `false`** (`require` gagal
dengan pesan yang sesuai) — bukan revert tak terkendali. Ini justru
konsisten dengan operasi `verifyWithAccumulator` yang bekerja seperti
seharusnya: menolak witness yang tidak match akumulator target. Tidak ada
temuan baru soal soundness di sini — murni soal data test yang stale/tidak
reproducible.

### 2.4 Rekomendasi

**Karantina**, bukan diperbaiki di tempat. Alasan:

- Test ini menguji kontrak **legacy** (`RootChain.sol`) yang menurut
  `docs/temuan.md` sendiri sudah dianggap bukan jalur utama sistem (jalur
  utama adalah `RootChainUTXO.sol`). Mengukur ulang atau memperbaiki
  `RootChain.sol` berada di luar cakupan kampanye Paper 1 revisi
  (`EXPERIMENT_PRD.md` berfokus pada `PlasmaChainUTXO`/`RootChainUTXO`).
- Bahkan kalau kontrak ini masih relevan, test-nya melanggar prinsip
  determinisme yang jadi salah satu *IRON RULE* kampanye (`CLAUDE.md`:
  *"Setiap hal yang acak ... memakai seed yang dicatat"*) — fork tanpa pin
  blok terhadap kontrak live membuat hasil test **tidak reproducible**
  antar-run, persis kelemahan metodologi yang dikritik reviewer paper
  (data campuran dari kampanye berbeda-beda waktu).
- Pindahkan ke `contracts/test/legacy/` (folder baru, belum ada) dan
  kecualikan dari `forge test` default lewat konfigurasi Foundry (misalnya
  memakai `no_match_path` di `foundry.toml`, atau `forge test
  --no-match-path 'contracts/test/legacy/*'` di CI/perintah harian),
  supaya tidak terus muncul sebagai kegagalan yang mengganggu sinyal test
  suite yang relevan untuk kampanye T1–T9.
- Kalau suatu saat memang ingin test regresi untuk exit-flow legacy yang
  reproducible, tulis ulang dengan `vm.createSelectFork(url, blockNumber)`
  (pin ke blok tetap) atau — lebih baik lagi — pindah sepenuhnya ke Anvil
  lokal dengan data yang di-generate ulang secara deterministik dalam
  `setUp()`, bukan hardcode dari sesi manual masa lalu.

---

## Tindak Lanjut (dieksekusi)

### Karantina

1. **`DebugAccumulator.sol`**: fungsi `testVerify` → `debugVerify` (isi tidak
   diubah, hanya nama + komentar). Tidak lagi cocok konvensi nama `test*`
   Foundry, sehingga tidak lagi otomatis di-fuzz sebagai test.
2. **`TestWithdrawal.t.sol`**: dipindah ke `contracts/test/legacy/`, dengan
   komentar satu baris di puncak file menjelaskan alasan karantina. Path
   import disesuaikan (`../src/` → `../../src/` karena pindah satu level).
   Dikecualikan dari `forge test` default lewat
   `no_match_path = "contracts/test/legacy/**/*"` di `foundry.toml`.

### Test baru: `contracts/test/PointRangeRevert.t.sol`

Lima test yang **menegaskan perilaku sekarang** (bukan memperbaiki):

| Test | Menegaskan |
|---|---|
| `test_RevertWhen_WitnessXExceedsP` | `witness.x > P` → revert panic 0x11 |
| `test_RevertWhen_WitnessYExceedsP` | `witness.y > P` → revert panic 0x11 |
| `test_Boundary_XEqualsPMinus1_DoesNotRevert` | `x = P-1` (field element valid terbesar) → tidak revert |
| `test_Boundary_XEqualsP_DoesNotRevert` | `x = P` → **tidak revert** (temuan empiris: `P - P = 0`, bukan underflow — beda dari asumsi awal bahwa "`>= P` selalu revert"; yang benar adalah "`> P` revert, `== P` tidak") |
| `test_ProperlyForgedWitness_DoesNotRevert_AndVerifies` | Witness sah (`w = A - e·G`) tidak revert **dan** `verify` mengembalikan `true` — mengonfirmasi klaim vacuity paper (M2/Remark 1) secara terisolasi dari bug range-check ini |

Semua 5 lolos (lihat bagian "Hasil forge test" di akhir dokumen).

---

## Dampak pada jalur exit L1

Diperiksa: `contracts/src/RootChainUTXO.sol` (kontrak yang diukur, **tidak
diubah** — pemeriksaan ini murni pembacaan, sesuai IRON RULE 5).

### `startExit` (baris 339–385)

Parameter `witness` (`ECCAccumulator.Point memory witness`, dideklarasikan
baris **342**) diteruskan **langsung, tanpa validasi rentang apa pun**, ke
`ECCAccumulator.verifyWithAccumulator(utxoId, witness, blockAccumulator)` di
baris **357**. Cek yang ada di antara deklarasi parameter dan pemanggilan itu
(baris 347–352: `utxo.utxoId != 0`, `utxo.owner == msg.sender`,
`!utxo.spent`, `!utxo.exited`, `!exitedUtxos[utxoId]`, `blockNumber <=
currentPlasmaBlock`) semuanya soal **state kepemilikan/UTXO**, tidak ada
satupun yang memeriksa `witness.x < P` atau `witness.y < P`.

### `challengeExitWithSpendProof` (baris 424–455)

Sama persis: parameter `spendWitness` (dideklarasikan baris **428**)
diteruskan langsung ke `ECCAccumulator.verifyWithAccumulator(spendingTxHash,
spendWitness, blockAccumulator)` di baris **443**. Cek di antaranya (baris
432–438: status exit, urutan block) juga tidak menyentuh rentang koordinat
witness.

### Implikasi

**Bukan exploit baru terhadap pihak lain** — `startExit` dan
`challengeExitWithSpendProof` sama-sama `external` tanpa modifier
kepemilikan atas parameter witness-nya sendiri; kalau `witness.x` atau
`witness.y` yang dikirim `>= P`, seluruh transaksi revert dengan panic 0x11
(lihat #1 di atas untuk mekanismenya persis) — **transaksi milik pemanggil
sendiri yang gagal**, tidak ada state pihak lain yang berubah atau
"diam-diam lolos". Jalur exploit forging witness yang sudah dikonfirmasi
sah (M2/Remark 1 paper, dan `test_ProperlyForgedWitness_...` di bawah)
tetap berjalan seperti biasa karena witness yang dikonstruksi lewat
`A - e·G` otomatis punya koordinat `< P` — bug ini **tidak menutup maupun
memperparah** celah forging yang sudah ada.

**Yang benar-benar terdampak: pesan error dan robustness.** Pengguna jujur
yang witness-nya salah format (mis. bug di service pembuat witness,
kesalahan encoding, atau truncation) akan mendapat
`panic: arithmetic underflow or overflow (0x11)` — pesan low-level yang
kriptik — alih-alih pesan `require` yang jelas seperti *"Invalid UTXO
proof"* / *"Invalid spend proof"* yang sudah disediakan kontrak untuk kasus
witness tidak match. Ini murni gap validasi input/UX, bukan celah keamanan
protokol baru.

---

## Ringkasan

| Test | Baris gagal (sebelum karantina) | Penyebab | Terkait klaim vacuity paper? | Tindak lanjut |
|---|---|---|---|---|
| `DebugAccumulator.testVerify` | `ECCAccumulator.sol:114` (`pointAdd`) | Bug library: tidak validasi `x,y < P` sebelum `P - x`; file ini juga bukan test sungguhan (fungsi debug tanpa assertion, tertangkap konvensi nama Foundry) | **Tidak** — panic terjadi sebelum sempat mengevaluasi accept/reject; witness fuzz bukan witness yang dikonstruksi sah | ✅ Rename → `debugVerify`; perilaku bug didokumentasikan sebagai assertion eksplisit di `PointRangeRevert.t.sol` |
| `TestWithdrawal.testStartExit` | `RootChain.sol:140-143` (`require` verify) | Data hardcode dari sesi lampau diuji lawan fork Sepolia *latest* (tidak dipin) terhadap kontrak **legacy** — state saat ini tidak cocok lagi dengan asumsi test | Tidak — `require` menolak dengan bersih, bukan bug soundness | ✅ Dipindah ke `contracts/test/legacy/`, dikecualikan dari `forge test` default via `no_match_path` |

Tidak ada satupun dari 4 kontrak yang diukur (`ECCAccumulator.sol`,
`PlasmaChainUTXO.sol`, `PlasmaChainUTXOMerkle.sol`, `RootChainUTXO.sol`)
yang diubah untuk diagnosa maupun tindak lanjut ini (IRON RULE 5).

---

## Hasil `forge test -vv` (setelah tindak lanjut)

```
Ran 3 tests for contracts/test/RootChain.t.sol:RootChainTest
[PASS] testDeposit() (gas: 82036)
[PASS] testDepositETH() (gas: 48661)
[PASS] testSubmitBlock() (gas: 182638)
Suite result: ok. 3 passed; 0 failed; 0 skipped

Ran 2 tests for contracts/test/Counter.t.sol:CounterTest
[PASS] testFuzz_SetNumber(uint256) (runs: 256, μ: 28032, ~: 28421)
[PASS] test_Increment() (gas: 28418)
Suite result: ok. 2 passed; 0 failed; 0 skipped

Ran 1 test for contracts/test/PlasmaChainTransfer.t.sol:PlasmaChainTransferTest
[PASS] testTransfer() (gas: 1338534)
Suite result: ok. 1 passed; 0 failed; 0 skipped

Ran 5 tests for contracts/test/PointRangeRevert.t.sol:PointRangeRevertTest
[PASS] test_Boundary_XEqualsPMinus1_DoesNotRevert() (gas: 1013773)
[PASS] test_Boundary_XEqualsP_DoesNotRevert() (gas: 1013524)
[PASS] test_ProperlyForgedWitness_DoesNotRevert_AndVerifies() (gas: 2040355)
[PASS] test_RevertWhen_WitnessXExceedsP() (gas: 1014484)
[PASS] test_RevertWhen_WitnessYExceedsP() (gas: 1014552)
Suite result: ok. 5 passed; 0 failed; 0 skipped

Ran 4 test suites: 11 tests passed, 0 failed, 0 skipped (11 total tests)
```

`contracts/test/legacy/TestWithdrawal.t.sol` tidak muncul di run ini
(dikecualikan lewat `no_match_path`), dan `DebugAccumulator.sol` tidak lagi
tertangkap sebagai test (rename `testVerify` → `debugVerify`) — keduanya
sesuai rencana karantina, bukan hilang tanpa jejak.
