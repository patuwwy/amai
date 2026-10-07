# Changelog

All notable changes to the AMAI (Amiga AI Assistant Shell) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-07

### Added
- **Google Gemini API Integration**: Direct communication with Google AI Studio models (`gemini-flash-latest`, `gemini-pro-latest`, `gemini-2.5-flash`, `gemini-2.5-pro`, etc.) via lightweight PC bridge server (`pc/server.js`).
- **OpenAI & OpenRouter Support**: Native OpenAI-compatible streaming client enabling connection to OpenAI, OpenRouter (including `:free` tier models), and custom OpenAI-compatible endpoints.
- **Dynamic Multi-Provider Discovery**: Automatic detection of active models across Ollama (local), Google Gemini, OpenAI, and OpenRouter without hardcoded model lists.
- **Thought Signature Persistence**: Full handling of Gemini's `thought_signature` across multi-turn Amiga tool-calling sessions to ensure continuous reasoning and reliable execution.
- **Enhanced `/model` Command**: 
  - Clean grouped model listing by provider (`[LOCAL]`, `[GOOGLE]`, `[OPENAI]`, `[OPENROUTER]`).
  - Provider filtering: `/model local`, `/model google`, `/model openai`, `/model openrouter`.
  - Noise reduction: Automatic filtering of internal/experimental model snapshots to protect Amiga Topaz console screens.
- **Dynamic Application Versioning**:
  - Centralized version tracking (`amiga/src/lib/version.js`) stamped directly into the Amiga console banner and CLI flags (`-v`, `--version`, `--help`) during build and release.
  - Strict input validation in GitHub Actions release workflow without hardcoded defaults.
- **Release Automation Skill**: Added automated `/release` skill (`.agents/skills/release/SKILL.md`) for validating, tagging, and publishing Amiga releases.

### Changed
- Improved error handling for cloud API responses: concise error messages stripped of raw JSON dumps.
- Automatic retry on temporary HTTP 503 high-demand conditions.

---

## [0.0.1] - 2026-10-06

### Added
- **Initial Release of AMAI (Amiga AI Shell)**: Interactive AI coding assistant for Commodore Amiga (AmigaOS 2.04+).
- **NodeAmiga Runtime & Compiler Support**: Standalone native M68k AmigaOS executables (`amai`, `amai_020`, `amai_040`, `amai_060`) requiring no external runtime.
- **Local Ollama Integration**: Streaming communication via local network bridge (`pc/server.js`) on port 11435.
- **Amiga Agentic Tool Loop**:
  - File reading (`read_file`) from any AmigaDOS device (`RAM:`, `DH0:`, `SYS:`).
  - File creation and surgical search-and-replace patching (`write_file`, `patch_file`).
  - AmigaDOS directory listing and command execution (`list_dir`, `get_cwd`, `run_command`).
- **Safety Approval Modes**:
  - `SMART`: Auto-executes safe read operations while prompting for confirmations on modifications.
  - `MANUAL`: Prompts for user confirmation before every tool call.
  - `AUTO`: Unrestricted execution mode for automated workflows.
- **Reasoning / Thinking Models Support**: Live Amiga console spinner and inline stream parsing for thinking models (DeepSeek-R1, Qwen 2.5/3.x).
- **Persistent Configuration**: In-shell slash commands (`/host`, `/model`, `/mode`, `/encoding`, `/timeout`) automatically saved to `amai.config.json`.
- **Packaging Pipeline**: Automated build and bundling tool (`tools/build_amiga.py`) creating standard `.lha` distribution archives.

