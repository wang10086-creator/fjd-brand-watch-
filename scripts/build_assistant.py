"""Build the public local-helper bundle from an explicit allowlist. No private data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / 'downloads' / 'fjd-feishu-assistant.zip'
files = [p for p in root.iterdir() if p.is_file() and p.suffix in {'.js', '.css', '.html', '.json', '.md', '.bat'}]
for directory in ('assets', 'connectivity'):
    files.extend(p for p in (root / directory).rglob('*') if p.is_file())
files.extend(root / 'bridge' / name for name in ('assistant.py', 'setup.html', 'setup.js', 'permissions.json'))
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, 'fjd-feishu-assistant/' + path.relative_to(root).as_posix())
print(f'{output.name}: {len(files)} files, {output.stat().st_size:,} bytes')
