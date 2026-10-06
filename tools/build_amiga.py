#!/usr/bin/env python3
"""
tools/build_amiga.py - Build standalone AMAI Amiga binaries and pack .lha release.

This script:
1. Downloads the official NodeAmiga.lha from Aminet (or uses local dev/NodeAmiga).
2. Extracts NodeAmiga binaries using 'lha' or python.
3. Automatically resolves dependencies from amiga/src/amai.js and packages them
   into standalone AmigaOS executables (base 68000, 68020, 68040, 68060)
   using the exact NodeAmiga NAJE HUNK_DATA bundling format.
4. Prepares release directory and packs it into amai-<version>.lha using lha.
"""

import sys
import os
import re
import struct
import shutil
import urllib.request
import subprocess
import argparse
from pathlib import Path

AMINET_NODEAMIGA_URL = "https://aminet.net/dev/lang/NodeAmiga.lha"

NATIVE_MODULES = {
    'fs', 'http', 'net', 'buffer', 'os', 'child_process', 'crypto',
    'intuition', 'gui', 'readline', 'dns', 'clipboard', 'arexx', 'amiga'
}

def resolve_module(from_file, req_str):
    dir_path = os.path.dirname(from_file)
    candidates = [
        os.path.join(dir_path, req_str),
        os.path.join(dir_path, req_str + '.js'),
        os.path.join(dir_path, req_str, 'index.js'),
        req_str,
        req_str + '.js'
    ]
    for c in candidates:
        norm = os.path.normpath(c).replace('\\', '/')
        if os.path.isfile(norm):
            return norm
    return None

def find_requires_and_imports(content):
    results = []
    # Match require('...') or require("...")
    for m in re.finditer(r'require\s*\(\s*[\'\"]([^\'\"]+)[\'\"]\s*\)', content):
        mod = m.group(1)
        if mod not in NATIVE_MODULES:
            results.append(mod)
    # Match import ... from '...'
    for m in re.finditer(r'from\s+[\'\"]([^\'\"]+)[\'\"]', content):
        mod = m.group(1)
        if mod not in NATIVE_MODULES:
            results.append(mod)
    return results

def collect_modules(entry_file):
    collected = []
    seen_files = set()
    seen_keys = set()

    def process_file(file_path):
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        reqs = find_requires_and_imports(content)
        for r in reqs:
            resolved = resolve_module(file_path, r)
            if resolved:
                if (r, resolved) not in seen_keys:
                    seen_keys.add((r, resolved))
                    collected.append((r, resolved))
                if resolved not in seen_files:
                    seen_files.add(resolved)
                    process_file(resolved)

    seen_files.add(os.path.normpath(entry_file).replace('\\', '/'))
    process_file(entry_file)
    return collected

def bundle_nodeamiga_exe(nodeamiga_bin_path, entry_script_path, modules, output_bin_path):
    """
    Embeds JS modules and main script into NodeAmiga binary as a HUNK_DATA chunk.
    This creates a standalone AmigaOS executable that needs no runtime files or NodeAmiga.
    """
    with open(nodeamiga_bin_path, 'rb') as f:
        node_bytes = f.read()

    # Verify AmigaOS HUNK_HEADER
    magic, zero, num_hunks, first_hunk, last_hunk = struct.unpack('>IIIII', node_bytes[:20])
    if magic != 0x3f3:
        raise ValueError(f"'{nodeamiga_bin_path}' is not a valid AmigaOS HUNK_HEADER binary (magic: {hex(magic)})")

    sizes = []
    idx = 20
    for _ in range(num_hunks):
        sizes.append(struct.unpack('>I', node_bytes[idx:idx+4])[0])
        idx += 4

    body_bytes = node_bytes[idx:]

    # Build NAJE bundle payload
    bundle_data = bytearray()
    bundle_data.extend(b'NAJE')
    bundle_data.extend(struct.pack('>H', len(modules)))

    for mod_name, mod_filepath in modules:
        with open(mod_filepath, 'rb') as mf:
            content = mf.read()
        n_bytes = mod_name.encode('latin1')
        bundle_data.extend(struct.pack('>H', len(n_bytes)))
        bundle_data.extend(n_bytes)
        bundle_data.extend(struct.pack('>I', len(content)))
        bundle_data.extend(content)

    # Main script
    with open(entry_script_path, 'rb') as f:
        main_bytes = f.read()
    bundle_data.extend(struct.pack('>I', len(main_bytes)))
    bundle_data.extend(main_bytes)

    # Pad payload to 4-byte boundary
    pad = (4 - (len(bundle_data) % 4)) % 4
    if pad:
        bundle_data.extend(b'\x00' * pad)

    hunk_data_longs = len(bundle_data) // 4

    # New Hunk table
    new_num_hunks = num_hunks + 1
    new_last_hunk = last_hunk + 1
    new_sizes = sizes + [hunk_data_longs]

    out_hdr = bytearray()
    out_hdr.extend(struct.pack('>IIIII', magic, 0, new_num_hunks, first_hunk, new_last_hunk))
    for sz in new_sizes:
        out_hdr.extend(struct.pack('>I', sz))

    out_body = bytearray(body_bytes)
    out_body.extend(struct.pack('>II', 0x3ea, hunk_data_longs))  # HUNK_DATA
    out_body.extend(bundle_data)
    out_body.extend(struct.pack('>I', 0x3f2))                    # HUNK_END

    os.makedirs(os.path.dirname(os.path.abspath(output_bin_path)), exist_ok=True)
    with open(output_bin_path, 'wb') as f:
        f.write(out_hdr + out_body)

    print(f"Bundled '{output_bin_path}' successfully ({len(out_hdr) + len(out_body)} bytes, {len(modules)} modules)")

def download_nodeamiga(dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    archive_path = os.path.join(dest_dir, "NodeAmiga.lha")
    print(f"Downloading NodeAmiga from {AMINET_NODEAMIGA_URL}...")
    req = urllib.request.Request(AMINET_NODEAMIGA_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp, open(archive_path, 'wb') as f:
        f.write(resp.read())
    print(f"Downloaded {archive_path} ({os.path.getsize(archive_path)} bytes)")

    # Extract archive using lha or lhasa
    lha_bin = shutil.which("lha") or shutil.which("lhasa")
    if lha_bin:
        print(f"Extracting {archive_path} using {lha_bin}...")
        subprocess.check_call([lha_bin, "x", os.path.basename(archive_path)], cwd=dest_dir)
    else:
        raise RuntimeError("Neither 'lha' nor 'lhasa' found to extract NodeAmiga.lha")

def find_nodeamiga_binaries(search_dirs):
    binaries = {}
    variants = {
        'base': ['NodeAmiga'],
        '020': ['NodeAmiga_020'],
        '040': ['NodeAmiga_040'],
        '060': ['NodeAmiga_060']
    }
    for sdir in search_dirs:
        if not os.path.isdir(sdir):
            continue
        for root, _, files in os.walk(sdir):
            for var_key, names in variants.items():
                if var_key not in binaries:
                    for n in names:
                        if n in files:
                            binaries[var_key] = os.path.join(root, n)
                            break
    return binaries

def create_lha_archive(lha_tool, source_dir, archive_path):
    print(f"Creating LHA archive: {archive_path} from {source_dir}...")
    if os.path.exists(archive_path):
        os.remove(archive_path)

    abs_archive = os.path.abspath(archive_path)
    parent_dir = os.path.dirname(os.path.abspath(source_dir))
    base_name = os.path.basename(os.path.abspath(source_dir))

    cmd = [lha_tool, "a", abs_archive, base_name]
    print("Running:", " ".join(cmd), "in", parent_dir)
    subprocess.check_call(cmd, cwd=parent_dir)
    print(f"Archive created: {archive_path} ({os.path.getsize(archive_path)} bytes)")

def main():
    parser = argparse.ArgumentParser(description="Build and package AMAI Amiga binaries")
    parser.add_argument("--nodeamiga-dir", default=None, help="Directory containing NodeAmiga binaries")
    parser.add_argument("--version", default="v1.0.0", help="Release version tag")
    parser.add_argument("--output-lha", default="amai.lha", help="Output .lha archive path")
    parser.add_argument("--skip-download", action="store_true", help="Do not download NodeAmiga from Aminet")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    os.chdir(project_root)

    entry_script = "amiga/src/amai.js"
    if not os.path.isfile(entry_script):
        print(f"Error: {entry_script} not found!")
        sys.exit(1)

    print(f"Analyzing dependencies from {entry_script}...")
    modules = collect_modules(entry_script)
    for key, path in modules:
        print(f"  -> Module '{key}' => '{path}'")

    # Search for NodeAmiga binaries
    search_dirs = []
    if args.nodeamiga_dir:
        search_dirs.append(args.nodeamiga_dir)
    search_dirs.extend(["dev/NodeAmiga", "dev", "NodeAmiga", "download/NodeAmiga"])

    bins = find_nodeamiga_binaries(search_dirs)

    if 'base' not in bins and not args.skip_download:
        dl_dir = os.path.join(project_root, "build", "nodeamiga_dl")
        download_nodeamiga(dl_dir)
        search_dirs.insert(0, dl_dir)
        bins = find_nodeamiga_binaries(search_dirs)

    if 'base' not in bins:
        print("Error: Could not locate 'NodeAmiga' binary!")
        sys.exit(1)

    print("Found NodeAmiga binaries:")
    for k, v in bins.items():
        print(f"  [{k}] {v}")

    # Build standalone executables into dist/amai/
    dist_dir = os.path.join(project_root, "dist", "amai")
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir, exist_ok=True)

    # 1. Base 68000 executable -> amai
    bundle_nodeamiga_exe(bins['base'], entry_script, modules, os.path.join(dist_dir, "amai"))
    # Also update repository amiga/bin/amai
    bundle_nodeamiga_exe(bins['base'], entry_script, modules, os.path.join("amiga", "bin", "amai"))

    # 2. CPU-optimized variants if available
    for var, out_name in [('020', 'amai_020'), ('040', 'amai_040'), ('060', 'amai_060')]:
        if var in bins:
            bundle_nodeamiga_exe(bins[var], entry_script, modules, os.path.join(dist_dir, out_name))

    # Copy config and docs
    shutil.copy("amiga/src/amai.config.json", os.path.join(dist_dir, "amai.config.json"))
    shutil.copy("amiga/src/amai.config.json", os.path.join("amiga", "bin", "amai.config.json"))
    if os.path.isfile("README.md"):
        shutil.copy("README.md", os.path.join(dist_dir, "README.md"))

    # Create .readme from template for Aminet / Amiga release
    readme_template = os.path.join("amiga", "amai.readme")
    readme_path = os.path.join(dist_dir, "amai.readme")
    if os.path.isfile(readme_template):
        with open(readme_template, "r", encoding="utf-8") as f:
            template_text = f.read()
        readme_content = template_text.replace("${VERSION}", args.version)
    else:
        readme_content = f"AMAI - Amiga AI Assistant Shell ({args.version})\n"
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(readme_content)

    print(f"\nDist directory prepared at: {dist_dir}")

    # Pack into LHA archive
    lha_tool = shutil.which("lha")
    if lha_tool:
        create_lha_archive(lha_tool, dist_dir, args.output_lha)
    else:
        print("Note: 'lha' tool not found on PATH. Skipped creating .lha (directory dist/amai ready).")

if __name__ == "__main__":
    main()
