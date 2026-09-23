import sys

import fitz


def main() -> int:
    if len(sys.argv) != 2:
        return 2
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    with fitz.open(sys.argv[1]) as document:
        sys.stdout.write("\n".join(page.get_text("text", sort=True) for page in document))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
