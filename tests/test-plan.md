# Rencana Pengujian

Dua cara menjalankan:

1. **Otomatis**: `npm test` -> hasil aktual di `tests/hasil-pengujian.md` (54 skenario, termasuk 22 skenario minimum rancangan).
2. **Manual / demo**: `npm run db:init`, `npm start`, lalu `bash tests/demo-curl.sh` atau salin perintah dari README ke Postman.

Pemetaan skenario ke ID uji: lihat `tests/hasil-pengujian.md` (hasil aktual per ID uji).

## Fase uji otomatis

| Fase | Konfigurasi | Isi |
|---|---|---|
| A | jam akses `00:00-24:00` (selalu terbuka) | autentikasi, device, token, kebijakan akses, finalisasi + sinkron, token service, akses langsung ke service |
| B | jam akses digeser ke 2 jam ke depan (sekarang di luar rentang) | ubah/finalisasi ditolak di gateway dan di Service Nilai; membaca tetap boleh |
| C | Service Transkrip dimatikan lalu dihidupkan | sinkron gagal -> 502 + `sync_status=gagal`; ulang finalisasi -> `tersinkron` |

## Format tiap skenario

Tujuan, request, hasil diharapkan, hasil aktual, status (LULUS/GAGAL). Hasil aktual dihasilkan dari respons HTTP dan isi database nyata, tidak ditulis manual.

## Uji manual tambahan yang disarankan (belum diotomasi)

- Ubah `ACCESS_HOURS_START/END` di `.env` lalu restart `npm start` dan ulangi `PUT /nilai/:id` untuk melihat penolakan jam akses secara langsung.
- Tunggu >10 menit lalu pakai access token yang sama: harus 401 kedaluwarsa.
