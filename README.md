# TOMORO COFFEE · Expiry Monitor — Theme Update

Pembaruan tema visual untuk Holding Time & Expired Monitor multi-toko. Identitas ditampilkan sebagai teks “TOMORO COFFEE” tanpa logo dan tanpa foto produk. Palet warna oranye, krem, putih, dan hitam; layout responsif untuk HP dan desktop. Frontend memakai HTML/CSS/JavaScript dan Supabase. Ini masih starter/prototipe: perubahan ini memperbarui tampilan, bukan sertifikasi keamanan atau bukti pengujian produksi.

## Tema visual
- Wordmark teks TOMORO COFFEE tanpa logo.
- Palet orange/cream/white/black.
- Tidak menggunakan foto produk.
- Responsif untuk layar HP Android dan desktop.

## Fitur yang sudah disiapkan
- Login dengan kode akun + password (kode dipetakan ke email internal `kode@expiry.local`).
- Role `super_admin`, `area_manager`, `store_user`.
- Register Product terpisah dari Add Product / mulai countdown.
- Kategori Milk, Pastry, Premade, Cloud, Chemical, Tea, Powder, Syrup.
- Input jumlah, satuan, lokasi/rak, tanggal dan jam expired manual.
- Countdown dan status aman/warning/expired.
- Pencatatan transaksi Used/Waste dan filter history per bulan/status.
- Export `.xlsx` melalui SheetJS.
- Dashboard Area Manager memilih toko satu per satu; tidak ada alarm massal pada ringkasan.
- Supabase Realtime subscription dasar.
- Edge Function untuk pembuatan akun toko dan Area Manager dengan pemeriksaan role.

## Struktur folder
```text
expiry-monitor/
├── index.html
├── styles.css
├── config.js
├── app.js
├── README.md
└── supabase/
    ├── schema.sql
    ├── seed-first-super-admin.sql
    └── functions/
        └── manage-user/
            └── index.ts
```

## 1. Buat proyek Supabase
1. Buat project di Supabase.
2. Buka **SQL Editor**.
3. Jalankan `supabase/schema.sql`.
4. Di **Project Settings → API**, salin Project URL dan anon/publishable key.
5. Isi `config.js`. Jangan pernah memasukkan `service_role` key ke frontend.

## 2. Buat akun Super Admin pertama
1. Buka **Authentication → Users → Add user**.
2. Buat user dengan email `root@expiry.local`, password yang kuat, dan tandai email confirmed.
3. Salin UUID user tersebut.
4. Ganti placeholder di `supabase/seed-first-super-admin.sql` dengan UUID tadi, lalu jalankan SQL tersebut.
5. Login menggunakan kode `ROOT` dan password yang dibuat.

## 3. Deploy Edge Function
Diperlukan Supabase CLI dan Deno (atau lingkungan yang mendukung deploy Supabase Functions).

```bash
supabase login
supabase link --project-ref PROJECT_REF
supabase functions deploy manage-user
```

Function memakai secret `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY`. Set secrets melalui Supabase CLI/Dashboard. Contoh CLI:

```bash
supabase secrets set SUPABASE_URL="https://PROJECT_REF.supabase.co"
supabase secrets set SUPABASE_ANON_KEY="YOUR_ANON_KEY"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

**Service role key hanya boleh berada di server/Edge Function secrets. Jangan taruh di `config.js`, HTML, atau repository publik.**

## 4. Jalankan frontend
Karena ini frontend statis, gunakan local server, jangan membuka file dengan `file://`.

```bash
npx serve .
```

Buka URL lokal yang ditampilkan. Bisa juga deploy folder frontend ke hosting static seperti Cloudflare Pages atau Netlify. Jangan mengunggah file secret.

## 5. Alur penggunaan
1. Super Admin login sebagai `ROOT`.
2. Super Admin membuat Area Manager melalui menu Manajemen Akun.
3. Area Manager login menggunakan kode dan password yang dibuat.
4. Area Manager mendaftarkan toko melalui menu Manajemen Akun.
5. User toko login dengan kode toko dan password awal.
6. User toko membuka **Register Product**, mendaftarkan produk ke master data.
7. User toko membuka **Holding Time → Add Product**, memilih kategori dan produk dari dropdown, lalu mengisi qty, lokasi, tanggal/jam expired.
8. Ketika produk selesai, tekan Used atau Waste untuk mencatat transaksi.
9. Buka **History & Rekap**, pilih bulan/status, lalu Download Excel.

## Batasan yang perlu diketahui pada starter ini
- Buat Area Manager oleh Super Admin sudah disediakan, tetapi Super Admin perlu membuat area sebelum menugaskan toko; flow area selection lanjutan perlu ditambahkan jika ada banyak area.
- Prototype saat ini menggunakan satu akun toko per toko. Jika dibutuhkan beberapa staf login di toko yang sama, perlu flow tambah user toko tambahan.
- Dashboard Area Manager pada starter ini memilih toko satu per satu; ringkasan angka lintas toko masih minimal.
- Alarm browser perlu diaktifkan lewat tombol karena kebijakan autoplay. Alarm ini tidak dijamin berbunyi jika tab ditutup, browser dihentikan, perangkat sleep, atau OS membatasi audio. Alarm latar belakang yang lebih andal memerlukan implementasi native/push dan pengujian perangkat.
- Voice announcement memakai browser Text-to-Speech; ketersediaan suara Bahasa Indonesia bergantung pada perangkat/browser. Volume 8/10 tidak bisa dipaksa oleh browser; atur volume perangkat.
- Snooze/acknowledgement dan pengelolaan peringatan multi-produk masih perlu penyempurnaan sebelum produksi.
- Waktu input diubah ke ISO pada zona waktu perangkat. Pastikan perangkat toko menggunakan zona waktu yang benar.
- Skema RLS adalah fondasi awal dan harus diuji dengan akun dari role dan toko berbeda sebelum produksi. Tambahkan audit log, pembatasan perubahan status, manajemen password, backup, serta monitoring sebelum digunakan untuk operasional sungguhan.
- Untuk keamanan lebih baik, batasi CORS Edge Function ke domain deployment, aktifkan MFA untuk admin, dan review seluruh policy sebelum go-live.

## Rencana iterasi berikutnya
1. Hardening RLS dan flow pembuatan akun area/toko.
2. Alarm sirine + voice yang dapat dikonfigurasi, multi-produk tanpa spam, snooze dan acknowledgement yang tersimpan.
3. History detail, export Excel yang lebih lengkap, rekap per toko/area.
4. Audit log dan dashboard Area Manager yang lengkap.
5. PWA lalu pengemasan Android/iOS dengan Capacitor atau native jika alarm background wajib.

## Troubleshooting singkat
- **Login gagal:** pastikan akun dibuat melalui Supabase Auth, email internal berupa `kode@expiry.local`, dan profile ada di tabel `profiles`.
- **Tidak bisa buat akun:** cek Edge Function logs dan secrets; hanya role yang sesuai dapat membuat akun.
- **Data kosong:** pastikan user punya profile/store yang benar dan policy RLS telah dijalankan.
- **Export gagal:** perlu koneksi internet untuk memuat SheetJS CDN.
