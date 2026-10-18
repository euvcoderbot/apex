"""Windowless Windows protocol entrypoint; only the fixed local start action."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys


def main(args):
    if len(args) != 1 or not re.fullmatch(r'apex-local://start/?', args[0], re.IGNORECASE):
        raise ValueError('Only apex-local://start is supported.')
    root = Path(__file__).resolve().parents[1]
    node = shutil.which('node.exe') or r'C:\Program Files\nodejs\node.exe'
    if not Path(node).is_file():
        raise FileNotFoundError('Node.js is not installed.')
    logs = root / '.apex-cache' / 'launcher'
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / 'launcher.log').open('ab') as output:
        result = subprocess.run(
            [node, str(root / 'scripts' / 'launch-local.mjs'), 'apex-local://start'],
            cwd=root, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            check=False)
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as error:
        log = Path(__file__).resolve().parents[1] / '.apex-cache' / 'launcher'
        log.mkdir(parents=True, exist_ok=True)
        with (log / 'launcher.log').open('a', encoding='utf-8') as stream:
            stream.write(f'Windowless launcher failed: {error}\n')
        sys.exit(1)
