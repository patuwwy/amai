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
