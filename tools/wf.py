"""Workflow helpers to import from one Python script.

Add the installed plugin's tools directory to sys.path, then import wf.
ctx and git_snap return stdout plus stderr as text, including inline errors.
"""
from collections import Counter, namedtuple
import math
import os
import re
import subprocess
import sys
from typing import Optional, Sequence, Union

_DIR = os.path.dirname(os.path.abspath(__file__))

SearchResult = namedtuple("SearchResult", ["range", "score"])


def _run(tool: str, *args: str) -> str:
    result = subprocess.run(
        [os.path.join(_DIR, tool), *args], capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def ctx(*files: str, max_bytes: Optional[Union[int, bool]] = None) -> str:
    args = []
    if max_bytes is True:
        args.append("--max-bytes")
    elif max_bytes is not None and max_bytes is not False:
        args.append(f"--max-bytes={max_bytes}")
    args.extend(files)
    return _run("ctx", *args)


def git_snap() -> str:
    return _run("git-snap")


def tokenize(text: str) -> list[str]:
    tokens = []
    raw_words = re.findall(r"[A-Za-z0-9_]+", text)
    for w in raw_words:
        lower = w.lower()
        tokens.append(lower)
        parts = [p for p in w.split("_") if p]
        if len(parts) > 1:
            for p in parts:
                p_lower = p.lower()
                if p_lower != lower:
                    tokens.append(p_lower)
        for part in parts:
            camel_parts = re.findall(r"[A-Z]+(?=[A-Z][a-z0-9])|[A-Z]?[a-z0-9]+|[A-Z]+", part)
            if len(camel_parts) > 1:
                for cp in camel_parts:
                    cp_lower = cp.lower()
                    if cp_lower != lower:
                        tokens.append(cp_lower)
    return tokens


def is_binary(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            chunk = f.read(4096)
            return b"\x00" in chunk
    except Exception:
        return False


def search(
    query: str,
    paths: Union[str, os.PathLike, Sequence[Union[str, os.PathLike]]],
    top_k: int = 5,
    chunk_lines: int = 40,
) -> list[SearchResult]:
    if isinstance(paths, (str, os.PathLike)):
        path_list = [str(paths)]
    else:
        path_list = [str(p) for p in paths]

    all_files = []
    for p in path_list:
        if os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                for f in sorted(files):
                    if not f.startswith("."):
                        all_files.append(os.path.join(root, f))
        elif os.path.isfile(p):
            all_files.append(p)

    chunks = []
    for filepath in all_files:
        if is_binary(filepath):
            continue
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception:
            continue
        lines = content.splitlines()
        total_lines = len(lines)
        if total_lines == 0:
            continue
        for start in range(1, total_lines + 1, chunk_lines):
            end = min(start + chunk_lines - 1, total_lines)
            chunk_text = "\n".join(lines[start - 1 : end])
            chunks.append({
                "range": f"{filepath}:{start}-{end}",
                "tokens": tokenize(chunk_text),
            })

    q_tokens = tokenize(query)
    if not q_tokens or not chunks:
        return []

    N = len(chunks)
    doc_len = [len(c["tokens"]) for c in chunks]
    avgdl = sum(doc_len) / N if N > 0 else 1.0
    if avgdl == 0:
        avgdl = 1.0

    df = Counter()
    for c in chunks:
        chunk_terms = set(c["tokens"])
        for q in set(q_tokens):
            if q in chunk_terms:
                df[q] += 1

    k1 = 1.5
    b = 0.75
    candidates = []
    for i, c in enumerate(chunks):
        score = 0.0
        c_counts = Counter(c["tokens"])
        L = doc_len[i]
        for q in q_tokens:
            if q not in df or df[q] == 0:
                continue
            n_q = df[q]
            idf = math.log(1.0 + (N - n_q + 0.5) / (n_q + 0.5))
            f = c_counts[q]
            num = f * (k1 + 1.0)
            den = f + k1 * (1.0 - b + b * (L / avgdl))
            score += idf * (num / den)
        if score > 0.0:
            candidates.append(SearchResult(range=c["range"], score=score))

    candidates.sort(key=lambda x: (-x.score, x.range))
    return candidates[:top_k]


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "search":
        if len(sys.argv) < 4:
            print("usage: python3 tools/wf.py search <query> <paths>...", file=sys.stderr)
            sys.exit(2)
        q = sys.argv[2]
        p = sys.argv[3:]
        results = search(q, p)
        for r in results:
            print(f"{r.range}\t{r.score:.4f}")
    else:
        print("usage: python3 tools/wf.py search <query> <paths>...", file=sys.stderr)
        sys.exit(2)
