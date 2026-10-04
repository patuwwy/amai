---
name: winuae
description: >-
  Control and inspect the WinUAE Commodore Amiga emulator on Windows.
  Use this skill whenever the user asks to interact with WinUAE, check what is on the Amiga screen,
  take screenshots, send keystrokes, execute AmigaDOS / Shell commands, or click with the mouse.
---

# WinUAE Automation Skill

This skill allows Antigravity to interact directly with an active WinUAE emulator session on Windows.

## Capabilities
- 📸 **Screenshot & Vision**: Capture the exact contents of the WinUAE window and inspect Workbench, Shell output, or Guru Meditation errors.
- ⌨️ **Keyboard Automation**: Type text into the active Shell/editor with CIA-safe timings, and send special keys (Enter, Esc, F12, Tab, Ctrl+C, Reset, Execute).
- 🖱️ **Mouse Automation**: Focus window, move cursor (relative mickeys or absolute coordinates), click, double-click, and drag (for Workbench menus).

## Controller Script
The canonical Python controller is located in the workspace at:
`python pc/winuae.py`

## Common Commands

### 1. Check WinUAE Status & Focus
```powershell
python pc/winuae.py status
python pc/winuae.py focus
```

### 2. Take a Screenshot & Inspect Screen
```powershell
python pc/winuae.py screenshot winuae_view.png
```
After saving, use `view_file` on `winuae_view.png` to analyze what the Amiga is displaying.

### 3. Type Text into Shell / Prompt
```powershell
python pc/winuae.py type "dir RAM:" --enter
```

### 4. Send Special Keys
```powershell
# Send Enter
python pc/winuae.py key enter

# Send Ctrl+C (Interrupt program)
python pc/winuae.py key ctrl+c

# Open Workbench Execute Command dialog (Right Amiga + E)
python pc/winuae.py key execute

# Open WinUAE Settings GUI
python pc/winuae.py key f12

# Hard Reset Amiga (Ctrl + Left Amiga + Right Amiga)
python pc/winuae.py key reset
```

### 5. Mouse Actions (Click, Move, Drag)
```powershell
# Click at window coordinates (matching screenshot pixels)
python pc/winuae.py click 400 300
python pc/winuae.py click 150 120 --double
python pc/winuae.py click 250 80 --button right

# Relative mouse movement in mickeys (works directly with physical Amiga mouse emulation)
python pc/winuae.py move 50 -20

# Drag mouse (hold button while moving - essential for Amiga menus!)
python pc/winuae.py drag 50 10 50 80 --button right
```
