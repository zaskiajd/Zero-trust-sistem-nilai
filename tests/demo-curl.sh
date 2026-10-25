#!/usr/bin/env bash
# Demo manual dengan curl. Prasyarat: "npm run db:init" lalu "npm start" di terminal lain.
# Jalankan: bash tests/demo-curl.sh
# Membaca GATEWAY_SECRET dari .env hanya untuk menunjukkan request langsung ke service.
set -u
cd "$(dirname "$0")/.."
G=http://127.0.0.1:3000
PW='Praktikum#2026'
GWSECRET=$(grep '^GATEWAY_SECRET=' .env | cut -d= -f2-)
json() { node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));$1"; }
show() { echo; echo "### $1"; }
login() { curl -s -X POST $G/auth/login -H 'Content-Type: application/json' -H "X-Device-ID: $2" -d "{\"username\":\"$1\",\"password\":\"$PW\"}"; }

show "1. Login mhs1 (device terdaftar)"
L=$(login mhs1 DEV-MHS-01); echo "$L" | json "({role:d.user.role,expires_in:d.expires_in,refresh_expires_in:d.refresh_expires_in})"
MHS=$(echo "$L" | json d.access_token); MHS_REFRESH=$(echo "$L" | json d.refresh_token)

show "2. Login password salah -> 401"
curl -s -X POST $G/auth/login -H 'Content-Type: application/json' -H 'X-Device-ID: DEV-MHS-01' -d '{"username":"mhs1","password":"salah"}'; echo
show "3. Login device tidak terdaftar -> 403"
curl -s -X POST $G/auth/login -H 'Content-Type: application/json' -H 'X-Device-ID: DEV-ASING' -d "{\"username\":\"mhs1\",\"password\":\"$PW\"}"; echo
show "4. GET /nilai tanpa token -> 401"
curl -s $G/nilai -H 'X-Device-ID: DEV-MHS-01'; echo
show "5. Mahasiswa melihat nilai sendiri -> 200"
curl -s $G/nilai -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'; echo
show "6. Mahasiswa minta nilai mhs2 -> 403"
curl -s "$G/nilai?nim=2210002" -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'; echo
show "7. Mahasiswa minta transkrip NIM lain -> 403"
curl -s $G/transkrip/2210002 -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'; echo

show "8. Dosen1 ubah nilai kelasnya (grade id 1) -> 200"
D1=$(login dosen1 DEV-DOSEN-01 | json d.access_token)
curl -s -X PUT $G/nilai/1 -H "Authorization: Bearer $D1" -H 'X-Device-ID: DEV-DOSEN-01' -H 'Content-Type: application/json' -d '{"nilai":92}'; echo
show "9. Dosen1 ubah nilai kelas dosen2 (grade id 4) -> 403"
curl -s -X PUT $G/nilai/4 -H "Authorization: Bearer $D1" -H 'X-Device-ID: DEV-DOSEN-01' -H 'Content-Type: application/json' -d '{"nilai":100}'; echo

show "10. Dosen2 finalisasi kelas 2 -> sinkron lewat gateway -> 200"
D2=$(login dosen2 DEV-DOSEN-02 | json d.access_token)
curl -s -X POST $G/kelas/2/finalisasi -H "Authorization: Bearer $D2" -H 'X-Device-ID: DEV-DOSEN-02'; echo
show "11. Dosen2 ubah nilai yang sudah final (grade id 4) -> 403"
curl -s -X PUT $G/nilai/4 -H "Authorization: Bearer $D2" -H 'X-Device-ID: DEV-DOSEN-02' -H 'Content-Type: application/json' -d '{"nilai":100}'; echo

show "12. Admin lihat transkrip mhs1 -> 200"
ADM=$(login admin DEV-ADMIN-01 | json d.access_token)
curl -s $G/transkrip/2210001 -H "Authorization: Bearer $ADM" -H 'X-Device-ID: DEV-ADMIN-01'; echo
show "13. Token user di /transkrip/sinkron -> 403"
curl -s -X POST $G/transkrip/sinkron -H "Authorization: Bearer $D2" -H 'X-Device-ID: DEV-DOSEN-02' -H 'Content-Type: application/json' -d '{"kelas_id":2}'; echo

show "14. Request langsung ke service tanpa gateway secret -> 403"
curl -s http://127.0.0.1:3001/nilai -H "Authorization: Bearer $MHS"; echo
curl -s http://127.0.0.1:3002/transkrip/2210001 -H "Authorization: Bearer $ADM"; echo
show "15. Gateway secret benar, tanpa token valid -> 401"
curl -s http://127.0.0.1:3001/nilai -H "X-Gateway-Secret: $GWSECRET"; echo
curl -s http://127.0.0.1:3001/nilai -H "X-Gateway-Secret: $GWSECRET" -H 'Authorization: Bearer token.palsu.sekali'; echo

show "16. Refresh token -> access token baru; logout; refresh lagi -> 401"
curl -s -X POST $G/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$MHS_REFRESH\"}" | json "({access_token_baru: d.access_token.slice(0,20)+'...', expires_in:d.expires_in})"
curl -s -X POST $G/auth/logout -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$MHS_REFRESH\"}"; echo
curl -s -X POST $G/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$MHS_REFRESH\"}"; echo

show "17. Audit log (20 baris terakhir)"
npm run -s audit -- 20
