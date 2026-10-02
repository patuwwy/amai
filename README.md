# Amiga AI Shell (CLI Agent dla Amigi)

Asystent programistyczny AI w linii poleceń (CLI/Shell) dla Amigi (w stylu **Claude Code / Gemini CLI / Aider**), działający w środowisku **NodeAmiga** i komunikujący się z lokalną **Ollamą** na PC za pośrednictwem dedykowanego mostka w Node.js.

Umożliwia interaktywne programowanie bezpośrednio na Amidze (C, Assembler m68k, ARexx, Amiga E, skrypty AmigaDOS):
* 📖 **Odczyt plików** z dysków Amigi (`RAM:`, `DH0:`, `SYS:`, `DEV:`)
* ✍️ **Tworzenie i edycja plików** (pełny zapis lub precyzyjny `patch` fragmentu kodu)
* ⚡ **Wykonywanie poleceń AmigaDOS** (kompilatory SAS/C, VBCC, GCC, skrypty, testy)
* 🤖 **Pętla agenta (Agentic Loop)** – AI proponuje zmiany, użytkownik je zatwierdza `[Y/n]` lub włącza tryb automatyczny (`/auto on`)
* 📦 **Kompilacja do standalone executable** – możliwość spakowania do pojedynczego pliku wykonywalnego Amigi (`NodeAmiga -compile ai ai.js`), który nie wymaga środowiska NodeAmiga na docelowej maszynie.

---

## Struktura projektu

```text
ai-shell/
├── bridge/                # Mostek PC (Node.js)
│   ├── server.js          # Serwer HTTP/TCP streamujący z Ollamy z keepalive
│   └── package.json       # Konfiguracja projektu Node.js
├── amiga/                 # Klient dla Amigi (NodeAmiga)
│   ├── ai.js              # Główny skrypt CLI
│   ├── ai.json            # Plik konfiguracyjny (host, port, model)
│   ├── start_ai           # Skrypt uruchomieniowy AmigaDOS
│   ├── compile_ai         # Skrypt kompilacji do standalone binarki Amigi
│   ├── NodeAmiga          # Binarka NodeAmiga dla 68000
│   ├── NodeAmiga_020      # Binarka NodeAmiga dla 68020/030
│   ├── lib/               # Moduły klienta:
│   │   ├── ansi.js        # Kolorowanie ANSI w Amiga Shell
│   │   ├── config.js      # Zarządzanie konfiguracją
│   │   ├── network.js     # Klient sieciowy (streaming + keepalive)
│   │   ├── repl.js        # Interaktywny prompt i pętla agenta
│   │   └── tools.js       # Narzędzia (fs, patch, child_process.execSync)
│   └── libs/              # Biblioteki systemowe NodeAmiga (path, util, etc.)
└── start_bridge.bat       # Uruchamianie mostka na PC jednym kliknięciem
```

---

## 1. Uruchomienie mostka na PC

1. Upewnij się, że Ollama działa na PC (`ollama run qwen3.8:latest`).
2. Uruchom mostek na PC:
   ```cmd
   start_bridge.bat
   ```
   Mostek nasłuchuje na porcie `11435` na wszystkich interfejsach (`0.0.0.0`).
   * Dla WinUAE: `127.0.0.1:11435`
   * Dla prawdziwej Amigi: Twój adres LAN PC (np. `192.168.1.16:11435`)

---

## 2. Uruchomienie w WinUAE (Środowisko deweloperskie)

1. W konfiguracji WinUAE:
   * **Hardware -> Expansions / Network**: zaznacz **`bsdsocket.library`** (`bsdsocket_emu=true`).
   * **Host -> Hard drives**: dodaj folder `c:\github\amiga\ai-shell` jako wolumen Amigi (np. Device Name: `DEV:`, Volume Label: `ai-shell`).
2. Uruchom Amigę w WinUAE i otwórz Shell.
3. Przejdź do katalogu projektu:
   ```amiga
   cd DEV:amiga
   ```
4. Uruchom klienta:
   ```amiga
   NodeAmiga ai.js
   ```
   *(Na procesorach 68020/68030 możesz użyć `NodeAmiga_020 ai.js` dla lepszej wydajności)*.

---

## 3. Uruchomienie na prawdziwej Amidze

1. Upewnij się, że Amiga ma działający stos sieciowy (**Roadshow**, **AmiTCP** lub **Miami**).
2. Skopiuj katalog `amiga/` na Amigę (np. na dysk `DH0:Tools/ai/`).
3. Zmień adres hosta w `ai.json` na adres IP Twojego PC w sieci lokalnej (np. `"host": "192.168.1.16"`), lub podaj go przy starcie:
   ```amiga
   NodeAmiga ai.js -h 192.168.1.16 -m qwen3.8:latest
   ```
4. **Opcjonalnie: Kompilacja do samodzielnego programu:**
   ```amiga
   NodeAmiga -compile ai ai.js
   ```
   Otrzymasz binarkę `ai`, którą możesz przenieść do `C:` i uruchamiać w dowolnym momencie komendą:
   ```amiga
   ai
   ```

---

## 4. Polecenia wbudowane (Slash Commands)

Podczas pracy w interaktywnym promptcie `amiga-ai> `:

| Polecenie | Opis |
| :--- | :--- |
| `/help` | Wyświetla listę poleceń i pomoc |
| `/read <plik>` | Wczytuje plik z dysku Amigi bezpośrednio do kontekstu AI (np. `/read RAM:main.c`) |
| `/run <polecenie>` | Wykonuje polecenie w powłoce AmigaDOS (np. `/run dir RAM:`) |
| `/model [nazwa]` | Pokazuje lub zmienia aktywny model (np. `/model qwen3.8:latest`) |
| `/status` | Sprawdza połączenie z mostkiem na PC i dostępność modeli w Ollama |
| `/auto [on/off]` | Przełącza automatyczne wykonywanie narzędzi bez pytania o potwierdzenie `[Y/n]` |
| `/clear` | Czyści bieżącą historię rozmowy |
| `/exit` lub `/quit`| Wyjście z programu |

---

## 5. Dostępne narzędzia dla Agenta

Model LLM (`qwen3.8:latest`) ma zdefiniowany zestaw narzędzi do pracy z systemem plików i środowiskiem Amigi:

1. **`read_file(path)`** – bezpieczny odczyt kodu z dowolnego dysku Amigi.
2. **`write_file(path, content)`** – zapisanie nowego pliku lub pełne nadpisanie.
3. **`patch_file(path, search, replace)`** – precyzyjna podmiana wskazanego fragmentu kodu.
4. **`list_dir(path)`** – wylistowanie zawartości katalogu lub wolumenu.
5. **`run_command(command)`** – uruchomienie procesu AmigaDOS przez `child_process.execSync` (np. `vc -c file.c` lub `execute build.sub`).

Przed wykonaniem każdego narzędzia modyfikującego pliki lub system, klient wyświetla propozycję zmian i prosi użytkownika o akceptację `[Y/n]` (chyba że włączono `/auto on`).
