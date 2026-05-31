# Inteligentne Fiszki — PoznAI Bielik

Aplikacja edukacyjna ułatwiająca naukę poprzez automatyczne generowanie fiszek z notatek, plików PDF oraz zdjęć. Projekt powstał na bazie startera z warsztatów **PoznAI Bielika** i łączy w sobie potęgę polskiego modelu językowego ze wsparciem zaawansowanego OCR.

Wszystko łączy się przez PCSS API (`llm.hpc.psnc.pl`) — nie wymaga instalacji żadnych modeli lokalnie!

---

## Główne modele użyte w projekcie: Bielik i Qwen

Sercem aplikacji są dwa modele AI dostępne przez PCSS:

* **Bielik — (domyślny model: `bielik_11b`):** odpowiada za dwuetapowe tworzenie fiszek (najpierw generuje trafne pytania, potem krótkie odpowiedzi) oraz za funkcję rozbudowanych wyjaśnień/mentorowania. Nazwa modelu jest konfigurowalna przez zmienną środowiskową `PCSS_MODEL`; w kodzie serwera domyślnie ustawiono `bielik_11b`.
* **Qwen3-VL — (domyślny model: `Qwen3-VL-235B-A22B-Instruct-FP8`):** odpowiada za analizę obrazów / OCR (zamianę zdjęć podręczników na tekst). Serwer inicjalizuje klienta Qwen tym samym kluczem PCSS i domyślnym modelem `Qwen3-VL-235B-A22B-Instruct-FP8`.

---

## Najważniejsze funkcje

* **Multiformatowy import:** Obsługa zwykłego tekstu (`.txt`), dokumentów (`.pdf` dzięki Docling) oraz zdjęć (dzięki Qwen3-VL).
* **Tryb asystenta:** Możliwość dopytania modelu Bielik o szczegółowe wyjaśnienie konkretnej fiszki.
* **Interaktywny frontend (Host & Student):** Prowadzący zarządza ekranem głównym, a uczniowie mogą przesyłać własne fiszki na żywo przez przeglądarkę w telefonie (dzięki Socket.io).
* **Pełna kontrola:** Prompty sterujące generowaniem fiszek są w pełni edytowalne z poziomu interfejsu użytkownika.

---

## Wymagania systemowe

* **Node.js** (wersja 16 lub nowsza) oraz npm.
* **Python** (opcjonalnie, wymagany tylko do obsługi plików PDF).
* Pakiet `docling` (Python) dla ekstrakcji tekstu z PDF.
* **Klucz API PCSS** (token) z dostępem do modeli Bielik i Qwen.

---

## Szybki start (Instalacja i uruchomienie)

### 1. Klonowanie i zależności

Skopiuj repozytorium i zainstaluj pakiety Node.js:

```bash
git clone [https://github.com/TWÓJ-LINK/inteligentne-fiszki.git](https://github.com/TWÓJ-LINK/inteligentne-fiszki.git)
cd inteligentne-fiszki/node
npm install

```

### 2. Konfiguracja środowiska

Skopiuj plik z przykładowymi zmiennymi i wklej swój klucz PCSS, który otrzymałeś na warsztatach:

```bash
cp .env.example .env

```

**Kluczowe zmienne w `.env`:**

* `PCSS_API_KEY` — Twój token autoryzacyjny (wymagane).
* `PCSS_BASE_URL` — Domyślnie `https://llm.hpc.psnc.pl/v1`.
* `PCSS_MODEL` — Domyślnie `bielik_11b`.
* `PORT` — Domyślnie `3000`.

### 3. Uruchomienie aplikacji

Będąc w katalogu głównym projektu lub w folderze `node`, uruchom serwer:

```bash
npm run fiszki

```

*(Alternatywnie: `node fiszki/server.js`)*

### 4. Gotowe! Otwórz przeglądarkę

* **Panel Główny (Host):** `http://localhost:3000`
* **Panel Ucznia (do udostępnienia przez QR):** `http://<twoje-lokalne-ip>:3000/student.html`

---

## API i Endpointy

Serwer Express udostępnia poniższe endpointy do komunikacji z frontendem.

| Metoda | Endpoint | Opis |
| --- | --- | --- |
| **GET** | `/api/capabilities` | Zwraca status dostępności Docling, Qwen i obsługiwanych formatów. |
| **GET** | `/api/fiszki` | Pobiera wszystkie zapisane fiszki w formacie JSON. |
| **POST** | `/api/fiszki` | Dodaje nową fiszkę. Oczekuje payloadu: `{ przod, tyl, talia }`. |
| **PUT** | `/api/fiszki/:id` | Aktualizuje istniejącą fiszkę. |
| **DELETE** | `/api/fiszki/:id` | Usuwa fiszkę z bazy. |
| **POST** | `/api/upload` | Wysyła plik (PDF, TXT, Obraz). Uruchamia ekstrakcję i generowanie fiszek. |
| **POST** | `/api/generate` | Generuje fiszki ze zwykłego tekstu: `{ text, talia }`. |
| **POST** | `/api/explain` | **[Bielik]** Generuje szczegółowe wyjaśnienie dla fiszki: `{ przod, tyl }`. |
| **GET** | `/api/decks` | Zwraca listę dostępnych talii. |

---

## Struktura projektu

Katalog `node/fiszki/` zawiera całą logikę aplikacji:

```text
node/fiszki/
├── server.js              # Główny serwer Express + Socket.io
├── fiszki.json            # Lokalna baza danych fiszek
├── prompts.json           # Plik przechowujący zapisane prompty
├── examples_pdfs/         # Przykładowe pliki PDF do generowania fiszek (node/fiszki/examples_pdfs)
├── modules/
│   ├── bielik.js          # Wrapper komunikacji z PCSS/OpenAI
│   ├── storage.js         # Obsługa odczytu i zapisu JSON DB
│   ├── tokenizer.js       # Dzielenie tekstu na chunki (estymacja tokenów)
│   ├── config.js          # Wczytywanie i zarządzanie promptami
│   └── extractors/        # Ekstraktory danych (.txt, .pdf z Docling, obrazy z Qwen)
└── public/                # Frontend aplikacji
    ├── index.html         # Główny widok (SPA) z trybem nauki
    ├── app.js             # Logika klienta, API i Socket.io
    ├── student.html       # Uproszczony interfejs dla ucznia
    └── style.css          # Arkusz stylów

```

---

## Zależności zewnętrzne i rozwiązywanie problemów

### Integracja Docling (Opcjonalna, dla PDF)

Jeśli chcesz generować fiszki z PDF, potrzebujesz Pythona i biblioteki `docling`. Bez niej przetwarzanie PDF będzie wyłączone, ale TXT i obrazy (Qwen) nadal będą działać.
Aby zainstalować: `pip install docling` (pamiętaj, że przy pierwszym uruchomieniu pobierze ok. 1-2 GB modeli). Najlepiej używać wirtualnego środowiska (`venv`).

### Problemy i błędy

* **Błąd `401 Unauthorized`:** Twój token w `.env` jest pusty lub niepoprawny. Upewnij się, że używasz poprawnego klucza `PCSS_API_KEY`.
* **Ostrzeżenie o braku Docling:** Pojawia się w logach, jeśli biblioteka Python nie jest w ścieżce `PATH`. Wykonaj instalację z instrukcji wyżej.
* **Błąd `EADDRINUSE`:** Port `3000` jest już zajęty przez inną aplikację. Zabij proces lub zmień wartość `PORT` w pliku `.env`.
* **Długi czas ładowania zdjęć:** Model OCR Qwen3-VL przetwarza obrazki i analizuje tekst, co może trwać kilka-kilkanaście sekund w zależności od obciążenia serwerów PCSS.
