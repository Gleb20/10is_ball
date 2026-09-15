#!/usr/bin/env python3
"""Export a frozen local task delta; never commits or copies secret-bearing files.

Usage: python3 export-candidate.py SOURCE_CHECKOUT NEW_OUTPUT_DIRECTORY [REVIEWED_EXTRA_INPUTS_JSON]
Run only after the source writer is stopped. Receiver starts at manifest base_head,
checks clean status, applies tracked.patch, copies files/ by manifest, and checks
SHA-256 for every modified/new path. Optional extras are individually reviewed,
hash-pinned untracked artifacts omitted by gitignore, never a blanket ignored-file
export. Defaults to this research folder's reviewed-export-extras.json when it
exists in SOURCE_CHECKOUT. Each entry is {"path": "relative/path", "sha256": "reviewed hash"}.
This is not a deployment artifact.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def allowed(relative):
    p = Path(relative)
    if p.is_absolute() or ".." in p.parts:
        return False
    # Fail closed: an explicit human review must handle excluded delta separately.
    blocked = (".env", "secret", "credential", ".pem", ".key", "cookie", "storage-state", "auth-state")
    return not any(token in str(p).lower() for token in blocked)


def inventory(root, extras=()):
    changed = git(root, "diff", "--name-only", "-z", "HEAD").decode().split("\0")
    added = git(root, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")
    tracked = set(git(root, "ls-files", "-z").decode().split("\0"))
    for entry in extras:
        relative = entry["path"]
        if not allowed(relative) or relative in tracked:
            raise SystemExit("Extra must be allowed and untracked: " + relative)
        p = root / relative
        if p.is_symlink() or not p.is_file() or root not in p.resolve().parents:
            raise SystemExit("Extra must be a regular in-checkout file: " + relative)
        if sha(p.read_bytes()) != entry["sha256"]:
            raise SystemExit("Reviewed extra hash mismatch: " + relative)
        added.append(relative)
    added = sorted(set(p for p in added if p))
    paths = sorted(set(p for p in changed + added if p))
    denied = [p for p in paths if not allowed(p)]
    if denied:
        raise SystemExit("Excluded paths in task delta; export stopped (names only): " + repr(denied))
    content = {}
    for relative in paths:
        p = root / relative
        if p.is_symlink():
            raise SystemExit("Symlink in task delta; export stopped: " + relative)
        content[relative] = p.read_bytes() if p.exists() else None
    return paths, [p for p in added if p], content


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    root, out = (Path(p).resolve() for p in sys.argv[1:3])
    extras_path = Path(sys.argv[3]) if len(sys.argv) == 4 else root / "docs/audits/2026-09-13-ux-ui/reviewed-export-extras.json"
    extras = json.loads(extras_path.read_text()) if extras_path.exists() else []
    if len(sys.argv) == 4 and not extras_path.is_file():
        raise SystemExit("Explicit reviewed extras file is missing")
    if out.exists() or root == out or root in out.parents:
        raise SystemExit("Output must be a new directory outside source checkout")
    base = git(root, "rev-parse", "HEAD").decode().strip()
    paths, added, content = inventory(root, extras)
    patch = git(root, "diff", "--binary", "HEAD", "--", *paths) if paths else b""
    if (paths, added, content) != inventory(root, extras) or base != git(root, "rev-parse", "HEAD").decode().strip():
        raise SystemExit("Source changed while exporting; stop writers and retry")
    manifest = {
        "base_head": base,
        "kind": "local_uncommitted_candidate_not_release",
        "tracked_patch_sha256": sha(patch),
        "files": {p: {"sha256": sha(data) if data is not None else None,
                       "new": p in added, "deleted": data is None}
                  for p, data in content.items()},
    }
    out.mkdir(parents=True)
    (out / "tracked.patch").write_bytes(patch)
    for relative in added:
        p = out / "files" / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content[relative])
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"output": str(out), "paths": len(paths),
                      "manifest_sha256": sha((out / "manifest.json").read_bytes())}))


if __name__ == "__main__":
    main()
