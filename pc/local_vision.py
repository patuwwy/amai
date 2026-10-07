#!/usr/bin/env python3
"""
Local Vision & WinUAE Agent Controller using local Ollama (qwen3.8).
Handles screenshot analysis, AmigaDOS CLI text reading, error detection,
and autonomous WinUAE task execution without sending images to external cloud APIs.
"""

import sys
import os
import time
import argparse
import base64
import json
import urllib.request
import urllib.error
from io import BytesIO

# Ensure stdout uses UTF-8 to prevent Windows cp1250 UnicodeEncodeErrors
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

if sys.platform != "win32":
    print("Error: local_vision.py requires Windows (Win32 API) and the WinUAE emulator. It is not supported on Linux/macOS.", file=sys.stderr)
    sys.exit(1)

# Try importing Pillow for image processing / scaling
try:
    from PIL import Image
except ImportError:
    Image = None

# Import winuae functions
try:
    import winuae
except ImportError:
    # If not in path, add current directory
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import winuae

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.environ.get("AMAI_VISION_MODEL", "qwen3.8:latest")


def get_available_model():
    """Find the best matching vision model in local Ollama."""
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read().decode("utf-8"))
            models = [m.get("name", "") for m in data.get("models", [])]
            
            # Check preference order
            for pref in [DEFAULT_MODEL, "qwen3.8:latest", "qwen3.8", "qwen:3.8", "qwen3.6:latest", "qwen2.5-vl", "qwen2.5"]:
                for m in models:
                    if m == pref or pref in m:
                        return m
            if models:
                return models[0]
    except Exception:
        pass
    return DEFAULT_MODEL


def capture_winuae_b64(output_path=None, max_dim=1024):
    """
    Capture WinUAE window screenshot and return base64 encoded string.
    Optionally saves to output_path and resizes if larger than max_dim to speed up inference.
    """
    hwnd, title = winuae.find_winuae_window()
    if not hwnd:
        raise RuntimeError("WinUAE window not found. Please ensure WinUAE is running.")

    temp_path = output_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "last_screenshot.png")
    winuae.capture_screenshot(hwnd, temp_path)

    if Image is not None and max_dim:
        with Image.open(temp_path) as im:
            w, h = im.size
            if max(w, h) > max_dim:
                scale = max_dim / float(max(w, h))
                new_size = (int(w * scale), int(h * scale))
                # Use Resampling.LANCZOS or ANTIALIAS
                resample = getattr(Image.Resampling, "LANCZOS", Image.LANCZOS)
                resized = im.resize(new_size, resample=resample)
                buf = BytesIO()
                resized.save(buf, format="PNG")
                return base64.b64encode(buf.getvalue()).decode("utf-8"), temp_path

    with open(temp_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8"), temp_path


def query_ollama(prompt, image_b64=None, model=None, system=None, stream=False):
    """Send prompt and optional image to local Ollama instance."""
    selected_model = model or get_available_model()

    payload = {
        "model": selected_model,
        "prompt": prompt,
        "stream": stream,
        "options": {
            "temperature": 0.2
        }
    }
    if system:
        payload["system"] = system
    if image_b64:
        payload["images"] = [image_b64]

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    if stream:
        full_text = []
        with urllib.request.urlopen(req, timeout=300) as res:
            for line in res:
                if line:
                    chunk = json.loads(line.decode("utf-8"))
                    text = chunk.get("response", "")
                    sys.stdout.write(text)
                    sys.stdout.flush()
                    full_text.append(text)
                    if chunk.get("done", False):
                        break
        sys.stdout.write("\n")
        sys.stdout.flush()
        return "".join(full_text)
    else:
        with urllib.request.urlopen(req, timeout=300) as res:
            chunk = json.loads(res.read().decode("utf-8"))
            return chunk.get("response", "")


# ---------------- Commands ----------------

def cmd_inspect(args):
    """Inspect current screen with a customizable vision prompt."""
    model = args.model or get_available_model()
    print(f"[*] Capturing WinUAE screenshot... (using model: {model})")
    img_b64, shot_path = capture_winuae_b64(output_path=args.save)
    
    prompt = args.prompt or (
        "Analyze this Commodore Amiga screen screenshot. Describe briefly what is shown "
        "(Workbench, Shell/CLI, Guru Meditation, or application) and list any readable text, "
        "active windows, and prompt state."
    )
    
    print("[*] Running local vision analysis...\n")
    response = query_ollama(prompt, image_b64=img_b64, model=model, stream=True)
    if args.save:
        print(f"\n[+] Screenshot saved to: {args.save}")


def cmd_read_cli(args):
    """OCR and extract text specifically from Amiga CLI / Shell window."""
    model = args.model or get_available_model()
    img_b64, _ = capture_winuae_b64(output_path=args.save)
    
    prompt = (
        "Focus on the Amiga Shell / CLI window on this screen. "
        "Transcribe the command line text, recent command output, and current prompt. "
        "Output ONLY the transcribed CLI text as accurately as possible, preserving line breaks."
    )
    
    print(f"[*] Reading Amiga Shell/CLI text (model: {model})...\n--- CLI OUTPUT START ---")
    query_ollama(prompt, image_b64=img_b64, model=model, stream=True)
    print("--- CLI OUTPUT END ---")


def cmd_check_error(args):
    """Check for Guru Meditation or software crashes."""
    model = args.model or get_available_model()
    img_b64, _ = capture_winuae_b64(output_path=args.save)
    
    prompt = (
        "Look carefully at this Amiga screen. Check if there is:\n"
        "1. A Guru Meditation error (red flashing box, Software Failure #...).\n"
        "2. An Intuition system requester / error dialog box.\n"
        "3. A crash or freeze.\n\n"
        "Respond in format:\n"
        "STATUS: [OK | ERROR | GURU_MEDITATION]\n"
        "DETAILS: <brief description of the error if any, or 'System is normal'>"
    )
    
    print(f"[*] Checking for Amiga errors/crashes (model: {model})...")
    res = query_ollama(prompt, image_b64=img_b64, model=model, stream=False)
    print(res.strip())


def cmd_find(args):
    """Locate a UI element and give approximate window coordinates."""
    model = args.model or get_available_model()
    img_b64, _ = capture_winuae_b64()
    
    prompt = (
        f"Find the UI element: '{args.target}' on this Amiga screen.\n"
        "Identify its location and estimate approximate pixel coordinates (X, Y) relative to the screen dimensions (top-left is 0,0).\n"
        "Format your answer as:\n"
        "FOUND: [YES | NO]\n"
        "COORDINATES: X=<number>, Y=<number>\n"
        "DESCRIPTION: <brief explanation of where it is located>"
    )
    
    print(f"[*] Locating '{args.target}' on Amiga screen...")
    res = query_ollama(prompt, image_b64=img_b64, model=model, stream=False)
    print(res.strip())


def cmd_exec(args):
    """Type command into WinUAE Shell, wait, and inspect the result."""
    hwnd, _ = winuae.find_winuae_window()
    if not hwnd:
        print("ERROR: WinUAE window not found.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Typing into WinUAE Shell: {repr(args.command)}")
    winuae.type_text(hwnd, args.command)
    winuae.send_key(hwnd, "enter")

    wait_time = args.wait if args.wait is not None else 1.2
    print(f"[*] Waiting {wait_time}s for AmigaDOS execution...")
    time.sleep(wait_time)

    model = args.model or get_available_model()
    img_b64, _ = capture_winuae_b64(output_path=args.save)

    verify_prompt = args.verify or (
        f"The command '{args.command}' was just executed in the Amiga Shell.\n"
        "Read the Shell output produced by this command. Did it succeed or produce an error? "
        "Summarize the command result and transcribe any returned text."
    )

    print(f"[*] Analyzing execution result with local model ({model}):\n")
    query_ollama(verify_prompt, image_b64=img_b64, model=model, stream=True)


def cmd_agent(args):
    """
    Autonomous local loop: the local model controls WinUAE actions to accomplish a goal.
    Iteratively captures screenshot, decides action, executes via winuae, and verifies.
    """
    hwnd, _ = winuae.find_winuae_window()
    if not hwnd:
        print("ERROR: WinUAE window not found.", file=sys.stderr)
        sys.exit(1)

    model = args.model or get_available_model()
    max_steps = args.max_steps or 5
    goal = args.goal

    print(f"[*] Starting local WinUAE agent (model: {model})")
    print(f"[*] Goal: {goal}")
    print(f"[*] Max steps: {max_steps}\n")

    system_prompt = (
        "You are an autonomous agent controlling a Commodore Amiga running under WinUAE on Windows.\n"
        "At each step you receive a screenshot of the Amiga screen.\n"
        "You must choose ONE action from the following list to make progress toward the user's goal:\n"
        "1. TYPE <text> [ENTER]\n"
        "   Example: ACTION: TYPE dir RAM: ENTER\n"
        "2. KEY <key_name>\n"
        "   Allowed keys: enter, esc, f12, ctrl+c, execute, reset, backspace, up, down\n"
        "   Example: ACTION: KEY enter\n"
        "3. CLICK <x> <y> [BUTTON=left|right] [DOUBLE]\n"
        "   Example: ACTION: CLICK 320 200 BUTTON=left\n"
        "4. WAIT <seconds>\n"
        "   Example: ACTION: WAIT 2\n"
        "5. DONE <summary of completion>\n"
        "   Example: ACTION: DONE Successfully listed files in RAM:\n\n"
        "Format your reply as follows:\n"
        "OBSERVATION: <what you see on the screen>\n"
        "THOUGHT: <what step is needed next>\n"
        "ACTION: <action specification>"
    )

    history = []

    for step in range(1, max_steps + 1):
        print(f"\n--- [STEP {step}/{max_steps}] ---")
        img_b64, _ = capture_winuae_b64()

        prompt = f"GOAL: {goal}\n"
        if history:
            prompt += "PREVIOUS ACTIONS:\n" + "\n".join(history[-4:]) + "\n"
        prompt += "\nLook at the current screen and output your OBSERVATION, THOUGHT, and ACTION.\n"

        print("[*] Model thinking...", flush=True)
        response = query_ollama(prompt, image_b64=img_b64, model=model, system=system_prompt, stream=True)

        # Parse action
        action_line = None
        for line in response.splitlines():
            line_s = line.strip()
            if line_s.upper().startswith("ACTION:"):
                action_line = line_s[7:].strip()
                break

        if not action_line:
            print("[!] Could not parse ACTION line. Retrying with key enter...")
            action_line = "KEY enter"

        history.append(f"Step {step}: {action_line}")

        # Execute action
        upper_act = action_line.upper()
        if upper_act.startswith("DONE"):
            print(f"\n[+] Agent finished goal: {action_line}")
            return
        elif upper_act.startswith("TYPE"):
            content = action_line[4:].strip()
            press_enter = False
            if content.upper().endswith("ENTER"):
                press_enter = True
                content = content[:-5].strip()
            if (content.startswith('"') and content.endswith('"')) or (content.startswith("'") and content.endswith("'")):
                content = content[1:-1].strip()
            if content.upper().endswith("ENTER"):
                press_enter = True
                content = content[:-5].strip()
            winuae.type_text(hwnd, content)
            if press_enter:
                time.sleep(0.08)
                winuae.send_key(hwnd, "enter")
            time.sleep(1.0)
        elif upper_act.startswith("KEY"):
            k = action_line[3:].strip().lower()
            winuae.send_key(hwnd, k)
            time.sleep(0.5)
        elif upper_act.startswith("CLICK"):
            parts = action_line.split()
            x = int(parts[1]) if len(parts) > 1 else 100
            y = int(parts[2]) if len(parts) > 2 else 100
            btn = "right" if "BUTTON=RIGHT" in upper_act else "left"
            dbl = "DOUBLE" in upper_act
            winuae.mouse_click(hwnd, x, y, button=btn, double=dbl)
            time.sleep(0.5)
        elif upper_act.startswith("WAIT"):
            parts = action_line.split()
            sec = float(parts[1]) if len(parts) > 1 else 1.0
            time.sleep(sec)
        else:
            print(f"[!] Unknown action: {action_line}")

    print("\n[!] Max steps reached without explicit DONE.")


def main():
    parser = argparse.ArgumentParser(description="Local Vision & Autonomous WinUAE Controller via Ollama")
    parser.add_argument("--model", "-m", help=f"Ollama model name (default: {DEFAULT_MODEL})")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # inspect
    p_insp = subparsers.add_parser("inspect", help="Capture screenshot and ask local model to inspect it")
    p_insp.add_argument("prompt", nargs="?", help="Custom question / prompt for the image")
    p_insp.add_argument("--save", help="Path to save screenshot PNG")

    # read-cli
    p_ocr = subparsers.add_parser("read-cli", help="OCR and transcribe Amiga Shell/CLI text")
    p_ocr.add_argument("--save", help="Path to save screenshot PNG")

    # check-error
    p_err = subparsers.add_parser("check-error", help="Check for Guru Meditation or software failure")
    p_err.add_argument("--save", help="Path to save screenshot PNG")

    # find
    p_find = subparsers.add_parser("find", help="Find coordinates of UI element")
    p_find.add_argument("target", help="Element name or description (e.g. 'RAM disk icon', 'close gadget')")

    # exec
    p_exec = subparsers.add_parser("exec", help="Type command into WinUAE and verify output with local vision")
    p_exec.add_argument("command", help="Command to type into AmigaDOS Shell")
    p_exec.add_argument("--wait", type=float, default=1.2, help="Seconds to wait before screenshot")
    p_exec.add_argument("--verify", help="Custom verification question")
    p_exec.add_argument("--save", help="Path to save screenshot PNG")

    # agent
    p_agent = subparsers.add_parser("agent", help="Run local autonomous agent loop to achieve a goal")
    p_agent.add_argument("goal", help="Task description for the agent")
    p_agent.add_argument("--max-steps", type=int, default=5, help="Maximum number of steps")

    args = parser.parse_args()

    if args.command == "inspect":
        cmd_inspect(args)
    elif args.command == "read-cli":
        cmd_read_cli(args)
    elif args.command == "check-error":
        cmd_check_error(args)
    elif args.command == "find":
        cmd_find(args)
    elif args.command == "exec":
        cmd_exec(args)
    elif args.command == "agent":
        cmd_agent(args)


if __name__ == "__main__":
    main()

