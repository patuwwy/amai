# AMAI Developer & Agent Guidelines

## Platform Support & Operating Systems
- **PC Bridge Server (`pc/server.js`, `start_bridge.sh`, `start_bridge.bat`)**:
  - Fully cross-platform: works on **Windows, Linux, and macOS**.
  - Requires only Node.js (18+) and a running Ollama instance.
- **WinUAE Automation & Vision Tools (`pc/winuae.py`, `pc/local_vision.py`, `winuae` skill, `local-vision` skill)**:
  - **WINDOWS ONLY**: Uses the Win32 API (`user32.dll`, `gdi32.dll`) to interact with the WinUAE window.
  - On Linux and macOS, agents must **NOT** execute `winuae.py` or `local_vision.py` as they will fail. On Linux/macOS, interact with AMAI directly or test on real Amiga hardware / FS-UAE.

## WinUAE Automation & Vision (Windows only)
This workspace includes a tool for controlling the running Commodore Amiga emulator (**WinUAE**) on Windows:

- Script: `python pc/winuae.py` (or through the `winuae` skill)
- Capabilities:
  - Take screenshot: `python pc/winuae.py screenshot <output.png>`
  - Type into Shell: `python pc/winuae.py type "<text>" --enter`
  - Send special key: `python pc/winuae.py key <enter|esc|f12|ctrl+c|reset>`
  - Click mouse: `python pc/winuae.py click <x> <y> [--button left|right] [--double]`
  - Focus window: `python pc/winuae.py focus`

When debugging or testing changes on the Amiga, you can execute commands in WinUAE and capture screenshots to visually inspect the Amiga output (Workbench, CLI, Guru Meditation).

## Local Vision & Token Protection
> [!IMPORTANT]
> **Token & Privacy Protection**: WinUAE screenshot analysis consumes high amounts of cloud tokens.
> **DO NOT** send screenshots outside or call `view_file` on them.
> **ALWAYS** use the local vision model (`qwen3.8:latest`) via `python pc/local_vision.py` or the `local-vision` skill:
> - Read CLI output: `python pc/local_vision.py read-cli`
> - Inspect screen: `python pc/local_vision.py inspect "<prompt>"`
> - Check errors / Guru: `python pc/local_vision.py check-error`
> - Autonomous actions: `python pc/local_vision.py agent "<goal>"`

## Documentation & Changelog Language
> [!IMPORTANT]
> **English Only for Project Documentation**:
> All entries in `CHANGELOG.md`, `README.md`, `amai.readme`, and GitHub Release notes **MUST ALWAYS** be written in **English**. Even when interacting with the user in Polish, generate and maintain `CHANGELOG.md` exclusively in English.
