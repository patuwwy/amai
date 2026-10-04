# AMAI - Amiga AI Shell (CLI Agent for Commodore Amiga)

An interactive AI coding assistant in the command-line interface (CLI / Shell) for Commodore Amiga (in the style of **Claude Code / Gemini CLI / Aider**), running directly on the Amiga within the **NodeAmiga** JavaScript runtime and communicating with a local **Ollama** instance on a host PC via a lightweight dedicated Node.js bridge.

Enables interactive pair programming directly on AmigaOS (C, Motorola 680x0 Assembler, ARexx, Amiga E, AmigaDOS batch scripts):

- 📖 **File Reading** from any Amiga volume or device (`RAM:`, `DH0:`, `SYS:`, `DEV:`)
- ✍️ **File Creation & Editing** (full write or surgical search-and-replace `patch`)
- ⚡ **AmigaDOS Command Execution** (SAS/C, VBCC, GCC compilers, scripts, diagnostic commands)
- 🤖 **Agentic Loop** – AI inspects files, plans multi-step fixes, and executes tools with safety approval (`[Y/n]` prompts, SMART risk assessment, or unrestricted AUTO mode)
- 📦 **Standalone Executable Compilation** – bundle into a single self-contained Amiga binary (`NodeAmiga -compile amai amai.js`) that runs independently without NodeAmiga or external libraries.

---

## Project Structure

```text
ai-shell/
├── amai                   # Primary launcher script in the root directory (DEV:)
├── pc/                    # Host PC Bridge (Node.js)
│   ├── server.js          # HTTP/TCP streaming server connecting to Ollama with keepalive
│   └── package.json       # Node.js project manifest
├── amiga/                 # Amiga Client (NodeAmiga)
│   ├── amai.js            # Main CLI entry point script
│   ├── amai.config.json   # Configuration file (host, port, model, safety mode, encoding)
│   ├── compile_amai       # AmigaDOS script to compile amai with CPU auto-detection
│   ├── compile.js         # Interactive compiler assistant (detects CPU via os.cpu)
│   ├── NodeAmiga          # NodeAmiga runtime binary for 68000
│   ├── NodeAmiga_020      # NodeAmiga runtime binary for 68020/030
│   ├── NodeAmiga_040      # NodeAmiga runtime binary for 68040
│   ├── NodeAmiga_060      # NodeAmiga runtime binary for 68060
│   ├── lib/               # Client modules:
│   │   ├── ansi.js        # ANSI console color sequences for Amiga Shell
│   │   ├── config.js      # Configuration loader (supports amai.config.json & legacy ai.json)
│   │   ├── network.js     # TCP socket streaming client with NDJSON parsing
│   │   ├── repl.js        # Interactive REPL prompt and agent loop
│   │   └── tools.js       # Tool execution engine (read, write, patch, dir, cwd, shell)
│   └── libs/              # Bundled NodeAmiga system libraries (path, util, etc.)
└── start_bridge.bat       # Single-click launcher for the PC bridge on Windows
```

---

## 1. Starting the Host PC Bridge

1. Ensure Ollama is installed and running on your PC with your preferred model (e.g. `qwen3.8:latest`):
   ```bash
   ollama run qwen3.8:latest
   ```
2. Start the bridge server on the PC:
   ```cmd
   start_bridge.bat
   ```
   or via command line:
   ```bash
   node bridge
   ```
   The bridge listens on port `11435` across all network interfaces (`0.0.0.0`):
   - For WinUAE: connect to `127.0.0.1:11435`
   - For real Amiga hardware: connect to your PC's LAN IP address (e.g. `192.168.1.16:11435`)

---

## 2. Running in WinUAE (Development & Emulation)

1. WinUAE Configuration:
   - **Hardware -> Expansions / Network**: enable **`bsdsocket.library`** emulation (`bsdsocket_emu=true`).
   - **Hardware -> Memory**: set at least **8 MB Fast RAM** (`fastmem_size=8`).
   - **Host -> Hard drives**: mount the repository directory `c:\github\amiga\ai-shell` as a hard drive directory (e.g. Device: `DEV:`, Volume: `ai-shell`).
2. Boot your Amiga workbench in WinUAE and open a Shell window.
3. Grant script execution permission (one-time setup):
   ```amiga
   Protect DEV:amai +s
   ```
4. Start AMAI:
   ```amiga
   DEV:amai
   ```
   or launch directly from the `amiga/` directory:
   ```amiga
   cd DEV:amiga
   NodeAmiga amai.js
   ```
   _(On 68020/68030 configurations, use `NodeAmiga_020 amai.js` for enhanced execution speed)_.

---

## 3. Running on Real Amiga Hardware

1. Verify that your Amiga has an active TCP/IP stack (**Roadshow**, **AmiTCP**, **Miami**) or simply Impbox with dedicated bsdsocket.library.
2. Copy the `amiga/` directory to your Amiga storage (e.g. `DH0:Tools/amai/`).
3. Set your PC's local IP address in `amai.config.json` (e.g. `"host": "192.168.1.16"`), or pass it via CLI argument:
   ```amiga
   NodeAmiga amai.js -h 192.168.1.16 -m qwen3.8:latest
   ```
4. **Optional: Compile to a Standalone Executable:**
   Run the compile assistant directly from Amiga Shell:
   ```amiga
   compile_amai
   ```
   This executes the base `NodeAmiga` runtime (68000 safe), queries `os.cpu()` / `os.cpus()` to detect the installed processor, and proposes the optimal target compiler:
   - `NodeAmiga` (68000 / 68010 - universal compatibility)
   - `NodeAmiga_020` (68020 / 68030 - A1200 / A3000 / 030 accelerators)
   - `NodeAmiga_040` (68040 - A4000 / 040 accelerators)
   - `NodeAmiga_060` (68060 - 060 accelerators, maximum speed)

   You can also specify the architecture directly:
   ```amiga
   compile_amai 060
   ```
   Or auto-accept the detected architecture without prompting:
   ```amiga
   compile_amai -y
   ```
   This generates a native standalone Amiga executable `amai` which can be placed in `C:` and executed from any directory without NodeAmiga:
   ```amiga
   amai
   ```

---

## 4. Built-in Slash Commands

During an interactive session at the `amai> ` prompt, the following commands are available:

| Command                       | Description                                                                           |
| :---------------------------- | :------------------------------------------------------------------------------------ |
| `/help`                       | Display list of available commands and usage guide                                    |
| `/status`                     | Verify connection to PC bridge and check available Ollama models                      |
| `/mode [smart\|manual\|auto]` | Select tool safety approval mode (`smart`, `manual`, or `auto`)                       |
| `/auto [on\|off]`             | Quick toggle between AUTO mode and SMART mode                                         |
| `/read <path>`                | Read any Amiga file directly into the AI context (e.g. `/read RAM:main.c`)            |
| `/run <command>`              | Execute an AmigaDOS command directly (e.g. `/run dir RAM:`)                           |
| `/model [name]`               | Inspect or switch the active Ollama model (e.g. `/model qwen3.8:latest`)              |
| `/cd [dir]`                   | Inspect or check current working directory                                            |
| `/host <ip>`                  | Switch bridge IP address on the fly (e.g. `/host 192.168.1.16`)                       |
| `/encoding [mode]`            | Set character encoding: `ascii` (default, Topaz safe), `amigapl`, `iso-8859-2`, `raw` |
| `/clear`                      | Clear the current conversation history                                                |
| `/exit` or `/quit`            | Exit AMAI Shell                                                                       |

---

## 5. Agent Tools & Safety System

AMAI equips the LLM (`qwen3.8:latest`) with a suite of tools tailored for AmigaOS development:

1. **`read_file(path)`** – Read files from any Amiga path (includes a 16 KB memory protection cap).
2. **`write_file(path, content)`** – Create or overwrite files on Amiga storage.
3. **`patch_file(path, search, replace)`** – Precise block replacement for surgical code editing.
4. **`list_dir(path)`** – Inspect directories and volume contents.
5. **`get_cwd()`** – Retrieve current working directory path.
6. **`run_command(command)`** – Execute arbitrary AmigaDOS shell commands via `child_process.execSync` (e.g. `vc -c file.c`).

### Safety Approval Modes:

- **`smart` (Default)**: Automatically approves safe read-only operations (`read_file`, `list_dir`, `get_cwd`), but prompts the user for confirmation `[Y/n]` before modifying files or executing shell commands.
- **`manual`**: Prompts the user before every single tool invocation.
- **`auto`**: Fully autonomous mode; executes all tool actions without prompting (recommended for trusted scripts).

---

## 6. Character Encoding & Amiga Topaz Font

Classic Amiga screens (PAL/NTSC Topaz 8 font) do not support UTF-8 characters natively. The PC bridge handles transparent transliteration according to the selected encoding mode:

- **`ascii` (Default)**: Converts Polish diacritics and special Unicode typography (curly quotes, dashes, bullets) to clean standard 7-bit ASCII equivalents.
- **`amigapl`**: Encodes characters according to the classic AmigaPL standard (Commodore Polish localized fonts).
- **`iso-8859-2`**: Standard Latin-2 encoding.
- **`raw`**: Passthrough without modification.
