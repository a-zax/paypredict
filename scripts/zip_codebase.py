"""
Codebase Zipper
Creates a clean, production-ready ZIP archive of the codebase.
Respects .gitignore, ignores virtual environments, caches, and build artifacts.
"""

import argparse
import fnmatch
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile

# Ensure UTF-8 output on Windows consoles to prevent UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

DEFAULT_IGNORES = [
    ".git",
    ".git/*",
    ".venv",
    ".venv/*",
    "venv",
    "venv/*",
    "env",
    "env/*",
    "__pycache__",
    "__pycache__/*",
    "*.pyc",
    "*.pyo",
    "*.pyd",
    ".pytest_cache",
    ".pytest_cache/*",
    ".mypy_cache",
    ".mypy_cache/*",
    ".ruff_cache",
    ".ruff_cache/*",
    "node_modules",
    "node_modules/*",
    ".claude",
    ".claude/*",
    ".vscode",
    ".vscode/*",
    ".idea",
    ".idea/*",
    ".DS_Store",
    "Thumbs.db",
    "*.zip",
    "*.tar.gz",
    "*.tgz",
]


def format_size(size_bytes: int) -> str:
    """Format bytes into human-readable string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024.0:
            return f"{size_bytes:,.1f} {unit}" if unit != "B" else f"{size_bytes} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:,.1f} TB"


def get_git_files(root: Path) -> list[Path] | None:
    """Use git to retrieve tracked and untracked (non-ignored) files."""
    try:
        git_dir = root / ".git"
        if not git_dir.exists():
            return None

        # -z flag outputs null-byte separated entries to handle spaces/quotes cleanly
        result = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=str(root),
            capture_output=True,
            check=True,
        )
        raw_output = result.stdout
        if not raw_output:
            return []

        rel_paths = [p for p in raw_output.split(b"\x00") if p]
        files = []
        for rel_bytes in rel_paths:
            rel_str = rel_bytes.decode("utf-8", errors="replace")
            p = root / rel_str
            if p.is_file():
                files.append(p)
        return files
    except Exception:
        return None


def parse_gitignore(gitignore_path: Path) -> list[str]:
    """Parse gitignore patterns from file."""
    if not gitignore_path.exists():
        return []
    patterns = []
    try:
        with open(gitignore_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    patterns.append(line)
    except Exception:
        pass
    return patterns


def should_ignore(rel_path_str: str, is_dir: bool, patterns: list[str]) -> bool:
    """Check if relative path matches any ignore pattern."""
    # Normalize path separators to forward slash
    norm_path = rel_path_str.replace("\\", "/")
    parts = norm_path.split("/")
    filename = parts[-1]

    for pat in patterns:
        pat = pat.replace("\\", "/").strip()
        if not pat:
            continue

        dir_only = pat.endswith("/")
        if dir_only:
            pat = pat[:-1]
            if not is_dir and not any(fnmatch.fnmatch(part, pat) for part in parts[:-1]):
                continue

        # Pattern matches exact part
        if any(fnmatch.fnmatch(part, pat) for part in parts):
            return True

        # Pattern matches relative path from root
        pat_clean = pat.lstrip("/")
        if fnmatch.fnmatch(norm_path, pat_clean) or fnmatch.fnmatch(filename, pat_clean):
            return True
        if norm_path.startswith(pat_clean + "/"):
            return True

    return False


def collect_files_fallback(root: Path, extra_ignores: list[str]) -> list[Path]:
    """Fallback recursive file walker respecting .gitignore and defaults."""
    patterns = list(DEFAULT_IGNORES) + extra_ignores
    gitignore = root / ".gitignore"
    if gitignore.is_file():
        patterns.extend(parse_gitignore(gitignore))

    collected = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            rel_dir = ""

        # Filter directories in-place to prevent traversing ignored folders
        i = 0
        while i < len(dirnames):
            d = dirnames[i]
            d_rel = f"{rel_dir}/{d}".lstrip("/") if rel_dir else d
            if should_ignore(d_rel, is_dir=True, patterns=patterns):
                del dirnames[i]
            else:
                i += 1

        for fname in filenames:
            f_rel = f"{rel_dir}/{fname}".lstrip("/") if rel_dir else fname
            if not should_ignore(f_rel, is_dir=False, patterns=patterns):
                collected.append(Path(dirpath) / fname)

    return collected


def zip_codebase(
    source_dir: Path,
    output_zip: Path,
    use_git: bool = True,
    extra_excludes: list[str] | None = None,
    prefix_dir: str = "",
    dry_run: bool = False,
    verbose: bool = False,
) -> int:
    """Zip the codebase into an archive."""
    start_time = time.time()
    source_dir = source_dir.resolve()
    output_zip = output_zip.resolve()
    extra_excludes = extra_excludes or []

    print(f"[*] Source Directory: {source_dir}")
    print(f"[*] Target Archive:   {output_zip}")

    files: list[Path] = []
    method_used = "git"

    if use_git:
        git_files = get_git_files(source_dir)
        if git_files is not None:
            files = git_files
        else:
            method_used = "filesystem-scan"
            files = collect_files_fallback(source_dir, extra_excludes)
    else:
        method_used = "filesystem-scan"
        files = collect_files_fallback(source_dir, extra_excludes)

    # Filter out output zip itself, default ignores, and custom extra_excludes
    filtered_files: list[Path] = []
    for f in files:
        f_resolved = f.resolve()
        if f_resolved == output_zip:
            continue
        rel_str = str(f_resolved.relative_to(source_dir)).replace("\\", "/")
        if should_ignore(rel_str, is_dir=False, patterns=DEFAULT_IGNORES):
            continue
        if extra_excludes and should_ignore(rel_str, is_dir=False, patterns=extra_excludes):
            continue
        filtered_files.append(f)

    filtered_files.sort()
    total_files = len(filtered_files)
    total_bytes = sum(f.stat().st_size for f in filtered_files if f.exists())

    print(f"[*] Discovery Method: {method_used}")
    print(f"[*] Files to include: {total_files} ({format_size(total_bytes)})")

    if total_files == 0:
        print("[!] Warning: No files found to archive.")
        return 1

    if dry_run:
        print("\n[DRY RUN] The following files would be archived:")
        for idx, f in enumerate(filtered_files, start=1):
            rel_str = str(f.relative_to(source_dir)).replace("\\", "/")
            archive_path = f"{prefix_dir.strip('/')}/{rel_str}".lstrip("/") if prefix_dir else rel_str
            print(f"  {idx:3d}. {archive_path} ({format_size(f.stat().st_size)})")
        print("\nDry run completed. Archive was not created.")
        return 0

    output_zip.parent.mkdir(parents=True, exist_ok=True)

    print("\nArchiving...")
    with zipfile.ZipFile(
        output_zip,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
    ) as zf:
        for idx, f in enumerate(filtered_files, start=1):
            rel_path = f.relative_to(source_dir)
            arcname = str(rel_path).replace("\\", "/")
            if prefix_dir:
                arcname = f"{prefix_dir.strip('/')}/{arcname}".lstrip("/")

            zf.write(f, arcname=arcname)
            if verbose:
                print(f"  [{idx}/{total_files}] Added {arcname}")

    compressed_bytes = output_zip.stat().st_size
    duration = time.time() - start_time
    savings = (1 - (compressed_bytes / total_bytes)) * 100 if total_bytes > 0 else 0

    print("\n" + "=" * 50)
    print("Archive created successfully!")
    print(f"Archive Path:      {output_zip}")
    print(f"Total Files:       {total_files}")
    print(f"Original Size:     {format_size(total_bytes)}")
    print(f"Compressed Size:   {format_size(compressed_bytes)}")
    print(f"Space Saved:       {savings:.1f}%")
    print(f"Time Elapsed:      {duration:.2f}s")
    print("=" * 50)

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Zip codebase while respecting .gitignore and sensible defaults."
    )
    # Default source directory is the repository root (parent of 'scripts' directory or current dir)
    default_root = Path(__file__).resolve().parent.parent
    if not (default_root / ".git").exists() and (Path.cwd() / ".git").exists():
        default_root = Path.cwd()

    parser.add_argument(
        "-s",
        "--source",
        type=Path,
        default=default_root,
        help=f"Source directory to zip (default: {default_root})",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output zip file path. Defaults to <source_folder_name>.zip in source dir",
    )
    parser.add_argument(
        "-t",
        "--timestamp",
        action="store_true",
        help="Append timestamp to the output filename (e.g. codebase_20261007_184500.zip)",
    )
    parser.add_argument(
        "--no-git",
        action="store_true",
        help="Do not use git to resolve files; use filesystem scanner instead",
    )
    parser.add_argument(
        "-e",
        "--exclude",
        action="append",
        default=[],
        help="Extra glob patterns to exclude (can be specified multiple times)",
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="",
        help="Optional root folder prefix inside the archive (e.g. --prefix my-app)",
    )
    parser.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="Preview files that would be zipped without creating the zip file",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Print each file as it is added to the zip",
    )

    args = parser.parse_args()

    source = args.source.resolve()
    if not source.exists() or not source.is_dir():
        print(f"Error: Source directory does not exist: {source}", file=sys.stderr)
        sys.exit(1)

    if args.output:
        output = args.output
        if output.is_dir() or str(output).endswith(("\\", "/")):
            base_name = source.name
            if args.timestamp:
                ts = time.strftime("%Y%m%d_%H%M%S")
                base_name = f"{base_name}_{ts}"
            output = output / f"{base_name}.zip"
    else:
        base_name = source.name
        if args.timestamp:
            ts = time.strftime("%Y%m%d_%H%M%S")
            base_name = f"{base_name}_{ts}"
        output = source / f"{base_name}.zip"

    exit_code = zip_codebase(
        source_dir=source,
        output_zip=output,
        use_git=not args.no_git,
        extra_excludes=args.exclude,
        prefix_dir=args.prefix,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
