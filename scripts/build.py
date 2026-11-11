"""Build a static photo shelf. Originals are copied byte for byte."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "_site"
SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


def camera_metadata(image):
    exif = image.getexif()
    values = dict(exif)
    try:
        values.update(exif.get_ifd(34665))
    except (KeyError, TypeError, ValueError):
        pass
    metadata = {}
    camera = " ".join(str(values[tag]).strip() for tag in (271, 272) if values.get(tag))
    if camera:
        metadata["camera"] = camera
    if values.get(42036):
        metadata["lens"] = str(values[42036]).strip()
    if values.get(33434):
        seconds = float(values[33434])
        reciprocal = 1 / seconds if seconds > 0 else 0
        metadata["shutter"] = (f"1/{round(reciprocal)} s"
                               if seconds < 1 and abs(reciprocal - round(reciprocal)) < 0.01
                               else f"{seconds:g} s")
    if values.get(33437):
        metadata["aperture"] = f"f/{float(values[33437]):g}"
    if values.get(34855):
        metadata["iso"] = str(values[34855])
    if values.get(37386):
        metadata["focalLength"] = f"{float(values[37386]):g} mm"
    if values.get(41989):
        metadata["equivalentFocalLength"] = f"{float(values[41989]):g} mm"
    if values.get(36867):
        metadata["capturedAt"] = str(values[36867]).replace(":", "-", 2)
    if values.get(41987) in (0, 1):
        metadata["whiteBalance"] = {0: "自动", 1: "手动"}[values[41987]]
    return metadata


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
            first_folder = source.relative_to(ROOT / "photos").parts[0]
            owner = first_folder if first_folder in {"guigui", "xiaoqiu"} else "guigui"
            key = hashlib.sha256(relative.encode() + source.read_bytes()).hexdigest()[:24]
            original = f"media/originals/{key}{source.suffix.lower()}"
            shutil.copyfile(source, OUTPUT / original)
            with Image.open(source) as image:
                metadata = camera_metadata(image)
                image_format = image.format
                image = ImageOps.exif_transpose(image)
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                width, height = image.size
                for directory, edge, quality in (("thumbnails", 720, 80), ("previews", 2400, 88)):
                    copy = image.copy()
                    copy.thumbnail((edge, edge))
                    copy.save(OUTPUT / "media" / directory / f"{key}.webp", quality=quality, method=6)
            photos.append({"name": source.stem, "filename": source.name, "owner": owner,
                           "width": width, "height": height, "bytes": source.stat().st_size,
                           "format": image_format, "metadata": metadata,
                           "thumbnail": f"media/thumbnails/{key}.webp",
                           "preview": f"media/previews/{key}.webp", "original": original})
    (OUTPUT / "photos.json").write_text(json.dumps({"photos": photos}, ensure_ascii=False), encoding="utf-8")
    (OUTPUT / ".nojekyll").touch()
    print(f"Built {len(photos)} photos in {OUTPUT}")


if __name__ == "__main__":
    build()
