# Revision Roadmap: Paper 1 (IEEE Access, rejected) → main_rev1.tex

**Keputusan arah (disetujui Faldi, 11 Sep 2026):** paper diubah menjadi *negative result + measurement study*, sesuai saran Reviewer 2. Implementasi lama tetap dipakai. Semua angka yang harus diukur ulang ditandai `\fillin{...}` di `main_rev1.tex`. `main.tex` asli tidak diubah.

**Judul baru (draft):** *Why Additive Elliptic-Curve Set Commitments Do Not Help Ethereum Plasma: A Negative Result from an End-to-End UTXO Implementation*

**RQ baru**
- **RQ1 (Algebra):** apa yang sebenarnya dikomit oleh additive ECC commitment, dan properti apa yang dimilikinya dibanding Pedersen commitment, multiset hash, dan accumulator?
- **RQ2 (Protocol):** apa akibatnya pada exit game Plasma di implementasi end-to-end?
- **RQ3 (Cost):** dengan implementasi yang optimal secara aljabar, berapa gas konstruksi di L2 dan anchoring di L1 dibanding keccak digest dan Merkle root?
- **RQ4 (Throughput):** dalam desain 2×2 simetris, berapa bagian perbedaan throughput yang berasal dari primitif, dan berapa dari placement (inline/deferred)?

Status: **A** = accept (dikerjakan), **P** = partial, **D** = disagree dengan alasan, **X** = butuh eksperimen/kode (ada `\fillin`).

---

## A. Isu fatal (menentukan arah)

| ID | Komentar | Status | Aksi di main_rev1.tex |
|---|---|---|---|
| R2-M1 | A = (1+Σeᵢ mod N)·G. Ini checksum modular, kurvanya tidak bekerja | **A** | Proposition 1 (checksum identity) + bukti. Jadi temuan utama. Relasi ke Pedersen (tanpa blinding). |
| R2-M2, R1-4, R2-Q2 | Witness bukan bukti. RQ1 proof-size 64 vs 320 B tidak apple-to-apple | **A** | Proposition 2 (witness vacuity). Tabel proof size diganti tabel "evidence carried": ASC = 0 bit bukti. Istilah "membership proof" dihapus; dipakai tiga istilah: *state digest*, *algebraic consistency witness*, *sound membership proof*. |
| R2-m6, R2-Q2 | Tidak binding ke multiset (sum sama → A sama) | **A** | Proposition 3 (non-binding): collision dan "explain-any-digest" dengan satu elemen penyesuai. |
| R1-1, R2-M4, R3 | Algorithm 4: τ sembarang lolos. τ tidak terikat ke utxoId → exit jujur bisa dibatalkan permanen | **A** | Section IV-B "Attack A1: exit griefing", kode lama tetap ditampilkan sebagai *vulnerable listing*. Diberi syarat perbaikan minimal (inclusion proof yang binding + tx yang benar-benar mengonsumsi utxoId). Status perbaikan repo: `\fillin`. |
| R1-2, R3 | `challengeExitSimple` / non-membership tidak bisa diverifikasi | **A** | Attack A2 + "L1-mirroring dilemma" (R2-M5). |
| R2-M5 | UTXO di-mirror di L1 → komitmen dekoratif | **A** | Section IV-C: dilema dua sisi, dijelaskan eksplisit. Biaya sync L1 ditambahkan ke tabel gas (`\fillin`). |
| R1-11, R3 | Invariant/state-transition formal | **P** | Tabel 8 invariant (conservation, nonexistent value, ownership, double exit, operator sync, chunk recovery, data withholding, liveness): *siapa yang menegakkan* dan *status di prototipe*. Karena paper negative-result, klaimnya bukan "sistem aman", tapi pemetaan jujur. Beberapa sel perlu dicek ke kode: `\todo`. |
| R2-M6 | 165M gas ≈ 100× terlalu besar. Cukup 1 scalarMul | **A + X** | Model biaya dikoreksi: n·ADDMOD + 1 scalarMul. Ditambah trik `ecrecover` (Buterin 2018, <10k gas). Angka lama 165M hanya dilaporkan sebagai *artefak implementasi*. Pengukuran baru: `\fillin`. Analisis 5 ETH dan motivasi BN254 dihapus. |

## B. Metodologi dan eksperimen

| ID | Komentar | Status | Aksi |
|---|---|---|---|
| R1-5 | Pisahkan gas L2 vs L1, jumlah tx L1, calldata, receipt Sepolia | **X** | Tabel gas baru dengan kolom L2 construction / L1 anchoring / L1 tx count / calldata bytes / receipt hash. |
| R1-6, R2-M8, R1-20, R3 | N=10 vs "remains to be fixed". Tidak ada CI | **A + X** | Protokol eksperimen baru: N ≥ 30 per sel, definisi run independen, warm-up, mean/SD/median/p95/CI 95%, failure/retry, uji Welch/Mann-Whitney. Placeholder `\fillin` dihapus dari teks naratif. |
| R1-7, R2-M7 | Asimetris (ECC deferred vs Merkle inline) → 2×2 | **A + X** | RQ4 = desain faktorial 2×2 (+ keccak-digest sebagai sel kontrol). Klaim "keccak di hot path" dihapus karena gas transfer identik (301.576 vs 301.558). |
| R1-7 (TPS) | TPS = tx atau operasi logis dalam batch? | **A** | Metrik diganti: *local hot-path UTXO operations/s* (ops/s), terpisah dari *L2 blockchain tx/s*. |
| R1-8, R3 | 2.000–2.373 TPS bukan throughput sistem. 50–200 TPS tidak diukur | **A** | Estimasi 50–200 TPS dihapus. Opsional: full-pipeline benchmark (`\fillin`, ditandai opsional). |
| R1-9, R2-m1, m2, R3 | 2.318 vs 2.373, 129–235 vs 125–137 | **A** | Semua angka lama dihapus dari teks. Hasil baru dari satu *frozen dataset*. Tabel dibuat otomatis dari CSV (disarankan script). |
| R1-10 | 290× harus diframing ulang | **A** | Jadi "biaya menjalankan scalarMul sinkron per transfer" (sel ECC-inline vs ECC-deferred), bukan keunggulan skema. |
| R1-13 | Commit hash / release tag | **X** | Data Availability Statement + tag rilis + DOI Zenodo `\fillin`. |
| R1-17 | Nilai EXIT_PERIOD / CHALLENGE_PERIOD | **X** | Tabel parameter `\fillin`. |
| R1-18 | Recovery chunked commit | **A** | Dengan 1 scalarMul, chunking tidak diperlukan (dikonfirmasi `\fillin`). Dibahas sebagai kelemahan desain lama. |
| R3 | Workload lebih representatif (>3 akun) | **X** | Workload: `\fillin{K}` akun, pola acak. |

## C. Minor

| ID | Komentar | Status | Aksi |
|---|---|---|---|
| R1-3, R2-M3 | Theorem 1 kontradiktif | **A** | Diganti Proposition 2: untuk sembarang A_b dan e, W = A_b − e·G lolos. Algorithm 1 line 7 (simpan W saat insert) dihapus. |
| R1-14, R2-m3 | Kolom "Savings" +94,8% | **A** | Kolom diganti "Ratio (ECC/Merkle)". |
| R1-15 | Ukuran witness ≠ calldata gas | **A** | Rumus ABI: point = 2 word. Merkle bytes32[] = offset + length + k word. 16/4 gas per byte nonzero/zero (EIP-2028). |
| R1-16 | Domain separation UTXO id vs tx hash | **A** | Dibahas: di ASC tidak relevan karena digest tetap non-binding. Untuk desain pengganti pakai tagged hash H(tag‖x). |
| R1-19 | "User-acceptable" latency | **A** | Klaim dihapus beserta Nielsen. |
| R1-12 | BN254 akan "restore soundness" terlalu kuat | **A** | Jadi arah riset: butuh konstruksi terspesifikasi (KZG/Nguyen), setup, definisi keamanan. Hanya disebut biaya precompile (EIP-1108, EIP-2537, EIP-4844 point evaluation). |
| R2-m4 | Witness gen O(n) → O(1) | **A** | Tabel kompleksitas diperbaiki. |
| R2-m5 | Digest 64 B > 32 B | **A** | Dibahas. Opsi: scalar s (32 B) atau compressed point (33 B). |
| R2-m7 | Sitasi Pedersen | **A** | Ditambahkan. |
| R2-m8 | KZG + accumulator KZG | **A** | KZG 2010 + Nguyen 2005 + Tas–Boneh 2023. |
| R2-m9 | Plasma revival | **A** | Buterin 2023 + Intmax2 (ePrint 2023/1082). |
| R2-m10 | [27] ResearchGate, [25] GitHub, [20] arXiv, [28] MIT PRIMES, EIP-4844 tanpa sitasi | **A** | [27] → Sun et al., *Computer Engineering* 49(2), 2023. [28] → Tas & Boneh, AFT 2023. [20] Sguanci dihapus (cukup Gudgeon SoK FC 2020). [25] Parity dihapus dari tabel positioning. EIP-4844 disitasi. |
| R2-m11, R3 | [35][36] Verkle post-quantum | **A** | Dihapus. |
| R2-m12, R3 | [32] Nielsen | **A** | Dihapus bersama klaim latency. |
| R3 | [37]–[39] periferal | **P** | [37] Hias dihapus. [38] BEATS dan [39] Schumm diringkas jadi satu kalimat sebagai contoh accumulator yang *sound* di aplikasi. |
| R2-m13 | Kolom "Empirical TPS" di Tabel 1 | **A** | Kolom dihapus. Diganti "Membership evidence". |
| R2-m14 | Kategori submission salah | **A (non-paper)** | Saat submit ulang pilih kategori *Security/Distributed systems*. |
| R3 | Kurangi klaim "Practical" | **A** | Judul dan kontribusi diubah total. |

## D. Literatur baru (terverifikasi)

- T. P. Pedersen, CRYPTO '91, LNCS 576, pp. 129–140, doi:10.1007/3-540-46766-1_9
- A. Kate, G. M. Zaverucha, I. Goldberg, ASIACRYPT 2010, LNCS 6477, pp. 177–194, doi:10.1007/978-3-642-17373-8_11
- M. Bellare, D. Micciancio, EUROCRYPT '97, LNCS 1233, pp. 163–192, doi:10.1007/3-540-69053-0_13
- D. Clarke *et al.*, ASIACRYPT 2003, LNCS 2894, pp. 188–207, doi:10.1007/978-3-540-40061-5_12
- J. Maitin-Shepard, M. Tibouchi, D. F. Aranha, *Comput. J.* 60(4):476–490, 2017, doi:10.1093/comjnl/bxw053
- E. N. Tas, D. Boneh, AFT 2023, LIPIcs 282, 29:1–29:23, doi:10.4230/LIPIcs.AFT.2023.29
- V. Buterin, "Exit games for EVM validiums: the return of Plasma," 14 Nov 2023
- E. Rybakken *et al.*, Intmax2, IACR ePrint 2023/1082
- EIP-4844 (Buterin *et al.*, 2022), EIP-1108 (Salazar Cardozo, Williamson, 2018), EIP-2537 (Vlasov *et al.*, 2020; aktif di Pectra, 7 Mei 2025)
- V. Buterin, "You can *kinda* abuse ECRECOVER to do ECMUL in secp256k1 today," ethresear.ch, 29 Jun 2018
- L. Sun *et al.*, *Computer Engineering* 49(2):46–53, 2023, doi:10.19678/j.issn.1000-3428.0063995 (pengganti ResearchGate STiPChain)

## E. Daftar eksperimen yang harus kamu jalankan (semua `\fillin`)

1. **E1 Commit cost:** 4 implementasi commit blok (n ∈ {10, 100, 1000}): ASC-naive (n scalarMul, kode lama), ASC-1SM (ADDMOD + 1 scalarMul), ASC-ecrecover (ADDMOD + verifikasi titik via ecrecover), keccak digest atas UTXO id terurut, Merkle root (OZ). Laporkan gas L2 dan gas L1 `submitBlock` terpisah, jumlah tx L1, calldata bytes, dan tx hash Sepolia.
2. **E2 L1 sync overhead:** gas `syncUtxoSpent`, `batchSyncUtxoSpent`, `updateUtxoBlock`, `registerExitUtxo` per UTXO (R2-M5).
3. **E3 Throughput 2×2 (+kontrol):** {ASC, Merkle} × {inline, deferred} (+ keccak-digest deferred). N ≥ 30 run per sel, urutan run diacak, ≥ `K` akun. Laporkan mean, SD, median, p95, CI 95%, failure/retry. Uji Welch t-test/Mann-Whitney + effect size.
4. **E4 Exploit PoC:** Foundry test yang membuktikan A1 (griefing via τ sembarang) di kontrak lama, dan test bahwa perbaikan menolaknya.
5. **E5 Parameter:** EXIT_PERIOD, CHALLENGE_PERIOD, block interval, commit hash/tag rilis.
6. **(Opsional) E6 Full pipeline:** transfer → createBlock → submitBlock → konfirmasi Sepolia, dengan block interval tetap.
