# Ruang Riset SD — Menulis Artikel

Paket statis siap tayang untuk https://dika-81.github.io/menulis-artikel/.

**Bantuan menyusun artikel ilmiah, bukan memfabrikasi artikel. Ide, judul, dan metodologi penelitian harus berasal dari penulis.** Saran program perlu ditinjau; penulis memeriksa sumber serta bertanggung jawab atas keaslian dan ketepatan artikel. Keluaran berhenti pada rancangan metodologi.

## API key pribadi

Setiap pengguna memasukkan API key sendiri melalui **Pengaturan API** pada situs. Key tidak disertakan dalam source, repositori, atau cadangan draf. Key disimpan di browser pengguna (default sesi tab; penyimpanan perangkat hanya jika dipilih) dan dikirim langsung ke OpenAI melalui header Authorization. Aplikasi tidak mengirim key ke GitHub. Penyimpanan browser tidak terenkripsi; gunakan perangkat tepercaya dan hapus key setelah memakai perangkat bersama.

Jangan menempelkan key ke kode, README, issue, atau commit. Tidak diperlukan GitHub Actions secret untuk key OpenAI. Berkas publik dapat dibaca siapa saja; key tidak boleh ditanam di JavaScript.

## GitHub Pages

Di **Settings → Pages**, pilih **Deploy from a branch**, branch **main**, folder **/ (root)**, lalu **Save**. Semua aset aplikasi berada di root dan menggunakan URL relatif. Tidak ada backend atau dependensi instalasi. Setiap pengguna memerlukan API key serta saldo API sendiri untuk bantuan AI.

## Berkas

index.html, styles.css, print.css, icon.svg, app.js, core.js, ai.js, references.js, storage.js, docx.js, dan local-references.json menjalankan aplikasi. .nojekyll menonaktifkan pemrosesan Jekyll. Jangan unggah .env, draf pribadi, berkas cadangan, atau hasil ekspor artikel ke repositori ini.
