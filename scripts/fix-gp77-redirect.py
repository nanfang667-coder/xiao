#!/usr/bin/env python3
"""Route GP77 root visits through the existing channel; never rebuild the app."""

import argparse
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time

HOSTS = {"gp77.top", "www.gp77.top"}
TARGET = "https://fenglou1.com/go/gp77"
MARKER = "hulim_gp77_entry"
RULE = '''
    # GP77 channel entry: preserve every existing non-root rule below.
    set $hulim_gp77_entry "$host:$uri";
    if ($hulim_gp77_entry = "gp77.top:/") {
        return 302 https://fenglou1.com/go/gp77;
    }
    if ($hulim_gp77_entry = "www.gp77.top:/") {
        return 302 https://fenglou1.com/go/gp77;
    }
'''


def tokens(text):
    """Keep offsets while respecting comments, quotes and escaped delimiters."""
    if "${" in text:
        raise ValueError("Braced variables require manual review; no file changed")
    i = 0
    while i < len(text):
        if text[i].isspace():
            i += 1
        elif text[i] == "#":
            end = text.find("\n", i)
            i = len(text) if end < 0 else end + 1
        elif text[i] in "{};":
            yield text[i], i + 1
            i += 1
        else:
            word = []
            quote = None
            while i < len(text):
                char = text[i]
                if char == "\\":
                    if i + 1 == len(text):
                        raise ValueError("Unfinished escape")
                    word.append(text[i + 1])
                    i += 2
                    continue
                if quote:
                    if char == quote:
                        quote = None
                    else:
                        word.append(char)
                elif char in "\"'":
                    quote = char
                elif char.isspace() or char in "{};#":
                    break
                else:
                    word.append(char)
                i += 1
            if quote:
                raise ValueError("Unfinished quote")
            yield "".join(word), None


def patch_config(text):
    if MARKER in text:
        raise ValueError("GP77 patch marker already exists; no file changed")
    root = {"header": [], "directives": [], "children": []}
    stack, words = [root], []
    for word, end in tokens(text):
        if end is not None and word == "{":
            node = {"header": words, "directives": [], "children": [], "start": end}
            stack[-1]["children"].append(node)
            stack.append(node)
            words = []
        elif end is not None and word == "}":
            if words or len(stack) == 1:
                raise ValueError("Unexpected closing brace")
            stack.pop()
        elif end is not None and word == ";":
            stack[-1]["directives"].append(words)
            words = []
        else:
            words.append(word)
    if words or len(stack) != 1:
        raise ValueError("Incomplete configuration")
    positions, coverage = [], set()
    for node in root["children"]:
        if node["header"] != ["server"]:
            continue
        names = set()
        ports = set()
        for directive in node["directives"]:
            if directive and directive[0] == "server_name":
                names.update(directive[1:])
            if directive and directive[0] == "listen" and len(directive) > 1:
                match = re.fullmatch(r"(?:.*:)?(80|443)", directive[1])
                if match:
                    ports.add(int(match[1]))
        selected = names & HOSTS
        if selected:
            if not ports:
                raise ValueError("GP77 listener requires manual review")
            positions.append(node["start"])
            coverage.update((host, port) for host in selected for port in ports)
    if coverage != {(host, port) for host in HOSTS for port in (80, 443)}:
        raise ValueError("Both GP77 names must explicitly cover ports 80 and 443; no file changed")
    for position in sorted(positions, reverse=True):
        text = text[:position] + RULE + text[position:]
    return text, len(positions)


def run(*command):
    subprocess.run(command, check=True)


def head(host, port, path):
    scheme = "https" if port == 443 else "http"
    return subprocess.check_output([
        "curl", "--disable", "--no-location", "--noproxy", "*",
        "--silent", "--show-error", "--head",
        "--max-time", "10", "--output", "/dev/null", "--write-out",
        "%{http_code} %{redirect_url}", "--resolve", f"{host}:{port}:127.0.0.1",
        f"{scheme}://{host}{path}",
    ], text=True).strip()


def atomic_write(path, content, metadata):
    fd, name = tempfile.mkstemp(prefix=".gp77-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, stat.S_IMODE(metadata.st_mode))
        if hasattr(os, "chown"):
            os.chown(name, metadata.st_uid, metadata.st_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def apply(site, backup_root):
    site = site.resolve(strict=True)
    if not site.is_file() or not str(site).startswith("/etc/nginx/"):
        raise ValueError("Expected an existing Nginx config under /etc/nginx")
    original, metadata = site.read_bytes(), site.stat()
    updated_text, count = patch_config(original.decode("utf-8"))
    updated = updated_text.encode("utf-8")
    run("nginx", "-t")
    # HEAD only, without following redirects or invoking the counting endpoint.
    pairs = [(host, port) for host in sorted(HOSTS) for port in (80, 443)]
    previous = {(h, p): head(h, p, "/fenglou") for h, p in pairs}
    if any(not value.startswith(("301 ", "302 ", "307 ", "308 ")) for value in previous.values()):
        raise ValueError("Existing deep-path behavior requires manual review")
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="gp77-before-", dir=backup_root)) / "hulim.conf"
    backup.write_bytes(original)
    backup.chmod(0o600)
    print(f"Configuration backup: {backup}", flush=True)
    if site.read_bytes() != original:
        raise ValueError("Configuration changed during preparation; stopped")
    try:
        atomic_write(site, updated, metadata)
        run("nginx", "-t")
        run("systemctl", "reload", "nginx")
        for host, port in pairs:
            for attempt in range(5):
                observed = head(host, port, "/")
                if observed == "302 " + TARGET:
                    break
                time.sleep(0.3)
            else:
                raise RuntimeError(f"Root check failed: {host}:{port}: {observed}")
            if head(host, port, "/fenglou") != previous[host, port]:
                raise RuntimeError(f"Deep-path behavior changed: {host}:{port}")
            print(f"OK {host}:{port} -> {TARGET}", flush=True)
    except BaseException:
        if site.read_bytes() not in (original, updated):
            raise RuntimeError(f"Concurrent config edit detected; restore requires review: {backup}")
        atomic_write(site, original, metadata)
        run("nginx", "-t")
        run("systemctl", "reload", "nginx")
        print("Original configuration restored", flush=True)
        raise
    print(f"GP77 redirect complete ({count} server blocks); application unchanged", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", required=True)
    args = parser.parse_args()
    if not args.apply or getattr(os, "geteuid", lambda: 1)() != 0:
        parser.error("Run with --apply as root")
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    apply(Path("/etc/nginx/sites-enabled/hulim"), Path("/var/backups/hulim-nginx"))


if __name__ == "__main__":
    main()
