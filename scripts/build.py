"""Build a static photo shelf. Originals are copied byte for byte."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "_site"
SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


def build():
    # This script owns only the generated _site directory in this checkout.
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    shutil.copytree(ROOT / "public", OUTPUT)
    photos = []
    paths = sorted((ROOT / "photos").rglob("*"), reverse=True)
    images = [p for p in paths if p.is_file() and p.suffix.lower() in SUPPORTED]
    if images:
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS = None
        for directory in ("thumbnails", "previews", "originals"):
            (OUTPUT / "media" / directory).mkdir(parents=True, exist_ok=True)
        for source in images:
            relative = source.relative_to(ROOT / "photos").as_posix()
            key = hashlib.sha256(relative.encode() + source.read_bytes()).hexdigest()[:24]
            original = f"media/originals/{key}{source.suffix.lower()}"
            shutil.copyfile(source, OUTPUT / original)
            with Image.open(source) as image:
                image = ImageOps.exif_transpose(image)
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                width, height = image.size
                for directory, edge, quality in (("thumbnails", 720, 80), ("previews", 2400, 88)):
                    copy = image.copy()
                    copy.thumbnail((edge, edge))
                    copy.save(OUTPUT / "media" / directory / f"{key}.webp", quality=quality, method=6)
            photos.append({"name": source.stem, "width": width, "height": height,
                           "thumbnail": f"media/thumbnails/{key}.webp",
                           "preview": f"media/previews/{key}.webp", "original": original})
    (OUTPUT / "photos.json").write_text(json.dumps({"photos": photos}, ensure_ascii=False), encoding="utf-8")
    (OUTPUT / ".nojekyll").touch()
    print(f"Built {len(photos)} photos in {OUTPUT}")


if __name__ == "__main__":
    build()
