# AMAI Developer & Agent Guidelines

## WinUAE Automation & Vision
This workspace includes a tool for controlling the running Commodore Amiga emulator (**WinUAE**):

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
