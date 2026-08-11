# Notlar

Apple Notes hissi veren, iki sütunlu, mobil uyumlu kişisel not uygulaması. Sol klasör sütunu yoktur: not listesi ve editör bulunur.

Uygulama Firebase Firestore ile tek kullanıcı kasası olarak senkron çalışır. Aynı URL ve şifre ile gizli sekme, başka tarayıcı ve başka cihazdan aynı notlar açılır. Firebase bilgileri eklenmemişse geliştirme sırasında localStorage ile yerel demo modunda çalışır.

## Özellikler

- Ayrı başlık ve içerik alanı. Yeni not açılınca başlık otomatik odaklanır; `Enter` içerik alanına geçirir.
- Not oluşturma, düzenleme, arama, sabitleme, çöp kutusuna taşıma, geri yükleme ve çöp kutusundan kalıcı silme.
- Sabit notlar önce, diğer notlar son düzenlenme tarihine göre sıralanır.
- Büyük, orta, küçük başlık; body text; Apple Notes benzeri gri tek stil; kalın; italik.
- Collapsible bölüm. Hazır bölüm başlığı eklemez; imleç nerede olursa olsun yeni satırda oluşturulur. Kapalıyken ilk satır ve üç nokta görünür.
- Yapılacaklar listesi. İşaretlenen maddeler otomatik olarak listenin en üstüne taşınır.
- Görsel ekleme: ataş butonu ve `Ctrl+V` / `Cmd+V`.
- Otomatik URL algılama yoktur. Metni seçip `Ctrl+K` / `Cmd+K` ile istediğin adresi bağlantı yapabilirsin; URL doğrulaması yapılmaz.
- Not bilgisi menüsünde oluşturulma ve son düzenlenme tarihleri.
- Her not için ayrı AES-GCM şifreleme açma/kapatma.
- Uygulama giriş kilidi. İlk şifre `1234`.
- Ayarlardan giriş şifresi ve açık/koyu tema değişimi.
- Ayarlardan body metni boyutu, satır aralığı ve paragraf aralığı. Seçimler Firebase kullanıcı ayarlarında saklanır.
- Mobil ve masaüstü düzeni.
- Tek kullanıcı Firebase kasası. İlk açılışta eski anonim tarayıcı notları ortak kasaya bir kez kopyalanır.

## 1. Gerekenler

1. Node.js 20 veya üstünü kur.
2. GitHub hesabı aç.
3. Firebase hesabı aç.
4. GitHub Pages için bir repository oluştur. Örnek ad: `notlar`.

## 2. Projeyi bilgisayarda çalıştır

Terminal açıp proje klasörüne gir:

```bash
cd /Users/erdinc/Desktop/notlar
npm install
npm run dev
```

Terminalin verdiği adresi tarayıcıda aç. Firebase ayarları henüz eklenmediyse `1234` ile açılan yerel demo modunu görürsün.

## 3. Firebase projesi oluştur

1. [Firebase Console](https://console.firebase.google.com/) adresine gir.
2. `Add project` seç.
3. Proje adına `notlar-app` gibi bir isim ver.
4. Google Analytics zorunlu değil; istemiyorsan kapat.
5. Proje açılınca `Build > Firestore Database` seç.
6. `Create database` seç.
7. Sana yakın bir konum seç.
8. Veritabanı açılınca `Rules` sekmesine gir.
9. Bu projedeki `firestore.rules` dosyasının tamamını Firebase Rules alanına yapıştırıp `Publish` seç.

Rules ilk kurulum/migrasyon için eski anonim kullanıcı verilerine, ardından ortak `/users/private-notes` kasasına erişim verir. `firestore.rules` değiştiğinde Firebase Console içinden tekrar `Publish` seçmelisin.

## 4. Anonim giriş yöntemini aç

1. Firebase Console içinde `Build > Authentication` aç.
2. `Get started` seç.
3. `Sign-in method` sekmesine gir.
4. `Anonymous` sağlayıcısını aç.
5. `Save` seç.

Kullanıcı hesabı veya e-posta sistemi gerekmez. Tarayıcıya anonim Firebase kullanıcı kimliği atanır.

## 5. Web uygulaması kaydı ve Firebase bilgileri

1. Firebase Console ana sayfasına dön.
2. Proje ayarlarını aç.
3. `Your apps` altında web simgesini seç.
4. Uygulama adı olarak `notlar-web` yaz.
5. Hosting kurulumunu şimdilik seçme.
6. Firebase'in gösterdiği `firebaseConfig` değerlerini kopyala.
7. Proje kökünde `.env.local` adında dosya oluştur. `.env.example` dosyasını örnek al.
8. Değerleri şu formatta yaz:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Firebase web config istemci tarafında görünür. Güvenlik Firestore Rules ve anonim kullanıcı sahipliği ile sağlanır. `.env.local` git'e gönderilmez.

## 6. Uygulamayı Firebase ile test et

```bash
npm run dev
```

Sırayla kontrol et:

1. Varsayılan şifre `1234` ile aç.
2. Yeni not oluştur. Başlık yaz, `Enter` bas, içerik yaz.
3. Metin seçip büyük/orta/küçük başlık, tek stil, kalın ve italik seçeneklerini dene.
4. `Ctrl+K` ile seçili metne geçersiz bir adres dahil herhangi bir adres bağla.
5. Yapılacaklar butonuyla liste ekle ve maddeleri işaretle.
6. Collapsible butonuyla bölüm ekle, yaz, oku kapatıp aç.
7. Ataş butonuyla görsel ekle. Ayrıca görseli panoya kopyalayıp editöre `Ctrl+V` ile yapıştır.
8. Notu sabitle. Not listesinde üste çıktığını kontrol et.
9. Üç nokta menüsünden tarihleri kontrol et.
10. Kilit butonuyla notu şifrele. Sayfayı yenile, `1234` ile aç.
11. Ayarlardan temayı değiştir, sayfayı yenile; seçim korunmalı.
12. Şifreyi değiştir. Kilitli notu kapatıp aç; içerik okunmalı.
13. Notu çöp kutusuna taşı, geri yükle, tekrar sil, çöp kutusundan kalıcı sil.

## 7. GitHub repository'ye gönder

`.env.local` dosyasının gönderilmediğini kontrol et. Sonra:

```bash
git init
git add .
git commit -m "feat: add notes app"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADI/notlar.git
git push -u origin main
```

`KULLANICI_ADI` ve repository adını kendi bilgilerinle değiştir.

## 8. GitHub Pages workflow'unu kontrol et

`.github/workflows/deploy.yml` dosyası proje içinde hazır gelir. İçeriğini kontrol etmek veya yeniden oluşturmak istersen önce klasörü oluştur:

```bash
mkdir -p .github/workflows
```

`deploy.yml` içine şunu koy:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install
        run: npm ci
      - name: Build
        run: npm run build
        env:
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID }}
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

Sonra commit edip gönder:

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy to github pages"
git push
```

## 9. GitHub Actions secrets ekle

1. GitHub repository'ni aç.
2. `Settings > Secrets and variables > Actions` yoluna git.
3. `New repository secret` seç.
4. Aşağıdaki 6 secret'ı tek tek ekle:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Value alanlarına Firebase web config değerlerini gir.

## 10. GitHub Pages'i aç

1. Repository içinde `Settings > Pages` aç.
2. `Build and deployment > Source` alanında `GitHub Actions` seç.
3. `Actions` sekmesine git.
4. `Deploy to GitHub Pages` workflow'unun tamamlanmasını bekle.
5. Yeşil tamamlandı işareti gelince workflow detayındaki Pages adresini aç.

Adres genellikle şuna benzer:

```text
https://KULLANICI_ADI.github.io/notlar/
```

## 11. Firebase yetkili domain ekle

Firebase anonim girişinin GitHub Pages üzerinde çalışması için:

1. Firebase Console > `Authentication > Settings > Authorized domains` aç.
2. `Add domain` seç.
3. `KULLANICI_ADI.github.io` ekle.
4. Özel domain kullanıyorsan onu da ekle.

## Önemli sınırlar ve güvenlik

- Firebase web config gizli parola değildir. Asıl koruma Firestore Rules'dır.
- Anonim Firebase hesabı tarayıcıya bağlıdır. Tarayıcı verileri temizlenirse o anonim kullanıcıya ait notlara erişim kaybolabilir.
- Tek kullanıcı kasası anonim kimlik yerine ortak Firebase yolunu kullanır; bu yüzden aynı uygulama şifresiyle gizli sekmeden de açılır. Bu modelde uygulama şifresi erişim kapısıdır; varsayılan `1234` şifresini mutlaka değiştir.
- Şifreli notların anahtarı sunucuya gönderilmez. Giriş şifresini unutursan şifreli not içeriği geri getirilemez.
- Görseller Firebase Storage yerine sıkıştırılmış veri olarak Firestore not gövdesine yazılır. Firestore belge sınırı nedeniyle görsel verisi yaklaşık 600 KB altında tutulur.
- Firestore ücretsiz kotasını aşmamak için gereksiz büyük görseller ve çok sık otomatik kayıt yapılmamalıdır.
- Firebase Console'da Firestore Rules yayımlanmadan uygulamayı herkese açık kullanma.

## Yeni deploy

Kod değişince:

```bash
git add .
git commit -m "fix: update notes app"
git push
```

GitHub Actions otomatik olarak yeniden build edip GitHub Pages'e gönderir.
