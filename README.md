# Sistem Nilai - Zero Trust Security

Praktikum individu Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.
Sistem Nilai dengan API Gateway sebagai Policy Enforcement Point (PEP) yang terpisah dari service, mengikuti NIST SP 800-207.

Prinsip yang diterapkan: **never trust, always verify**, **least privilege**, **assume breach**.

## Arsitektur

```
Client (Postman / curl)
        | Authorization: Bearer <token> + X-Device-ID
        v
API Gateway :3000 (PEP)  -- Policy Engine/Administrator (policy.js, auth.js) -- Audit Log (tabel audit_logs)
        | jika allow + X-Gateway-Secret
        +------------------------------+
        v                              v
Service Nilai :3001            Service Transkrip :3002
(verifikasi secret + token)    (verifikasi secret + token)
        |   ^ sinkron: POST /auth/service lalu POST /transkrip/sinkron  |
        +---+----- SELALU lewat gateway :3000, tidak pernah ke :3002 langsung
                         \                 /
                          Database SQLite bersama
```

| Komponen | Port | Folder |
|---|---|---|
| API Gateway (PEP) + Policy Engine/Administrator + Audit | 3000 | `gateway/` |
| Service Nilai | 3001 | `service-nilai/` |
| Service Transkrip | 3002 | `service-transkrip/` |
| Database bersama (SQLite) | - | `database/` |
| Kode bersama (config, DB, hash password, jam akses) | - | `shared/` |

## Prasyarat

- Node.js **20 atau lebih baru** (diuji pada Node 24.13.0). `better-sqlite3@^12` menyediakan binary siap-pakai untuk Node 20/22/24/26, jadi tidak perlu compiler.
- npm. Jika binary `better-sqlite3` tidak tersedia untuk platform/versi Node Anda, npm akan mengompilasi dari sumber dan membutuhkan toolchain C++ (Windows: Visual Studio Build Tools).

## Instalasi dan menjalankan

```bash
npm install
npm run setup      # membuat .env berisi secret ACAK (tidak menimpa .env yang sudah ada)
npm run db:init    # membuat ulang database + seed (menghapus DB lama)
npm start          # menjalankan gateway :3000, service nilai :3001, service transkrip :3002
```

Alternatif: salin `.env.example` ke `.env` lalu isi secret sendiri. Menjalankan terpisah: `npm run start:gateway`, `npm run start:nilai`, `npm run start:transkrip`.

Melihat audit log: `npm run audit -- 30` (30 baris terakhir).

### Windows (PowerShell)

Perintah `npm` sama persis. Yang berbeda hanya sintaks variabel dan kutip saat memanggil API: **jangan** memakai `curl -d '{"nilai":90}'` di PowerShell 5.1 (quoting-nya merusak JSON sehingga muncul `400 bad_request`). Gunakan `Invoke-RestMethod`.

```powershell
npm install
npm run setup
npm run db:init
npm start
```

Uji cepat dari terminal lain setelah gateway hidup:

```powershell
$G = 'http://127.0.0.1:3000'

$login = Invoke-RestMethod -Method Post -Uri "$G/auth/login" `
  -Headers @{ 'X-Device-ID' = 'DEV-DOSEN-01' } `
  -ContentType 'application/json' `
  -Body (@{ username = 'dosen1'; password = 'Praktikum#2026' } | ConvertTo-Json)

$h = @{ Authorization = "Bearer $($login.access_token)"; 'X-Device-ID' = 'DEV-DOSEN-01' }

# Lihat nilai kelas yang diampu
Invoke-RestMethod -Uri "$G/nilai" -Headers $h | ConvertTo-Json -Depth 5

# Ubah nilai (id 1 = mhs1 di kelas dosen1)
Invoke-RestMethod -Method Put -Uri "$G/nilai/1" -Headers $h `
  -ContentType 'application/json' -Body (@{ nilai = 92 } | ConvertTo-Json)

# Finalisasi kelas 1 (memicu sinkron transkrip lewat gateway)
Invoke-RestMethod -Method Post -Uri "$G/kelas/1/finalisasi" -Headers $h
```

Respons 401/403 akan melempar error. Untuk melihat status dan pesannya:

```powershell
try {
  Invoke-RestMethod -Uri "$G/transkrip/2210002" -Headers $h
} catch {
  [int]$_.Exception.Response.StatusCode    # 403
  $_.ErrorDetails.Message                  # {"error":"forbidden",...}
}
```

`tests/demo-curl.sh` membutuhkan bash: jalankan lewat **Git Bash** (`bash tests/demo-curl.sh`) atau pakai potongan PowerShell di atas.

### Konfigurasi `.env`

| Variabel | Fungsi |
|---|---|
| `JWT_SECRET` | secret tanda tangan JWT (HS256) |
| `GATEWAY_SECRET` | nilai header `X-Gateway-Secret` yang dipasang gateway |
| `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET` | kredensial Service Nilai untuk `POST /auth/service` |
| `ACCESS_HOURS_START`, `ACCESS_HOURS_END` | jam akses ubah/finalisasi nilai, default `07:00`-`21:00` (rentang `[mulai, selesai)`; `24:00` didukung; melewati tengah malam didukung) |
| `ACCESS_TZ` | zona waktu jam akses, default `Asia/Jakarta` |
| `DB_PATH` | lokasi file SQLite |

Untuk demo jam akses: ubah `ACCESS_HOURS_START/END` di `.env` lalu restart `npm start`. Jam akses hanya membatasi **PUT /nilai/:id** dan **POST /kelas/:id/finalisasi** (membaca tidak dibatasi).

## Akun uji dan device ID (seed)

Semua password: `Praktikum#2026` (khusus praktikum, bukan password sungguhan).

| Username | Role | NIM | Device ID terdaftar | Keterangan |
|---|---|---|---|---|
| `admin` | admin | - | `DEV-ADMIN-01` | |
| `dosen1` | dosen | - | `DEV-DOSEN-01` | pengampu kelas 1 (IF301 Keamanan Informasi) |
| `dosen2` | dosen | - | `DEV-DOSEN-02` | pengampu kelas 2 (IF302 Basis Data Lanjut) |
| `mhs1` | mahasiswa | 2210001 | `DEV-MHS-01` | terdaftar di kelas 1 dan 2 |
| `mhs2` | mahasiswa | 2210002 | `DEV-MHS-02` | terdaftar di kelas 1 dan 2 |
| `mhs3` | mahasiswa | 2210003 | `DEV-MHS-03` | terdaftar di kelas 1 dan 2 |

ID nilai (`grades.id`): kelas 1 = 1 (mhs1), 2 (mhs2), 3 (mhs3); kelas 2 = 4 (mhs1), 5 (mhs2), 6 (mhs3).

## Endpoint

| Endpoint | Ditangani | Diizinkan | Kondisi (diputuskan Policy Engine di gateway, diperiksa ulang di service) |
|---|---|---|---|
| `POST /auth/login` | Gateway | semua user | kredensial valid dan `X-Device-ID` terdaftar untuk user |
| `POST /auth/refresh` | Gateway | semua user | refresh token valid, belum kedaluwarsa, belum dicabut |
| `POST /auth/logout` | Gateway | semua user | refresh token valid dan belum dicabut; token dicabut |
| `POST /auth/service` | Gateway | Service Nilai | `client_id` dan `client_secret` valid |
| `GET /nilai` | Nilai | mahasiswa, dosen | mahasiswa: hanya miliknya; dosen: hanya kelas yang diampu. Filter opsional `?nim=` `?kelas_id=` |
| `PUT /nilai/:id` | Nilai | dosen | pengampu kelas, nilai belum final, dalam jam akses. Body `{"nilai": 0-100}` |
| `POST /kelas/:id/finalisasi` | Nilai | dosen | pengampu kelas, dalam jam akses; lalu sinkron ke transkrip |
| `GET /transkrip/:nim` | Transkrip | mahasiswa, admin | mahasiswa: NIM sendiri; admin: semua |
| `POST /transkrip/sinkron` | Transkrip | Service Nilai | hanya token service; token user ditolak. Body `{"kelas_id": n}` |

Semua endpoint selain `/auth/*` wajib `Authorization: Bearer <token>`; request user wajib `X-Device-ID` terdaftar. Endpoint/metode lain **ditolak** (default deny).

## Contoh request (curl)

> Sintaks di bawah untuk **bash/Linux/macOS/Git Bash**. Untuk PowerShell di Windows, lihat bagian [Windows (PowerShell)](#windows-powershell).

```bash
G=http://127.0.0.1:3000
# Login
curl -s -X POST $G/auth/login -H 'Content-Type: application/json' -H 'X-Device-ID: DEV-DOSEN-02' \
  -d '{"username":"dosen2","password":"Praktikum#2026"}'
# -> simpan access_token dan refresh_token
TOKEN=<access_token>

# Lihat nilai (dosen: kelas yang diampu)
curl -s $G/nilai -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN-02'
# Ubah nilai
curl -s -X PUT $G/nilai/4 -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN-02' \
  -H 'Content-Type: application/json' -d '{"nilai":90}'
# Finalisasi + sinkron ke transkrip (lewat gateway)
curl -s -X POST $G/kelas/2/finalisasi -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN-02'
# Transkrip (admin / mahasiswa pemilik)
curl -s $G/transkrip/2210001 -H "Authorization: Bearer $ADMIN_TOKEN" -H 'X-Device-ID: DEV-ADMIN-01'
# Refresh dan logout
curl -s -X POST $G/auth/refresh -H 'Content-Type: application/json' -d '{"refresh_token":"<refresh_token>"}'
curl -s -X POST $G/auth/logout  -H 'Content-Type: application/json' -d '{"refresh_token":"<refresh_token>"}'
# Token service (untuk uji manual sinkron; normalnya dipanggil Service Nilai)
curl -s -X POST $G/auth/service -H 'Content-Type: application/json' \
  -d '{"client_id":"service-nilai","client_secret":"<SERVICE_CLIENT_SECRET di .env>"}'
curl -s -X POST $G/transkrip/sinkron -H "Authorization: Bearer <token_service>" \
  -H 'Content-Type: application/json' -d '{"kelas_id":2}'
```

Skenario lengkap siap-jalan (untuk demo video): `bash tests/demo-curl.sh` (setelah `npm run db:init` dan `npm start`).

## Pengujian

`npm test` (hentikan `npm start` dahulu; port 3000-3002 harus kosong). Runner menjalankan gateway + dua service sungguhan dengan database sementara, menembak API lewat HTTP, lalu menulis laporan lokal ke `tests/hasil-pengujian.md` (tidak dipublikasikan ke repo). Cakupan: seluruh 22 skenario matriks minimum, ditambah uji batas (token `alg=none`, role token dipalsukan, jam akses di service, kegagalan sinkron).

Hasil terakhir saat repositori ini disiapkan: **54/54 lulus** (dijalankan dengan Node 24.13.0).

### Postman (48 request, 67 assertion)

Koleksi siap-import: [`tests/postman/zero-trust-sistem-nilai-v2.postman_collection.json`](tests/postman/zero-trust-sistem-nilai-v2.postman_collection.json). Tidak perlu PowerShell atau curl.

1. Siapkan dan jalankan aplikasi (terminal 1):

   ```powershell
   npm run setup
   npm run db:init
   npm start
   ```

2. Buat environment Postman dari `.env` (terminal 2). Perintah ini mengisi URL, `GATEWAY_SECRET`, dan `SERVICE_CLIENT_SECRET` otomatis, sehingga tidak ada secret yang perlu diketik atau ikut ter-commit:

   ```powershell
   npm run postman:env
   # -> tests/postman/local.postman_environment.json (di-ignore git)
   ```

3. Di Postman: **File > Import** dua file berikut.

   - `tests/postman/zero-trust-sistem-nilai-v2.postman_collection.json`
   - `tests/postman/local.postman_environment.json`

4. Pilih environment **Zero Trust Sistem Nilai - Lokal** (pojok kanan atas). Untuk mencoba manual: kirim request **`00 - Diagnostik & Login mhs1`** (paling atas), lalu langsung kirim request **Mahasiswa: hanya nilai miliknya** di folder `02` — token dipasang otomatis oleh pre-request script. Untuk menjalankan semuanya sekaligus, klik **Run collection** (atau `Ctrl+Shift+R`).

   > **Penting:** pada request yang memakai token, tab **Authorization harus `No Auth`**. Tab Authorization menimpa header `Authorization` dan tidak bisa diubah dari script — ini penyebab utama `401 invalid_token` meski sudah login. Koleksi ini sudah `No Auth` di semua request; kalau Anda pernah menempel token di tab itu, set kembali ke **No Auth**.

   > **Jika `mhs1Token masih kosong`:** pesan tersebut biasanya berasal dari collection lama yang masih terbuka di Postman. Import ulang file collection di atas, hapus atau tutup collection lama agar tidak tertukar, pilih environment **Zero Trust Sistem Nilai - Lokal**, lalu kirim `00 - Diagnostik & Login mhs1` lagi. Buka Postman Console (`Ctrl+Alt+C`) dan pastikan tercetak `versi koleksi: v7` serta token ada pada `scope collection`. Setelah itu kirim request mahasiswa di folder `02`. Token di environment tidak harus diisi manual.

5. Hasil yang diharapkan: **48 request, 67 assertion, 0 gagal** (sekitar 6 detik). Newman juga menghitung request login tambahan dari skrip **Siapkan token**, sehingga total HTTP call bisa terlihat lebih banyak.

| Folder | Cakupan |
|---|---|
| `01 - Autentikasi & Token` | login 5 akun (token disimpan otomatis), password salah, device tak terdaftar, tanpa token, token service, refresh, logout, refresh setelah logout |
| `02 - Nilai (kebijakan akses)` | mahasiswa hanya NIM sendiri, dosen hanya kelas yang diampu, ubah nilai, validasi 0-100, admin ditolak |
| `03 - Finalisasi & sinkronisasi transkrip` | finalisasi, nilai final tidak dapat diubah, dosen lain/mahasiswa ditolak, sinkron hanya dengan token service |
| `04 - Transkrip` | mahasiswa NIM sendiri, NIM lain 403, admin boleh, dosen 403, token service 403 |
| `05 - Akses langsung ke service (assume breach)` | service tanpa gateway secret 403, secret benar + token acak 401, secret salah 403, client tidak bisa memalsukan secret lewat gateway |
| `06 - Default deny` | endpoint, metode, dan path tak dikenal ditolak 403 |

Catatan:

- **Tab Authorization harus `No Auth`.** Tab ini **menimpa** header `Authorization` dan tidak dapat diubah dari script (terbukti: header yang di-`upsert` diabaikan). Kalau tab berisi token lama/placeholder, pre-request berhenti dengan pesan yang menyuruh memilih **No Auth**.
- Request **`00 - Diagnostik & Login mhs1`** (paling atas) melakukan login + GET /nilai sekali klik dan mencetak ke **Postman Console** (`Ctrl+Alt+C`): versi koleksi, token di tiap scope, dan status GET. Gunakan ini untuk memastikan koleksi yang ter-import adalah versi terbaru.
- Bila login mengembalikan access token tetapi request folder `02` melaporkan `mhs1Token` kosong, periksa versi di Console. Script collection v7 menyimpan token ke collection, environment, dan globals. Pesan lama yang meminta menjalankan diagnostik lagi menunjukkan request kemungkinan dijalankan dari collection lama; import ulang file collection v2 dari langkah di atas, pilih environment lokal, kemudian ulangi diagnostik. Pastikan diagnostik mencetak `versi koleksi: v7` dan `scope collection` berisi token.
- **Token tidak perlu di-copy-paste.** Setiap kali request dikirim, pre-request script koleksi mengambil nilai `{{mhs1Token}}`/`{{dosen1Token}}`/dst. lalu **menulis token asli ke header `Authorization`**. Jadi `Bearer {{mhs1Token}}` tidak pernah terkirim apa adanya (penyebab pesan `{"error":"invalid_token"}`). Bila token masih kosong, request berhenti dengan pesan jelas: *"Variabel mhs1Token masih kosong..."*.
- **Token disimpan di collection, environment, dan globals.** Globals membuat token tetap ditemukan walau koleksi di-import lebih dari sekali atau Anda menjalankan login di koleksi lain.
- **Variabel fixture diisi otomatis** (`baseUrl`, `devMhs1`, `password`, `nim*`, `kelas*`, `grade*`) bila kosong. Tanpa ini, `{{devMhs1}}` yang tidak ter-resolve membuat login dibalas **403 device_not_registered** dan token tidak pernah tersimpan — persis gejala "sudah Siapkan token tapi tetap kosong".
- Request **Siapkan token** sekarang punya assertion *"login berhasil (200)"* dan *"mhs1Token tersimpan"*, jadi kegagalan login terlihat langsung di tab Test Results, bukan jadi token kosong yang misterius.
- Folder `02`–`06` diawali request **Siapkan token** (login semua akun) sehingga tiap folder bisa dijalankan mandiri. Access token berlaku 10 menit; bila muncul 401 setelah jeda lama, kirim ulang **Login** atau **Siapkan token**.
- Setelah file koleksi diganti (versi v2), **import ulang** koleksi baru dan hapus koleksi lama di Postman agar tidak tertukar. Pre-request script hanya berlaku pada koleksi yang di-import.
- Koleksi aman dijalankan berulang (finalisasi idempoten). Untuk mengembalikan data seed: hentikan `npm start`, `npm run db:init`, lalu `npm start` lagi.
- Uji jam akses tidak bisa dari Postman saja: ubah `ACCESS_HOURS_START/END` di `.env`, restart, lalu ulangi request `PUT /nilai/:id` atau finalisasi (folder `02`/`03`).
- Alternatif tanpa GUI (CI): `npx newman run tests/postman/zero-trust-sistem-nilai-v2.postman_collection.json -e tests/postman/local.postman_environment.json`.

## Keputusan desain penting

- **Dua lapis kontrol.** Gateway (PEP) memutuskan lewat `gateway/policy.js` dengan membaca DB (pengampu kelas, status final, NIM, jam akses). Service **tidak percaya** gateway: masing-masing memeriksa `X-Gateway-Secret` (waktu konstan), tanda tangan + masa berlaku + issuer JWT, lalu memeriksa ulang kepemilikan/status/jam dari DB. Gateway secret tanpa token valid -> 401; tanpa secret -> 403.
- **Role dari database.** Gateway dan service memuat user dari DB dan menolak token yang `role`-nya tidak sama dengan DB.
- **Token.** Access JWT HS256 10 menit (`sub`, `role`, `iss`); refresh token acak 256-bit berlaku 1 hari, hanya **hash SHA-256**-nya disimpan, dapat dicabut (`revoked_at`); token service 5 menit, `role: service`, `sub` = client ID.
- **Password** di-hash dengan scrypt (bawaan Node, salt acak, perbandingan waktu konstan; login user tak dikenal tetap menjalankan hash agar waktu respons seragam).
- **Sinkron transkrip.** Service Nilai mengambil token service dari `POST /auth/service`, lalu memanggil `POST /transkrip/sinkron` **melalui gateway**. Service Transkrip tidak menerima data nilai dari pemanggil: ia membaca nilai **final** dari DB berdasarkan `kelas_id`, lalu upsert (`UNIQUE(student_id, class_id)`), sehingga sinkron berulang tidak menduplikasi.
- **Kegagalan sinkron (tidak diam-diam).** Nilai ditandai final lebih dulu, `classes.sync_status` = `menunggu`. Sukses -> `tersinkron`. Gagal -> `gagal` + pesan, client menerima **HTTP 502** dengan `sinkron.status = "gagal"` dan saran mengulang. `POST /kelas/:id/finalisasi` bersifat idempoten, jadi mengulangnya menyelesaikan sinkron (terbukti di uji S1/S2). Pilihan ini menghindari rollback yang bisa salah bila respons sinkron hilang tetapi data sudah masuk.
- **Audit log** (`audit_logs`): waktu, subjek (`user:<username>` / `service:<client_id>` / `anonymous`), method, endpoint (tanpa query string), device, `allow`/`deny`, alasan, request ID, dan status HTTP akhir. Token, password, dan secret tidak dicatat (diuji). Teks dari client dibersihkan dari karakter kontrol dan dipotong.
- **Refresh/logout tanpa `X-Device-ID`.** Tabel 3 hanya mensyaratkan refresh token valid, jadi header device tidak diwajibkan di dua endpoint ini. Sebagai gantinya, device yang dipakai saat login disimpan pada refresh token dan harus masih terdaftar/aktif saat refresh.
- **Service hanya bind ke `127.0.0.1`** (`HOST`), tetapi keamanan **tidak** bergantung pada itu: akses langsung tetap ditolak tanpa gateway secret.
- **`X-Gateway-Secret` dipasang sebelum proxy, bukan hanya di hook `proxyReq`.** `http-proxy` sengaja tidak memicu event `proxyReq` bila request membawa header `Expect` (lihat `http-proxy/lib/http-proxy/passes/web-incoming.js`), sehingga klien seperti PowerShell/.NET (`Expect: 100-continue`) akan ditolak service. Karena itu gateway menyetel header ke `req.headers` sebelum meneruskan request; nilai dari client selalu ditimpa (diuji pada kasus 20b dan 20e).

## Keterbatasan

- JWT memakai HS256 dengan satu secret yang dibagi ke gateway dan service (cukup untuk praktikum). Produksi sebaiknya RS256/EdDSA: hanya gateway memegang private key, service memegang public key.
- Satu `.env` dipakai bersama untuk memudahkan demo; di produksi tiap proses hanya memegang secret miliknya.
- Access token tidak dapat dicabut sebelum 10 menit habis (logout hanya mencabut refresh token).
- Tidak ada TLS (HTTP lokal), tidak ada pembatasan laju percobaan login, dan tidak ada rotasi refresh token.
- Service tidak memverifikasi ulang `X-Device-ID` (soal hanya mensyaratkan secret + token di service); device diperiksa di gateway.
- Satu mahasiswa yang terdaftar di kelas tetapi belum punya baris nilai tidak otomatis dibuatkan; data nilai berasal dari seed.
- Peringatan `DeprecationWarning: util._extend` saat gateway berjalan berasal dari pustaka `http-proxy-middleware`/`http-proxy`; tidak memengaruhi fungsi.
