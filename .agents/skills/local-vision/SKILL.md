---
name: local-vision
description: >-
  Inspect WinUAE Amiga screens, perform OCR on AmigaDOS Shell/CLI, check for Guru Meditation errors,
  and automate WinUAE actions using the local Ollama vision model (qwen3.8) on Windows (WINDOWS ONLY).
  Use this skill whenever you need to check what is on the Amiga screen, verify command output,
  or let the local model control WinUAE, saving cloud tokens and keeping all vision processing local.
  Do not use on Linux or macOS.
---

# Local Vision & WinUAE Agent Skill (Windows Only)

> [!WARNING]
> **Windows Only**: This skill relies on `pc/winuae.py` and the WinUAE emulator on Windows.
> On **Linux** and **macOS**, do NOT execute this skill or `pc/local_vision.py`.

This skill controls screen analysis and automated interaction with the Commodore Amiga emulator (**WinUAE**) using a **locally running Ollama model** (`qwen3.8:latest`).

> [!IMPORTANT]
> **Token & Privacy Protection**: NEVER send WinUAE screenshots to external cloud vision APIs or call `view_file` on them. Always use this local skill (`python pc/local_vision.py`) to inspect the Amiga screen, read CLI text, or detect errors.

---

## Capabilities

1. 🔍 **Local Screen Inspection**: Analyze Workbench, windows, menus, and application states with 0 cloud tokens.
2. 📝 **CLI & Shell OCR**: Accurately transcribe text, prompts, and output directly from the active AmigaDOS Shell.
3. ⚠️ **Guru Meditation & Error Detection**: Automatically detect crash alerts, system requesters, or software failures.
4. 📍 **Element Locator**: Estimate pixel coordinates for icons, gadgets, and window controls.
5. ⚡ **Command Execution & Verification**: Type an AmigaDOS command, wait for execution, and immediately transcribe the result.
6. 🤖 **Autonomous Local Agent**: Let the local model run a feedback loop (screenshot → decide action → execute via WinUAE → verify) to accomplish tasks independently.

---

## Controller Script

The controller script is located at:
`python pc/local_vision.py`

Options:
- `--model <name>`: Override model (defaults to `qwen3.8:latest`, or auto-detects running model in Ollama).

---

## Commands & Usage

### 1. Read Shell / CLI Output (Fast OCR)
Transcribes the visible AmigaDOS Shell text without any external token cost:
```powershell
python pc/local_vision.py read-cli
```
Example output:
```text
[SMART] DEV:amiga/bin > czesc
Ami: Cześć. Jestem AMI, asystent kodowy na Amiga.
[SMART] DEV:amiga/bin >
```

### 2. General Screen Inspection
Capture screenshot and ask the local model to analyze it:
```powershell
# Default overview (Workbench, active window, prompt state)
python pc/local_vision.py inspect

# Custom query
python pc/local_vision.py inspect "What files are listed in the Ram Disk window?"
```

### 3. Check for Errors & Guru Meditation
Fast safety check before or after running critical operations:
```powershell
python pc/local_vision.py check-error
```
Returns:
```text
STATUS: OK
DETAILS: System is normal
```
Or:
```text
STATUS: GURU_MEDITATION
DETAILS: Software Failure #80000004 General Protection Fault
```

### 4. Locate UI Elements / Coordinates
Find screen coordinates for mouse clicks:
```powershell
python pc/local_vision.py find "Ram Disk icon"
python pc/local_vision.py find "Shell window close gadget"
```

### 5. Execute Command & Verify Result
Types command into WinUAE Shell with `Enter`, waits, and transcribes output:
```powershell
python pc/local_vision.py exec "dir RAM:"
python pc/local_vision.py exec "version" --wait 1.0
```

### 6. Autonomous Local Agent Loop
Let the local model control WinUAE actions (typing, clicking, special keys) to achieve a goal:
```powershell
python pc/local_vision.py agent "List directory contents of SYS: and check if Libs drawer exists" --max-steps 5
```
The local model:
1. Captures the current WinUAE screenshot.
2. Formulates observations and thoughts locally.
3. Chooses actions: `TYPE <text> ENTER`, `KEY <key>`, `CLICK <x> <y>`, or `DONE`.
4. Executes the action on WinUAE using the `winuae` automation layer.
5. Continues until the goal is satisfied or `max-steps` is reached.

---

## Timing & Local Model Performance

> [!NOTE]
> `qwen3.8:latest` is a 27B vision model offloaded across GPU and CPU. Generating analysis and OCR typically takes **30 to 60 seconds** per capture.
> - Always give commands and tasks sufficient timeout (at least 60–90s per step).
> - In `agent` mode, steps stream thoughts and actions live to the console.
