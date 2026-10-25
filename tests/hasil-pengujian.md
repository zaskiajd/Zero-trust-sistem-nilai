# Hasil Pengujian Otomatis

Dihasilkan oleh `npm test` (tests/run-tests.js) pada 2026-10-25T08:55:55.559Z dengan Node v24.13.0.
Semua "Hasil aktual" berasal dari respons HTTP dan isi database nyata saat pengujian berjalan (bukan ditulis manual).

**Ringkasan: 54/54 lulus.**

| No | Tujuan | Request | Hasil diharapkan | Hasil aktual | Status |
|---|---|---|---|---|---|
| 1 | Login valid + device terdaftar menerbitkan access & refresh token | POST /auth/login (mhs1, X-Device-ID: DEV-MHS-01) | 200; access token JWT 10 menit berisi sub & role; refresh token 1 hari tersimpan di DB (sebagai hash) | HTTP 200; exp-iat=600s, sub=4, role=mahasiswa; refresh berlaku 24 jam, disimpan sebagai hash | LULUS |
| 2 | Login password salah ditolak | POST /auth/login (password salah) | 401 | HTTP 401 - Kredensial tidak valid | LULUS |
| 2b | Login user tidak ada ditolak (pesan sama, tidak membocorkan user) | POST /auth/login (user tidak ada) | 401 | HTTP 401 - Kredensial tidak valid | LULUS |
| 3a | Login dari device tidak terdaftar ditolak | POST /auth/login (kredensial benar, X-Device-ID: DEV-TIDAK-ADA) | 403 | HTTP 403 - Device tidak terdaftar untuk user ini | LULUS |
| 3b | Device milik user lain ditolak saat login | POST /auth/login (mhs1 memakai DEV-MHS-02) | 403 | HTTP 403 - Device tidak terdaftar untuk user ini | LULUS |
| 3c | Request terlindungi dari device tidak terdaftar ditolak | GET /nilai (token mhs1 valid, X-Device-ID: DEV-TIDAK-ADA) | 403 | HTTP 403 - Device tidak terdaftar untuk user ini | LULUS |
| 3d | Device milik user lain ditolak pada request terlindungi | GET /nilai (token mhs1, X-Device-ID: DEV-MHS-02) | 403 | HTTP 403 - Device tidak terdaftar untuk user ini | LULUS |
| 3e | Request tanpa header X-Device-ID ditolak | GET /nilai (token valid, tanpa X-Device-ID) | 403 | HTTP 403 - Header X-Device-ID wajib | LULUS |
| 4 | Request terlindungi tanpa access token ditolak | GET /nilai (tanpa Authorization) | 401 | HTTP 401 - Access token tidak ada | LULUS |
| 5a | Access token kedaluwarsa ditolak | GET /nilai (JWT exp 10 detik lalu, ditandatangani benar) | 401 | HTTP 401 - Access token kedaluwarsa | LULUS |
| 5b | Token dengan tanda tangan salah ditolak | GET /nilai (JWT ditandatangani secret lain) | 401 | HTTP 401 - Access token tidak valid (tanda tangan/format salah) | LULUS |
| 5c | Token alg=none ditolak | GET /nilai (JWT tanpa tanda tangan) | 401 | HTTP 401 - Access token tidak valid (tanda tangan/format salah) | LULUS |
| 5d | Role di token tidak cocok database ditolak | GET /nilai (token valid ditandatangani benar, sub=mhs1 tetapi role=dosen) | 401 | HTTP 401 - Role pada token tidak sesuai database | LULUS |
| 6 | Refresh token valid menerbitkan access token baru | POST /auth/refresh {refresh_token} | 200 + access token baru yang dapat dipakai | refresh HTTP 200; pemakaian token baru: HTTP 200 | LULUS |
| 7 | Refresh token yang sudah logout/dicabut ditolak | POST /auth/logout lalu POST /auth/refresh dengan token yang sama | logout 200, refresh 401, logout ulang 401, kolom revoked_at terisi | logout 200, refresh HTTP 401 - Refresh token sudah dicabut, logout ulang 401, baris revoked_at terisi=1 | LULUS |
| 7b | Refresh token kedaluwarsa ditolak | POST /auth/refresh (expires_at di DB dimundurkan) | 401 | HTTP 401 - Refresh token kedaluwarsa | LULUS |
| 7c | Refresh token palsu ditolak | POST /auth/refresh {refresh_token: "acak"} | 401 | HTTP 401 - Refresh token tidak dikenal | LULUS |
| 7e | Device yang dinonaktifkan membuat refresh token tidak dapat dipakai | POST /auth/refresh setelah devices.active=0 untuk device login | 403 | HTTP 403 - Device pada refresh token tidak lagi terdaftar | LULUS |
| 8a | Mahasiswa hanya melihat nilai miliknya | GET /nilai (mhs1) | 200, semua baris ber-NIM mhs1 | HTTP 200; 2 baris, NIM: 2210001 | LULUS |
| 8b | Mahasiswa meminta nilai mahasiswa lain ditolak | GET /nilai?nim=2210002 (mhs1) | 403 | HTTP 403 - Mahasiswa hanya boleh melihat nilai miliknya sendiri | LULUS |
| 8c | Dosen hanya melihat nilai kelas yang diampu | GET /nilai (dosen1) | 200, hanya IF301 | HTTP 200; kelas: IF301 | LULUS |
| 8d | Dosen meminta nilai kelas dosen lain ditolak | GET /nilai?kelas_id=2 (dosen1) | 403 | HTTP 403 - Dosen bukan pengampu kelas ini | LULUS |
| 8e | Admin tidak berhak ke /nilai (least privilege, Tabel 3) | GET /nilai (admin) | 403 | HTTP 403 - Role admin tidak berhak melihat /nilai | LULUS |
| 9 | Dosen tidak dapat mengubah nilai kelas dosen lain | PUT /nilai/<id kelas 2> (dosen1) | 403; nilai di DB tidak berubah | HTTP 403 - Dosen bukan pengampu kelas ini; nilai di DB tidak berubah=true | LULUS |
| 10 | Dosen pengampu mengubah nilai yang belum final dalam jam akses | PUT /nilai/<id kelas 1> {nilai: 91} (dosen1) | 200 dan nilai berubah di DB | HTTP 200 - Nilai diperbarui; nilai di DB=91 | LULUS |
| 10b | Validasi input nilai (di luar 0-100 / bukan angka) | PUT /nilai/<id> {nilai: 150} dan {nilai: "A"} | 400 untuk keduanya | 150 -> 400, "A" -> 400 | LULUS |
| 10c | Mahasiswa tidak dapat mengubah nilai | PUT /nilai/<id> (mhs1) | 403 | HTTP 403 - Role mahasiswa tidak berhak mengubah nilai | LULUS |
| 13 | Dosen pengampu memfinalisasi kelas, sinkron ke transkrip lewat gateway | POST /kelas/2/finalisasi (dosen2) | 200; nilai final; transkrip terisi; audit memuat POST /auth/service & POST /transkrip/sinkron oleh service | HTTP 200 - Kelas difinalisasi dan transkrip tersinkron; nilai final=3, baris transkrip=3, sync_status=tersinkron; audit service: /auth/service, /transkrip/sinkron | LULUS |
| 11 | Nilai yang sudah final tidak dapat diubah | PUT /nilai/<id kelas 2> (dosen2, setelah finalisasi) | 403; nilai tetap 80 | HTTP 403 - Nilai sudah final dan tidak dapat diubah; nilai di DB=80 | LULUS |
| 13b | Dosen lain tidak dapat memfinalisasi kelas yang bukan miliknya | POST /kelas/2/finalisasi (dosen1) | 403 | HTTP 403 - Dosen bukan pengampu kelas ini | LULUS |
| 13c | Mahasiswa tidak dapat memfinalisasi kelas | POST /kelas/1/finalisasi (mhs1) | 403 | HTTP 403 - Role mahasiswa tidak berhak memfinalisasi kelas | LULUS |
| 14 | Admin melihat transkrip seluruh mahasiswa | GET /transkrip/2210001 dan /2210002 (admin) | 200 untuk keduanya | NIM1 200 (1 MK), NIM2 200 | LULUS |
| 15 | Mahasiswa melihat transkrip NIM sendiri | GET /transkrip/2210001 (mhs1) | 200, berisi IF302 nilai 80 | HTTP 200; IF302=80 | LULUS |
| 16 | Mahasiswa tidak dapat melihat transkrip NIM lain | GET /transkrip/2210002 (mhs1) | 403 | HTTP 403 - Mahasiswa hanya boleh melihat transkrip NIM sendiri | LULUS |
| 16b | Dosen tidak berhak melihat transkrip | GET /transkrip/2210001 (dosen1) | 403 | HTTP 403 - Role dosen tidak berhak melihat transkrip | LULUS |
| 17 | Token user (dosen & admin) ditolak pada /transkrip/sinkron lewat gateway | POST /transkrip/sinkron {kelas_id:2} (dosen2 lalu admin) | 403 untuk keduanya | dosen: HTTP 403 - Sinkronisasi transkrip hanya menerima token service (token user ditolak); admin: HTTP 403 - Sinkronisasi transkrip hanya menerima token service (token user ditolak) | LULUS |
| 17b | Service Transkrip sendiri menolak token user pada sinkron (gateway secret benar) | POST http://127.0.0.1:3002/transkrip/sinkron langsung, X-Gateway-Secret benar + token dosen2 | 403 | HTTP 403 - Hanya token service yang diizinkan (token user ditolak) | LULUS |
| 21 | Token service: kredensial salah ditolak, benar diterima (5 menit, role service) | POST /auth/service (secret salah, id salah, benar) | 401, 401, 200 (exp-iat=300, role=service) | 401, 401, 200; exp-iat=300s role=service | LULUS |
| 18 | Token service valid dipakai untuk sinkronisasi melalui gateway (idempoten, tanpa duplikat) | POST /transkrip/sinkron {kelas_id:2} (token service) | 200; baris transkrip kelas 2 tetap 3 | HTTP 200 - Sinkronisasi berhasil; baris transkrip kelas 2=3 | LULUS |
| 18b | Token service tidak boleh dipakai pada endpoint user | GET /nilai dan GET /transkrip/2210001 (token service) | 403 untuk keduanya | /nilai 403, /transkrip 403 | LULUS |
| 18c | Sinkron kelas yang belum final ditolak (sumber = DB, bukan kiriman pemanggil) | POST /transkrip/sinkron {kelas_id:1} (token service) | 409 | HTTP 409 - Kelas belum memiliki nilai final | LULUS |
| 19 | Request langsung ke Service Nilai/Transkrip tanpa gateway secret ditolak (walau token user valid) | GET http://127.0.0.1:3001/nilai, GET http://127.0.0.1:3002/transkrip/2210001 tanpa/salah X-Gateway-Secret | 403 untuk semuanya | nilai 403, transkrip 403, secret salah 403 | LULUS |
| 20 | Gateway secret benar tetapi token tidak valid tetap ditolak di service | Request langsung ke service dengan X-Gateway-Secret benar: tanpa token / token acak / kedaluwarsa / service palsu | 401 untuk semuanya | tanpa token 401, token acak 401, kedaluwarsa 401, service palsu 401 | LULUS |
| 20b | Client tidak dapat memalsukan X-Gateway-Secret lewat gateway (gateway menimpa header) | GET /nilai via gateway dengan X-Gateway-Secret palsu + token mhs1 | 200 (secret palsu tidak berpengaruh) | HTTP 200 | LULUS |
| 20c | Endpoint/metode tak dikenal ditolak (default deny) | GET /admin, DELETE /nilai/1, GET /nilai%2F..%2Ftranskrip%2F2210002 | 403 untuk semuanya | /admin 403, DELETE 403, encoded traversal 403 | LULUS |
| 20d | JSON rusak pada /auth/login ditangani dengan 400 (bukan crash) | POST /auth/login body "{rusak" | 400 | HTTP 400 | LULUS |
| 20e | Request dengan header Expect: 100-continue tetap membawa X-Gateway-Secret (klien PowerShell/.NET) | PUT /nilai/<id kelas 1> via gateway dengan Expect: 100-continue | 200; gateway memasang X-Gateway-Secret sebelum proxy (bukan hanya di hook proxyReq) | HTTP 200 - Nilai diperbarui | LULUS |
| 12a | Perubahan nilai di luar jam akses ditolak | PUT /nilai/<id kelas 1> (dosen1; jam akses dikonfigurasi 17:00-18:00, sekarang di luar rentang) | 403 "Di luar jam akses"; nilai tidak berubah | HTTP 403 - Di luar jam akses perubahan/finalisasi (17:00-18:00 Asia/Jakarta); nilai 77 -> 77 | LULUS |
| 12b | Finalisasi di luar jam akses ditolak | POST /kelas/1/finalisasi (dosen1, di luar jam) | 403; kelas tetap belum final | HTTP 403 - Di luar jam akses perubahan/finalisasi (17:00-18:00 Asia/Jakarta); nilai final kelas 1=0 | LULUS |
| 12c | Service Nilai memeriksa ulang jam akses sendiri (gateway dilewati, secret & token valid) | PUT langsung ke Service Nilai dengan X-Gateway-Secret + token dosen1 | 403 "Di luar jam akses" dari service | HTTP 403 - Di luar jam akses (17:00-18:00 Asia/Jakarta) | LULUS |
| 12d | Jam akses hanya membatasi perubahan/finalisasi; membaca tetap boleh | GET /nilai (dosen1, di luar jam) | 200 | HTTP 200 | LULUS |
| S1 | Sinkron gagal ditangani jelas: 502, status final tercatat, sync_status=gagal (tidak diam-diam) | POST /kelas/1/finalisasi (dosen1) saat Service Transkrip mati | 502 dengan sinkron.status=gagal; classes.sync_status=gagal; nilai tetap final; transkrip kosong | HTTP 502 - Nilai sudah final, tetapi sinkronisasi ke transkrip GAGAL; sync_status=gagal; final=3; transkrip=0 | LULUS |
| S2 | Mengulang finalisasi (idempoten) menyelesaikan sinkron yang gagal | POST /kelas/1/finalisasi (dosen1) setelah Service Transkrip hidup lagi | 200; sync_status=tersinkron; transkrip mhs1 memuat IF301 dan IF302 | HTTP 200 - Kelas difinalisasi dan transkrip tersinkron; sync_status=tersinkron; transkrip mhs1: IF301,IF302 | LULUS |
| 22 | Audit log mencatat waktu, subjek, endpoint, device, hasil (allow & deny), dan alasan | SELECT dari tabel audit_logs setelah seluruh skenario | Ada baris allow & deny; kolom wajib terisi; tidak ada token/secret/password di log | 79 baris (allow=40, deny=39); kolom wajib kosong=0; baris user tanpa device (di luar kasus header device memang kosong)=0; bocor secret/token=false; tipe subjek=user/anonymous/service | LULUS |

## Contoh audit log (8 penolakan terakhir)

| Waktu | Subjek | Request | Device | Hasil | HTTP | Alasan |
|---|---|---|---|---|---|---|
| 2026-10-25T08:55:53.346Z | user:dosen1 | POST /kelas/1/finalisasi | DEV-DOSEN-01 | deny | 403 | Di luar jam akses perubahan/finalisasi (17:00-18:00 Asia/Jakarta) |
| 2026-10-25T08:55:53.343Z | user:dosen1 | PUT /nilai/2 | DEV-DOSEN-01 | deny | 403 | Di luar jam akses perubahan/finalisasi (17:00-18:00 Asia/Jakarta) |
| 2026-10-25T08:55:51.937Z | anonymous | POST /auth/login | DEV-MHS-01 | deny | 400 | Request tidak valid (body/JSON rusak atau terlalu besar) |
| 2026-10-25T08:55:51.933Z | user:mhs1 | GET /nilai%2F..%2Ftranskrip%2F2210002 | DEV-MHS-01 | deny | 403 | Tidak ada kebijakan untuk endpoint/metode ini (default deny) |
| 2026-10-25T08:55:51.931Z | user:dosen1 | DELETE /nilai/1 | DEV-DOSEN-01 | deny | 403 | Tidak ada kebijakan untuk endpoint/metode ini (default deny) |
| 2026-10-25T08:55:51.929Z | user:admin | GET /admin | DEV-ADMIN-01 | deny | 403 | Tidak ada kebijakan untuk endpoint/metode ini (default deny) |
| 2026-10-25T08:55:51.907Z | service:service-nilai | GET /transkrip/2210001 | - | deny | 403 | Role service tidak berhak melihat transkrip |
| 2026-10-25T08:55:51.906Z | service:service-nilai | GET /nilai | - | deny | 403 | Role service tidak berhak melihat /nilai |
