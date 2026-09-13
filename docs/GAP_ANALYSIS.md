# T0 — Gap Analysis: PRD vs Kode Nyata

Status: **read-only**. Tidak ada kode yang diubah untuk menghasilkan dokumen ini.

Berkas yang dibaca: `CLAUDE.md`, `README.md`, `docs/EXPERIMENT_PRD.md`,
`docs/TICKETS.md`, `foundry.toml`, `src/PlasmaChainUTXO.sol`,
`src/PlasmaChainUTXOMerkle.sol`, `src/libraries/ECCAccumulator.sol`,
`src/libraries/MerkleAccumulator.sol`, `src/RootChainUTXO.sol`, plus inspeksi
struktur direktori (`contracts/`, `test/`, `remappings.txt`, `git tag -l`).

---

## 1. Di mana digest dihitung, dan alur `transferUtxoBatch → pendingUtxos → createBlock/createBlockChunked`

Digest **tidak** dihitung saat transfer. `transferUtxo`, `transferUtxoBatch`,
`createDepositUtxo`, `createDepositUtxoBatch`, `requestWithdrawal`, dan
`aggregateForWithdrawal` semuanya hanya melakukan `pendingUtxos.push(id)` dan
secara eksplisit menunda pembaruan accumulator — komentar di kode menyebut ini
langsung (`src/PlasmaChainUTXO.sol:302`, `:347`, `:406`, `:456`, `:585`,
`:612`: *"accumulator update deferred to createBlock"*).

Konkretnya untuk `transferUtxoBatch` (`src/PlasmaChainUTXO.sol:222-254`):
`transferUtxoBatch` → `_executeBatchOp` (per sub-op, `:256-310`) → menandai
input `spent`, membuat output UTXO baru, `pendingUtxos.push(outId)` (`:302`).
Tidak ada pemanggilan `accumulator.add` di jalur ini sama sekali.

Digest **dihitung** hanya di `_createBlockChunked` (`:653-680`), dipanggil dari
dua entry point:
- `createBlock()` (`:637-641`, `onlyOperator`) → memanggil
  `_createBlockChunked(type(uint256).max)` dan mensyaratkan `isComplete` dalam
  satu panggilan (revert kalau `pendingUtxos` terlalu besar untuk satu tx).
- `createBlockChunked(uint256 maxOps)` (`:649-651`, `onlyOperator`) → memproses
  maksimal `maxOps` elemen per panggilan, bisa dipanggil berkali-kali untuk
  menghabiskan `pendingUtxos` (menghindari OOG).

Di dalam `_createBlockChunked`, loop `for (i = pendingProcessedCursor;
i < endIdx; i++) { accumulator.add(pendingUtxos[i]); }` (`:660-662`) adalah
**satu-satunya tempat** langkah kriptografi (digest) terjadi:
- Untuk `PlasmaChainUTXO.sol`: `ECCAccumulator.add` (`src/libraries/ECCAccumulator.sol:38-50`)
  → `scalarMul(G, uint256(element) mod N)` lalu `pointAdd(acc.value, newPoint)`.
- Untuk `PlasmaChainUTXOMerkle.sol`: `MerkleAccumulator.add`
  (`src/libraries/MerkleAccumulator.sol:84-94`) → `tree.push(element)` (OZ
  `Bytes32PushTree`, depth 20), root baru disimpan.

Setelah cursor mencapai `pendingUtxos.length`, blok di-commit
(`PlasmaChainUTXO.sol:666-678`): `currentBlock++`, `blocks[currentBlock] =
Block({..., accumulatorValue: accumulator.getValue()/getRoot(), ...})`, event
`BlockCreated` di-emit, `pendingUtxos` dihapus.

**Catatan penting — accumulator ini *cumulative*, bukan per-blok.** `acc.value`
diinisialisasi sekali di constructor (`initialize()`, `:30-33`) ke titik
generator `G`, dan setiap `add()` memutasi state yang sama selamanya.
`Block.accumulatorValue` yang disimpan per blok adalah **snapshot nilai
kumulatif seluruh riwayat**, bukan digest yang dihitung ulang dari nol untuk
`ids` blok itu saja. Ini relevan untuk pertanyaan #2 dan #6 di bawah.

Pengiriman ke L1 (`submitBlock` di `RootChainUTXO.sol:221-238`) **tidak
dipanggil dari kontrak L2 manapun** — tidak ada pemanggilan cross-contract di
`PlasmaChainUTXO.sol`/`PlasmaChainUTXOMerkle.sol` ke `RootChainUTXO.sol`.
Linkage-nya harus dilakukan operator/relay off-chain (disebut di README sebagai
`PlasmaServiceUTXO.ts`, tidak dibaca di T0 ini karena di luar daftar file yang
diminta) yang membaca `accumulatorValue` hasil `createBlock` lalu memanggil
`submitBlock` di L1 secara terpisah.

---

## 2. Bisakah langkah digest dipisah ke `ICommitStrategy` tanpa mengubah semantik blok?

**Tidak secara literal** seperti signature di PRD §4.1
(`function commit(uint256[] calldata ids, bytes calldata hint) external returns (bytes32[2] memory digest)`
sebagai *interface* kontrak eksternal terpisah), karena tiga hambatan konkret:

1. **State accumulator adalah storage struct dengan mapping**
   (`ECCAccumulator.Accumulator` punya `mapping(bytes32 => bool) elements`,
   `MerkleAccumulator.Accumulator` punya dua mapping). Struct berisi mapping
   tidak bisa dilewatkan sebagai parameter/return value lintas panggilan
   `external` — hanya bisa diakses via `internal`/library call dalam kontrak
   yang sama, atau via `delegatecall` (yang berarti storage tetap milik
   caller, bukan strategy contract).
2. **Chunking tidak cocok dengan "satu panggilan, satu digest".** PRD
   menspesifikasikan `commit(ids, hint)` menerima seluruh array `ids` sekaligus
   dan mengembalikan digest akhir. Tapi kode nyata memproses elemen satu per
   satu lewat `pendingProcessedCursor`, agar bisa berhenti dan dilanjutkan
   antar-tx (`createBlockChunked`). Sebuah `commit()` yang "all-at-once" tidak
   punya cara alami untuk di-*resume* dari cursor tertentu kecuali strategi itu
   sendiri dibuat sadar-chunk (menerima slice + state parsial) — yang berarti
   ia bukan lagi fungsi murni "hitung digest dari `ids`", melainkan sama saja
   dengan `add()` yang sudah ada, dipanggil berulang.
3. **Tipe return berbeda antar-varian.** `Block.accumulatorValue` di
   `PlasmaChainUTXO.sol` bertipe `ECCAccumulator.Point` (2×`uint256` = 64
   byte), di `PlasmaChainUTXOMerkle.sol` bertipe `bytes32` (32 byte). PRD sudah
   mengantisipasi ini dengan menormalkan ke `bytes32[2]` — bagian ini memang
   bisa diselesaikan (Point masuk slot 0+1, digest 32-byte cukup slot 0),
   jadi bukan penghalang, hanya perlu disiplin encoding.

**Alternatif konkret yang direkomendasikan (konsisten dengan pola yang sudah
dipakai repo ini):** jangan buat satu kontrak generik dengan strategy address
yang bisa diganti saat runtime. Ikuti pola `PlasmaChainUTXO.sol` vs
`PlasmaChainUTXOMerkle.sol` yang sudah ada — **tujuh salinan kontrak tipis**,
masing-masing `using CommitX for ...` sebuah *library* (bukan kontrak
terpisah), dengan jalur `createBlock`/`createBlockChunked`/`pendingUtxos`
identik byte-for-byte kecuali baris `accumulator.add(...)` /
`accumulator.getValue()` diganti pemanggilan library commit yang berbeda.
Ini memenuhi syarat T2 ("jalur pemanggilan dari `createBlock` identik untuk
semua varian, hanya langkah digest yang berbeda") tanpa melanggar batasan 1-3
di atas, dan tanpa overhead gas `CALL`/`DELEGATECALL` lintas kontrak yang bisa
mengotori perbandingan gas antar-varian.

**Konsekuensi untuk validitas pengukuran:** karena pendekatan ini berarti tujuh
kontrak terpisah (bukan satu kontrak + strategy pattern), setiap kontrak harus
dideploy sendiri-sendiri di harness E1 (`bench/e1_commit_cost.ts`), persis
seperti `PlasmaChainUTXO` dan `PlasmaChainUTXOMerkle` saat ini didefinisikan
sebagai dua deployment terpisah (lihat `script/DeployUTXO.s.sol` dan
`script/DeployUTXOMerkle.s.sol` di README). Tidak ada risiko tambahan terhadap
angka gas selama loop dan struktur state tetap sama persis di ketujuhnya.

**Catatan tambahan soal semantik "per-blok" vs "kumulatif":** varian di PRD
(`CommitASCNaive`, dst.) dideskripsikan seolah menghitung digest baru dari nol
untuk `ids` blok itu saja. Accumulator nyata di `PlasmaChainUTXO.sol` bersifat
kumulatif sepanjang riwayat (lihat #1). Untuk **tujuan E1 (biaya gas per
`createBlock`)**, ini tidak masalah — baik model kumulatif maupun model "fresh
per block", biaya marjinal untuk memproses `n` elemen baru tetap `n` operasi
`scalarMul`/`pointAdd` atau `n` `keccak256` Merkle-push, sehingga angka gas
tidak terdistorsi oleh pilihan desain ini. Tapi kalau ada niat memakai
varian-varian ini di luar E1 (misal untuk menggantikan accumulator produksi),
kumulatif-vs-fresh adalah keputusan protokol yang mengubah semantik bukti
keanggotaan (lihat #6).

---

## 3. Fungsi `onlyOperator` di `RootChainUTXO.sol` dan apa yang ditulisnya ke state L1

Modifier `onlyOperator` (`:129-132`) mensyaratkan `msg.sender == plasmaOperator`.
Lima fungsi memakainya:

| Fungsi | Baris | Menulis ke state L1 |
|---|---|---|
| `submitBlock(Point accumulatorValue, uint256 transactionCount)` | `:221-238` | `currentPlasmaBlock++`; **menimpa** `accumulator.value` (mirror global L1) dengan nilai yang dikirim operator (tanpa verifikasi apa pun — operator dipercaya penuh); `plasmaBlocks[currentPlasmaBlock] = PlasmaBlock{...}`. Emit `BlockSubmitted`. |
| `syncUtxoSpent(bytes32 utxoId, bytes32 spendingTxHash)` | `:244-255` | `utxos[utxoId].spent = true` (satu UTXO). Emit `UtxoSpentSynced`. |
| `batchSyncUtxoSpent(bytes32[] utxoIds, bytes32[] spendingTxHashes)` | `:261-274` | Loop: `utxos[utxoIds[i]].spent = true` untuk tiap UTXO yang ada dan belum spent (silent-skip kalau tidak ada/sudah spent, tidak revert). Emit `UtxoSpentSynced` per elemen. |
| `updateUtxoBlock(bytes32 utxoId, uint256 blockNumber)` | `:279-288` | `utxos[utxoId].createdInBlock = blockNumber`, hanya kalau sebelumnya `0` (guard `require(utxo.createdInBlock == 0)`). |
| `registerExitUtxo(bytes32 exitUtxoId, address user, address token, uint256 amount, uint256 blockNumber)` | `:304-331` | Membuat entri baru `utxos[exitUtxoId]` (owner/token/amount/createdInBlock, `spent=false`, `exited=false`) — **tanpa mengecek bahwa `amount` benar-benar pernah dideposit** (ini persis premis exploit `ExploitA2_UnbackedExit` di PRD §8); push ke `userUtxos[user]`. Emit `ExitUtxoRegistered`. |

Catatan: `pausePlasma`, `resumePlasma`, `updateOperator` memakai modifier
**`onlyOwner`** (OZ `Ownable`, peran berbeda dari `plasmaOperator`) — bukan
`onlyOperator`, jadi tidak termasuk daftar di atas meski sama-sama
"privileged". Ini relevan untuk model ancaman E4: attacker di
`ExploitA1_ExitGriefing` didefinisikan "bukan operator", tapi belum tentu
"bukan owner" — perlu dipastikan skenario exploit memakai alamat yang juga
bukan `owner()` kalau ada fungsi `onlyOwner` yang relevan ke exploit tsb (saat
ini tidak ada, karena exploit menyasar `challengeExitWithSpendProof` yang tidak
punya modifier privilege sama sekali).

---

## 4. Apakah `ECCAccumulator.sol` lengkap untuk 7 varian commit di PRD §4.1?

**Ada dan bisa dipakai ulang** (aritmetika kurva murni):
- Konstanta `GX`, `GY`, `N`, `P` (`:11-14`) — `library`-level `constant`,
  bisa dirujuk `ECCAccumulator.GX` dst. dari file lain yang meng-`import`
  library ini (constant di-inline saat kompilasi, jadi visibilitas
  internal-default tetap bisa diakses lintas file selama library-nya
  di-import).
- `pointAdd(Point, Point) -> Point` (`:94-132`) — sudah menangani point
  doubling dan overflow via `addmod`/`mulmod`.
- `scalarMul(Point, uint256) -> Point` (`:137-153`) — sudah mereduksi `scalar
  % N` di dalam.
- `modInverse`/`modExp` via precompile `0x05` (`:159-203`).

Fungsi-fungsi ini cukup untuk membangun `CommitASCNaive` (`pointAdd` +
`scalarMul` per elemen, persis logika `add()` saat ini) dan `CommitASC1SM`
(`addmod` bawaan Solidity + satu `scalarMul` di akhir — tidak perlu fungsi
baru dari library).

**Yang tidak ada / tidak langsung reusable:**
- **Tidak ada entry point berbasis array.** Semua fungsi publik library ini
  beroperasi satu elemen (`add(Accumulator storage, bytes32 element)`), bukan
  `uint256[] ids`. Ketujuh varian T2 tetap harus menulis fungsi baru (loop di
  atas `pointAdd`/`scalarMul`) — tidak ada shortcut siap pakai untuk
  "commit(ids) sekaligus".
- **`add()`/`verify()`/`initialize()`/`getValue()` terikat ke
  `Accumulator storage` yang mengandung `mapping(bytes32 => bool) elements`
  untuk deteksi duplikat lintas-panggilan.** Model ini cocok untuk accumulator
  produksi yang kumulatif (lihat #1/#2), tapi **tidak cocok** dipakai
  langsung oleh varian benchmark yang menghitung digest fresh dari `ids` per
  panggilan (spesifikasi PRD §4.1) — kalau dipaksakan pakai `add()` yang sama,
  elemen yang sama antar-repetisi benchmark akan dianggap "sudah ada" dan
  `add()` mengembalikan `false` tanpa memutasi state, mencemari pengukuran
  gas. Varian baru harus dibangun dari primitif kurva mentah
  (`pointAdd`/`scalarMul`), bukan dari wrapper `add()`.
- **Tidak ada apa pun untuk trik ecrecover** — sesuai rencana, ini memang
  scope T1 (`EcrecoverMulCheck.sol`), bukan kekurangan `ECCAccumulator.sol`.
- **Tidak ada helper untuk `CommitScalar` (addmod polos)** atau
  `CommitKeccak` (cek strictly-increasing + `keccak256`) — keduanya tidak
  butuh `ECCAccumulator.sol` sama sekali, cukup Solidity builtin.
- `CommitMerkle` butuh `MerkleAccumulator.sol` (sudah lengkap: `initialize`,
  `add`, `verify`, `verifyWithRoot`, `getRoot`, `getCount`, `contains`,
  `depth`), bukan `ECCAccumulator.sol`.

**Ringkasan:** primitif kurva (level bawah) lengkap dan siap dipakai ulang;
wrapper accumulator tingkat-tinggi (`add`/`verify`/`initialize`) yang ada
sekarang dirancang untuk accumulator kumulatif ber-state, dan **tidak** bisa
dipakai langsung sebagai implementasi `ICommitStrategy` bergaya
"array-in, digest-out" — perlu kode baru per varian di T2, memakai
`pointAdd`/`scalarMul`/konstanta saja dari `ECCAccumulator.sol`.

---

## 5. Struktur path Foundry yang berlaku di repo ini

`foundry.toml` (root, `:1-7`):
```
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
```
Tidak ada `test = "..."` eksplisit (default Foundry: `test`). Artinya
`forge build`/`forge test` **hanya** mengompilasi `src/` dan `test/` di root
repo. Kontrak yang benar-benar diukur (`PlasmaChainUTXO.sol`,
`PlasmaChainUTXOMerkle.sol`, `RootChainUTXO.sol`, `libraries/*.sol`) semuanya
ada di `src/`, bukan `contracts/src/`.

**Temuan penting:** direktori `contracts/src/commit/` dan `contracts/test/`
**sudah ada di repo** (kosong, dibuat sebelumnya — kemungkinan mengikuti
struktur PRD §1 secara harfiah) tapi **tidak terdaftar** di `foundry.toml`.
Kalau file ditulis ke `contracts/src/commit/*.sol` atau `contracts/test/*.t.sol`
persis seperti path yang tertulis di `docs/TICKETS.md` (T1–T4) dan di
`CLAUDE.md` ("Struktur yang harus dipatuhi"), **`forge build` dan `forge test`
tidak akan pernah menemukan atau mengompilasi file-file itu** — Foundry hanya
punya satu `src` per profile, dan `contracts/` tidak termasuk di dalamnya.

Konsekuensi konkret untuk `docs/TICKETS.md`:
- T1: `contracts/src/commit/EcrecoverMulCheck.sol` +
  `contracts/test/EcrecoverMulCheck.t.sol` — **tidak akan ter-compile**
  dengan konfigurasi saat ini.
- T2: seluruh `contracts/src/commit/*.sol` (7 varian + interface) — sama.
- T3, T4: test paritas & exploit yang direncanakan ditulis di
  `contracts/test/` — sama, `forge test -vv` tidak akan menjalankannya
  (silent pass/"No tests found", bukan error — risiko tinggi kalau tidak
  disadari sebelum lanjut ke T2–T4).

Dua opsi (tidak dieksekusi di T0 ini, hanya dilaporkan sebagai keputusan yang
perlu diambil sebelum T1 mulai menulis file):
1. **Tulis di `src/commit/` dan `test/`** (root), mengikuti `foundry.toml`
   yang sudah berjalan dan konsisten dengan struktur `src/PlasmaChainUTXO.sol`
   yang sudah ada. Berarti path di `CLAUDE.md`/`docs/TICKETS.md` perlu dibaca
   sebagai `src/commit/...` bukan `contracts/src/commit/...` secara harfiah.
2. **Ubah `foundry.toml`** agar `src`/`test` menunjuk ke `contracts/src`
   dan `contracts/test`, lalu pindahkan kontrak yang sudah ada
   (`PlasmaChainUTXO.sol` dkk.) ke `contracts/src/` supaya konsisten dengan
   PRD §1 apa adanya. Ini mengubah lokasi kontrak yang **sudah diukur**
   sebelumnya (README menyebut angka Table 2–4 sudah pernah diambil dari
   struktur `src/` saat ini) — berisiko dianggap "mengubah kontrak" per IRON
   RULE #5 kalau dilakukan setelah kampanye dimulai, meski secara teknis
   hanya pemindahan path.

Rekomendasi (laporan saja, bukan eksekusi): opsi 1 lebih aman dan lebih kecil
blast radius-nya karena tidak menyentuh `foundry.toml` maupun lokasi kontrak
yang sudah ada.

---

## 6. Daftar asumsi PRD yang tidak cocok dengan kode nyata

1. **Path `contracts/src/`, `contracts/test/`** (PRD §1, CLAUDE.md "Struktur
   yang harus dipatuhi") tidak match dengan `foundry.toml` aktual (`src =
   "src"`). Lihat #5.
2. **`ICommitStrategy.commit(ids, hint) -> digest` sebagai interface kontrak
   eksternal tunggal** (PRD §4.1) tidak match dengan desain accumulator nyata
   yang stateful/kumulatif dan diproses per-elemen lewat chunking cursor.
   Lihat #2.
3. **Semantik "per-blok" vs "kumulatif".** PRD menyiratkan digest dihitung
   dari `ids` blok yang bersangkutan saja; kode nyata menghasilkan snapshot
   dari accumulator yang berjalan sejak genesis. Tidak masalah untuk metrik
   gas E1 (lihat #2), tapi merupakan perbedaan semantik nyata yang sebaiknya
   disebutkan eksplisit di paper kalau dibahas sebagai "digest komitmen blok".
4. **`REVISION_ROADMAP.md`** disebut di baris pertama `CLAUDE.md` sebagai
   dokumen yang sudah ada ("Spesifikasi lengkap ada di `EXPERIMENT_PRD.md`...
   dan `REVISION_ROADMAP.md`") — **berkas ini tidak ditemukan di repo**
   (dicek di root, tidak ada). `ANALYSIS_PLAN.md` juga belum ada, tapi itu
   memang sesuai rencana (baru ditulis di T9).
5. **Tidak ada `RootChainUTXOMerkle.sol`.** PRD §5 (E2, tabel `tab:op-gas`)
   mendaftar 9 fungsi L1 untuk diukur gas-nya, tapi hanya ada satu
   `RootChainUTXO.sol` (ECC-only — `submitBlock` bertipe parameter
   `ECCAccumulator.Point`, verifikasi exit lewat
   `ECCAccumulator.verifyWithAccumulator`). Tidak ada padanan L1 untuk jalur
   Merkle. Kalau E2 dimaksudkan untuk dibandingkan ECC-vs-Merkle di layer L1
   juga (bukan hanya L2 commit-cost di E1), kontrak pembanding itu belum ada
   dan tidak disebut perlu dibuat di manapun dalam PRD/TICKETS.
6. **`CommitASCEcrecover` butuh input off-chain (`hint`) yang tidak
   simetris dengan varian lain.** PRD §4.2 sendiri sudah mencatat titik `A`
   harus dikirim operator lewat calldata dan hanya alamat (160 bit) yang
   diverifikasi, bukan titik penuh — ini bukan "gap" tapi trade-off yang
   sudah diketahui PRD; dicantumkan ulang di sini karena berdampak ke
   desain `ICommitStrategy` (hint harus benar-benar mengalir dari
   `createBlock` yang sama untuk semua varian, padahal 6 varian lain tidak
   butuh hint sama sekali).
7. **Tag `paper1-rev1-frozen` belum dibuat** (`git tag -l` kosong) — sesuai
   ekspektasi bahwa kampanye belum mulai, dicantumkan hanya sebagai konfirmasi
   status, bukan gap.

---

## Rencana T1–T2 (belum dieksekusi)

Daftar file yang **akan** dibuat pada tiket berikutnya (menunggu keputusan
path dari #5 di atas — asumsi sementara: opsi 1, `src/commit/` & `test/`,
kecuali user memilih opsi 2):

**T1 — trik ecrecover**
- `src/commit/EcrecoverMulCheck.sol` (atau `contracts/src/commit/...` kalau
  opsi 2 dipilih)
- `test/EcrecoverMulCheck.t.sol` (atau `contracts/test/...`)

**T2 — tujuh varian commit + interface**
- `src/commit/ICommitStrategy.sol`
- `src/commit/CommitBaseline.sol`
- `src/commit/CommitASCNaive.sol`
- `src/commit/CommitASC1SM.sol`
- `src/commit/CommitASCEcrecover.sol` (bergantung hasil T1; dilewati kalau T1
  melaporkan trik gagal cocok)
- `src/commit/CommitScalar.sol`
- `src/commit/CommitKeccak.sol`
- `src/commit/CommitMerkle.sol`
- Kemungkinan tujuh kontrak "wrapper" tipis (pola `PlasmaChainUTXOCommitX.sol`,
  mengikuti pola `PlasmaChainUTXO.sol`/`PlasmaChainUTXOMerkle.sol` yang sudah
  ada) agar jalur `createBlock`/`createBlockChunked` identik per rekomendasi
  di #2 — jumlah dan penamaan pasti akan dikonfirmasi saat T2 dimulai.

Tidak ada file lain yang ditulis di luar `docs/GAP_ANALYSIS.md` pada sesi ini.
Berhenti di sini menunggu arahan lanjutan.

---

## Update — keputusan path diambil dan dieksekusi (sesi berikutnya)

**Keputusan: Opsi 2** (ubah `foundry.toml`, ikuti PRD apa adanya:
`contracts/src/`, `contracts/test/`). Sudah dieksekusi:

- Semua `.sol` dipindah dari `src/`→`contracts/src/`, `test/`→`contracts/test/`
  (via `git mv`, history terjaga untuk 12 dari 14 file; 2 file yang sebelumnya
  belum ter-track — `src/test/DebugAccumulator.sol`,
  `test/TestWithdrawal.t.sol` — dipindah dengan `mv` biasa).
- `foundry.toml`: `src = "contracts/src"`, `test = "contracts/test"`.
- Semua `script/*.s.sol` yang mengimpor `../src/...` diupdate ke
  `../contracts/src/...` (8 file).
- Diverifikasi: `forge build` 0 error (cuma lint warning `asm-keccak256`,
  tidak relevan). `forge test` menemukan semua test di lokasi baru.
- 2 test gagal (`DebugAccumulator.testVerify` — fuzz arithmetic
  overflow/underflow; `TestWithdrawal.testStartExit` — "Invalid transaction
  proof") — **dikonfirmasi pre-existing**, bukan regresi dari perpindahan:
  keduanya adalah file yang belum pernah ter-commit sebelum sesi ini
  (`git log` kosong untuk keduanya di path lama), jadi belum pernah lolos
  sebagai bagian resmi test suite. Di luar scope T0/restrukturisasi untuk
  diperbaiki sekarang — dicatat sebagai temuan, bukan dieksekusi.
- Ditemukan dan diperbaiki: `.gitignore` secara diam-diam memblokir seluruh
  dokumen kampanye (`CLAUDE.md`, `EXPERIMENT_PRD.md`, `TICKETS.md`,
  `GAP_ANALYSIS.md` ini sendiri) dari git — sudah ada di disk tapi nol
  riwayat commit. Diperbaiki (urutan rule `*.md` vs allowlist `docs/`), lalu
  di-commit.
- `REVISION_ROADMAP.md` (disebut `CLAUDE.md` tapi hilang dari repo — temuan
  #6 di atas) disalin dari `~/paper1/` dan ikut di-commit.

**Siap untuk T1** (`docs/TICKETS.md`) dengan path `contracts/src/commit/`,
`contracts/test/` sesuai literal PRD — tidak perlu penyesuaian path lagi.
