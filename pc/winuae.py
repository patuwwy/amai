#!/usr/bin/env python3
"""
WinUAE Controller for Antigravity / AI Coding Assistants.
Enables screenshots, keyboard input, and mouse clicks for WinUAE.
"""

import sys
import os
import time
import argparse
import ctypes

if sys.platform != "win32":
    print("Error: winuae.py requires Windows (Win32 API) and the WinUAE emulator. It is not supported on Linux/macOS.", file=sys.stderr)
    sys.exit(1)

from ctypes import wintypes
try:
    from PIL import Image
except ImportError:
    Image = None

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

# Enable Per-Monitor DPI Awareness so screenshot and click coordinates match 1:1 on scaled displays
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ('dx', wintypes.LONG),
        ('dy', wintypes.LONG),
        ('mouseData', wintypes.DWORD),
        ('dwFlags', wintypes.DWORD),
        ('time', wintypes.DWORD),
        ('dwExtraInfo', ctypes.c_void_p)
    ]

class INPUT_UNION(ctypes.Union):
    _fields_ = [('mi', MOUSEINPUT)]

class INPUT(ctypes.Structure):
    _fields_ = [
        ('type', wintypes.DWORD),
        ('u', INPUT_UNION)
    ]

def send_mouse_event(flags, dx=0, dy=0, data=0):
    inp = INPUT()
    inp.type = 0  # INPUT_MOUSE
    inp.u.mi.dx = dx
    inp.u.mi.dy = dy
    inp.u.mi.mouseData = data
    inp.u.mi.dwFlags = flags
    inp.u.mi.time = 0
    inp.u.mi.dwExtraInfo = None
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

def attach_desktop():
    """Ensure access to the interactive desktop station even when run as a background service/task."""
    try:
        hwinsta = user32.OpenWindowStationW('winsta0', False, 0x037F)
        if hwinsta:
            user32.SetProcessWindowStation(hwinsta)
        hdesk = user32.OpenDesktopW('default', 0, False, 0x01FF)
        if hdesk:
            user32.SetThreadDesktop(hdesk)
    except Exception as e:
        pass

def find_winuae_window():
    """Find the main visible WinUAE emulator window."""
    attach_desktop()
    found_hwnd = None
    found_title = None

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def enum_cb(h, l):
        nonlocal found_hwnd, found_title
        if not user32.IsWindowVisible(h):
            return True
        length = user32.GetWindowTextLengthW(h)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(h, buff, length + 1)
            title = buff.value
            b_c = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(h, b_c, 256)
            c_name = b_c.value

            is_winuae = (c_name in ('PCsuxRox', 'AmigaPowah')) or (
                'winuae' in title.lower() and
                'visual studio' not in title.lower() and
                c_name != 'Chrome_WidgetWin_1' and
                not title.lower().endswith('.py')
            )
            if is_winuae:
                rect = wintypes.RECT()
                user32.GetWindowRect(h, ctypes.byref(rect))
                w = rect.right - rect.left
                h_size = rect.bottom - rect.top
                if w > 200 and h_size > 200:
                    found_hwnd = h
                    found_title = title
                    return False
        return True

    user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
    return found_hwnd, found_title

def focus_window(hwnd):
    """Bring the window reliably to foreground."""
    attach_desktop()
    fg = user32.GetForegroundWindow()
    if fg == hwnd:
        return True
    fg_t = user32.GetWindowThreadProcessId(fg, None)
    my_t = kernel32.GetCurrentThreadId()

    user32.AttachThreadInput(my_t, fg_t, True)
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(my_t, fg_t, False)
    time.sleep(0.08)
    return user32.GetForegroundWindow() == hwnd

def capture_screenshot(hwnd, output_path):
    """Capture the window content directly to an image file."""
    attach_desktop()
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w = rect.right - rect.left
    h = rect.bottom - rect.top

    if Image is None:
        raise RuntimeError("Pillow is required for taking screenshots. Install with: pip install Pillow (or pip install -r pc/requirements.txt)")

    if w <= 0 or h <= 0:
        raise ValueError(f"Invalid window size: {w}x{h}")

    hdc_src = user32.GetWindowDC(hwnd)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_src)
    hbmp = gdi32.CreateCompatibleBitmap(hdc_src, w, h)
    gdi32.SelectObject(hdc_mem, hbmp)

    # PW_RENDERFULLCONTENT = 2, fallback = 0
    ok = user32.PrintWindow(hwnd, hdc_mem, 2)
    if not ok:
        user32.PrintWindow(hwnd, hdc_mem, 0)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG), ('biHeight', wintypes.LONG),
            ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
            ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', wintypes.LONG), ('biYPelsPerMeter', wintypes.LONG),
            ('biClrUsed', wintypes.DWORD), ('biClrImportant', wintypes.DWORD)
        ]

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = w
    bmi.biHeight = -h  # top-down
    bmi.biPlanes = 1
    bmi.biBitCount = 32

    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(hdc_mem, hbmp, 0, h, buf, ctypes.byref(bmi), 0)

    im = Image.frombuffer('RGBA', (w, h), buf, 'raw', 'BGRA', 0, 1).convert('RGB')
    
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    im.save(output_path)

    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(hwnd, hdc_src)
    return im.size

def press_key_code(vk, scan, extended=False, hold=0.05):
    flags = 1 if extended else 0
    user32.keybd_event(vk, scan, flags, 0)
    time.sleep(hold)
    user32.keybd_event(vk, scan, flags | 2, 0)
    time.sleep(hold)

SPECIAL_KEYS = {
    'enter': (0x0D, 0x1C, False),
    'return': (0x0D, 0x1C, False),
    'esc': (0x1B, 0x01, False),
    'escape': (0x1B, 0x01, False),
    'backspace': (0x08, 0x0E, False),
    'tab': (0x09, 0x0F, False),
    'space': (0x20, 0x39, False),
    'f1': (0x70, 0x3B, False),
    'f2': (0x71, 0x3C, False),
    'f3': (0x72, 0x3D, False),
    'f4': (0x73, 0x3E, False),
    'f5': (0x74, 0x3F, False),
    'f6': (0x75, 0x40, False),
    'f7': (0x76, 0x41, False),
    'f8': (0x77, 0x42, False),
    'f9': (0x78, 0x43, False),
    'f10': (0x79, 0x44, False),
    'f11': (0x7A, 0x57, False),
    'f12': (0x7B, 0x58, False),
    'up': (0x26, 0x48, True),
    'down': (0x28, 0x50, True),
    'left': (0x25, 0x4B, True),
    'right': (0x27, 0x4D, True),
}

def send_key(hwnd, key_name, hold=0.05):
    focus_window(hwnd)
    key_lower = key_name.lower().strip()

    if key_lower in ('ctrl+c', 'ctrl-c'):
        user32.keybd_event(0x11, 0x1D, 0, 0) # Ctrl down
        time.sleep(hold)
        user32.keybd_event(0x43, 0x2E, 0, 0) # C down
        time.sleep(hold)
        user32.keybd_event(0x43, 0x2E, 2, 0) # C up
        user32.keybd_event(0x11, 0x1D, 2, 0) # Ctrl up
        time.sleep(hold)
        return

    if key_lower in ('execute', 'rwin+e', 'ramiga+e'):
        user32.keybd_event(0x5C, 0x5C, 1, 0)
        time.sleep(0.05)
        user32.keybd_event(0x45, 0x12, 0, 0)
        time.sleep(0.05)
        user32.keybd_event(0x45, 0x12, 2, 0)
        time.sleep(0.05)
        user32.keybd_event(0x5C, 0x5C, 1 | 2, 0)
        time.sleep(hold)
        return

    if key_lower in ('reset', 'reboot'):
        # Ctrl + LWin + RWin (Amiga reset)
        user32.keybd_event(0x11, 0x1D, 0, 0) # Ctrl
        user32.keybd_event(0x5B, 0x5B, 1, 0) # LWin (L-Amiga)
        user32.keybd_event(0x5C, 0x5C, 1, 0) # RWin (R-Amiga)
        time.sleep(0.3)
        user32.keybd_event(0x5C, 0x5C, 1 | 2, 0)
        user32.keybd_event(0x5B, 0x5B, 1 | 2, 0)
        user32.keybd_event(0x11, 0x1D, 2, 0)
        time.sleep(hold)
        return

    if key_lower in SPECIAL_KEYS:
        vk, scan, ext = SPECIAL_KEYS[key_lower]
        press_key_code(vk, scan, ext, hold)
    else:
        type_text(hwnd, key_name)

def type_text(hwnd, text, char_delay=0.03):
    focus_window(hwnd)
    for ch in text:
        if ch == '\n':
            press_key_code(0x0D, 0x1C, False)
            continue
        res = user32.VkKeyScanW(ord(ch))
        shift = (res >> 8) & 1
        vk = res & 0xFF
        scan = user32.MapVirtualKeyW(vk, 0)
        if shift:
            user32.keybd_event(0x10, 0x2A, 0, 0)
            time.sleep(0.02)
        press_key_code(vk, scan, False, 0.04)
        if shift:
            user32.keybd_event(0x10, 0x2A, 2, 0)
            time.sleep(0.02)
        time.sleep(char_delay)

def mouse_click(hwnd, x, y, button="left", double=False):
    focus_window(hwnd)
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    
    screen_x = rect.left + int(x)
    screen_y = rect.top + int(y)
    user32.SetCursorPos(screen_x, screen_y)
    time.sleep(0.06)

    btn = button.lower()
    down_flag, up_flag = 0x0002, 0x0004
    if btn == "right":
        down_flag, up_flag = 0x0008, 0x0010
    elif btn == "middle":
        down_flag, up_flag = 0x0020, 0x0040

    send_mouse_event(down_flag)
    time.sleep(0.06)
    send_mouse_event(up_flag)

    if double:
        time.sleep(0.1)
        send_mouse_event(down_flag)
        time.sleep(0.06)
        send_mouse_event(up_flag)

def mouse_drag(hwnd, x1, y1, x2, y2, button="left", steps=12, delay=0.02):
    """Drag mouse from (x1, y1) to (x2, y2). Essential for Amiga Intuition menus (right-click hold) and window dragging."""
    focus_window(hwnd)
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))

    btn = button.lower()
    down_flag, up_flag = 0x0002, 0x0004
    if btn == "right":
        down_flag, up_flag = 0x0008, 0x0010
    elif btn == "middle":
        down_flag, up_flag = 0x0020, 0x0040

    start_x = rect.left + int(x1)
    start_y = rect.top + int(y1)
    end_x = rect.left + int(x2)
    end_y = rect.top + int(y2)

    user32.SetCursorPos(start_x, start_y)
    time.sleep(0.06)
    send_mouse_event(down_flag)
    time.sleep(0.06)

    for i in range(1, steps + 1):
        cur_x = int(start_x + (end_x - start_x) * (i / float(steps)))
        cur_y = int(start_y + (end_y - start_y) * (i / float(steps)))
        user32.SetCursorPos(cur_x, cur_y)
        time.sleep(delay)

    time.sleep(0.06)
    send_mouse_event(up_flag)
    time.sleep(0.05)

def mouse_move(hwnd, dx, dy):
    """Send relative mouse movement (mickeys) to WinUAE."""
    focus_window(hwnd)
    send_mouse_event(0x0001, dx=int(dx), dy=int(dy))
    time.sleep(0.03)

def main():
    parser = argparse.ArgumentParser(description="WinUAE Control CLI for AI Agents")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # status
    subparsers.add_parser("status", help="Get WinUAE window status and dimensions")

    # focus
    subparsers.add_parser("focus", help="Focus WinUAE window")

    # screenshot
    p_shot = subparsers.add_parser("screenshot", help="Capture WinUAE screenshot")
    p_shot.add_argument("path", nargs="?", default="winuae_screenshot.png", help="Output PNG path")

    # type
    p_type = subparsers.add_parser("type", help="Type text into WinUAE")
    p_type.add_argument("text", help="Text to type")
    p_type.add_argument("--enter", action="store_true", help="Press Enter after typing")

    # key
    p_key = subparsers.add_parser("key", help="Send special key")
    p_key.add_argument("name", help="Key name (enter, esc, f12, backspace, up, down, ctrl+c, reset)")

    # click
    p_click = subparsers.add_parser("click", help="Click at window coordinates")
    p_click.add_argument("x", type=int, help="X coordinate relative to WinUAE window")
    p_click.add_argument("y", type=int, help="Y coordinate relative to WinUAE window")
    p_click.add_argument("--button", default="left", choices=["left", "right", "middle"], help="Mouse button")
    p_click.add_argument("--double", action="store_true", help="Double click")

    # move
    p_move = subparsers.add_parser("move", help="Move mouse by relative delta (dx, dy)")
    p_move.add_argument("dx", type=int, help="Relative X delta")
    p_move.add_argument("dy", type=int, help="Relative Y delta")

    # drag
    p_drag = subparsers.add_parser("drag", help="Drag mouse from (x1, y1) to (x2, y2) (e.g. for Amiga menus)")
    p_drag.add_argument("x1", type=int, help="Start X")
    p_drag.add_argument("y1", type=int, help="Start Y")
    p_drag.add_argument("x2", type=int, help="End X")
    p_drag.add_argument("y2", type=int, help="End Y")
    p_drag.add_argument("--button", default="left", choices=["left", "right", "middle"], help="Mouse button")
    p_drag.add_argument("--steps", type=int, default=12, help="Number of intermediate steps")

    args = parser.parse_args()

    hwnd, title = find_winuae_window()
    if not hwnd:
        print("ERROR: WinUAE window not found.", file=sys.stderr)
        sys.exit(1)

    if args.command == "status":
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        print(f"Window: '{title}' (HWND: {hwnd})")
        print(f"Bounds: left={rect.left}, top={rect.top}, width={rect.right-rect.left}, height={rect.bottom-rect.top}")
    elif args.command == "focus":
        ok = focus_window(hwnd)
        print("Focused:" if ok else "Focus attempt finished, active:", user32.GetForegroundWindow() == hwnd)
    elif args.command == "screenshot":
        size = capture_screenshot(hwnd, args.path)
        print(f"Screenshot saved to {args.path} (resolution: {size[0]}x{size[1]})")
    elif args.command == "type":
        type_text(hwnd, args.text)
        if args.enter:
            send_key(hwnd, "enter")
        print(f"Typed: {repr(args.text)}" + (" + Enter" if args.enter else ""))
    elif args.command == "key":
        send_key(hwnd, args.name)
        print(f"Sent key: {args.name}")
    elif args.command == "click":
        mouse_click(hwnd, args.x, args.y, args.button, args.double)
        print(f"Clicked at ({args.x}, {args.y}) button={args.button} double={args.double}")
    elif args.command == "move":
        mouse_move(hwnd, args.dx, args.dy)
        print(f"Moved mouse by ({args.dx}, {args.dy})")
    elif args.command == "drag":
        mouse_drag(hwnd, args.x1, args.y1, args.x2, args.y2, args.button, args.steps)
        print(f"Dragged from ({args.x1}, {args.y1}) to ({args.x2}, {args.y2}) button={args.button}")

if __name__ == "__main__":
    main()
