#!/usr/bin/env python3
"""Combine the gallery shell, a page spec, data, and images into one HTML file."""
import argparse, base64, io, json, pathlib, shutil, subprocess, sys, tempfile

MAX_BYTES = 16 * 1024 * 1024
SHELL = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'shell.html'


def open_image(path):
    """Open with Pillow; for formats this Pillow can't read (often AVIF/HEIC), fall back to macOS sips if present."""
    from PIL import Image, UnidentifiedImageError
    try:
        return Image.open(path).convert('RGBA')
    except UnidentifiedImageError:
        if not shutil.which('sips'):
            sys.exit(f'Cannot read {path}: convert it to PNG first, or install pillow-heif / a newer Pillow.')
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / 'converted.png'
        subprocess.run(['sips', '-s', 'format', 'png', str(path), '--out', str(out)],
                       check=True, capture_output=True)
        return Image.open(out).convert('RGBA')


def embed(entry):
    from PIL import Image
    img = open_image(pathlib.Path(entry['path']))
    if entry.get('trim'):
        box = img.getbbox()
        if box:
            img = img.crop(box)
    width = entry.get('width', 360)
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def safe_json(obj):
    return json.dumps(obj, ensure_ascii=False).replace('</', '<\\/')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--spec', required=True)
    p.add_argument('--data')
    p.add_argument('--images')
    p.add_argument('--title', required=True)
    p.add_argument('--out', required=True)
    a = p.parse_args()

    data = json.load(open(a.data)) if a.data else {}
    manifest = json.load(open(a.images)) if a.images else {}
    images = {}
    for key, entry in manifest.items():
        if not pathlib.Path(entry['path']).exists():
            print(f'  missing image, skipped: {key}', file=sys.stderr)
            continue
        images[key] = embed(entry)

    spec = pathlib.Path(a.spec).read_text()
    html = (SHELL.read_text()
            .replace('__TITLE__', a.title)
            .replace('__DATA__', safe_json(data))
            .replace('__IMAGES__', safe_json(images))
            .replace('/*__SPEC__*/', spec.replace('</script', '<\\/script')))
    size = len(html.encode())
    if size > MAX_BYTES:
        sys.exit(f'Too large: {size/1e6:.1f}MB (limit 16MB). Lower image widths in images.json.')
    pathlib.Path(a.out).write_text(html)
    print(f'{a.out}: {size/1e6:.1f}MB, {len(images)} images')


if __name__ == '__main__':
    main()
