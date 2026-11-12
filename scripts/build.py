"""Build the photo shop. Originals stay unchanged; previews and colour ordering are generated."""
from pathlib import Path
from datetime import datetime
from fractions import Fraction
from xml.etree import ElementTree
import hashlib
import json
import math
import re
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '_site'
SUPPORTED = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'}
LAB_TRANSFORM = None


def clean_text(value):
    text = str(value or '').strip().strip('\x00')
    return text if text and all(c.isprintable() for c in text) else ''


def capture_date(value):
    match = re.match(r'^(\d{4})[:-](\d{2})[:-](\d{2})(?:[T ](\d{2}:\d{2}:\d{2}))?', str(value or ''))
    if not match:
        return ''
    date = '-'.join(match.group(i) for i in (1, 2, 3))
    if match.group(4):
        date += ' ' + match.group(4)
    try:
        datetime.fromisoformat(date)
    except ValueError:
        return ''
    return date


def xmp_fields(image):
    raw = image.info.get('xmp', '')
    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else raw
    text = re.sub('[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    if not text:
        return {}
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return {}
    fields = {}
    for node in root.iter():
        for key, value in node.attrib.items():
            fields[key.rsplit('}', 1)[-1]] = clean_text(value)
        if node.text and node.text.strip():
            fields[node.tag.rsplit('}', 1)[-1]] = clean_text(node.text)
    return fields


def number(value):
    try:
        value = float(Fraction(str(value)))
        return value if math.isfinite(value) and value > 0 else None
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def camera_metadata(image):
    exif = image.getexif()
    values = dict(exif)
    try:
        values.update(exif.get_ifd(34665))
    except (KeyError, TypeError, ValueError):
        pass
    xmp = xmp_fields(image)
    metadata = {}
    camera = ' '.join(filter(None, (clean_text(values.get(tag)) for tag in (271, 272))))
    if camera:
        metadata['camera'] = camera
    lens = clean_text(values.get(42036)) or xmp.get('LensModel') or xmp.get('Lens')
    if lens:
        metadata['lens'] = lens
    # These exports contain corrupt IFD offsets: do not publish their repeated, invalid rationals.
    broken_ifd = bool(values.get(42036) and not clean_text(values[42036]))
    aperture = number(values.get(33437))
    broken_ifd = broken_ifd or bool(aperture and aperture < 0.5)
    if not broken_ifd:
        seconds = number(values.get(33434))
        if seconds:
            reciprocal = 1 / seconds
            metadata['shutter'] = (f'1/{round(reciprocal)} s' if seconds < 1 and abs(reciprocal - round(reciprocal)) < 0.01 else f'{seconds:g} s')
        if aperture:
            metadata['aperture'] = f'f/{aperture:g}'
        if values.get(34855):
            metadata['iso'] = str(values[34855])
        focal = number(values.get(37386))
        if focal:
            metadata['focalLength'] = f'{focal:g} mm'
        equivalent = number(values.get(41989))
        if equivalent:
            metadata['equivalentFocalLength'] = f'{equivalent:g} mm'
        if values.get(41987) in (0, 1):
            metadata['whiteBalance'] = {0: '自动', 1: '手动'}[values[41987]]
    date = capture_date(values.get(36867))
    for key in ('DateTimeOriginal', 'DateCreated', 'CreateDate'):
        date = date or capture_date(xmp.get(key))
    if date:
        metadata['capturedAt'] = date
    return metadata


def colour_features(image):
    from PIL import ImageCms, ImageStat
    global LAB_TRANSFORM
    if LAB_TRANSFORM is None:
        LAB_TRANSFORM = ImageCms.buildTransform(ImageCms.createProfile('sRGB'), ImageCms.createProfile('LAB'), 'RGB', 'LAB')
    sample = image.convert('RGB').resize((64, 64))
    lab = ImageCms.applyTransform(sample, LAB_TRANSFORM)
    stats = ImageStat.Stat(lab)
    return [round(stats.mean[0] * 100 / 255 * 0.7, 3), round(stats.mean[1] - 128, 3),
            round(stats.mean[2] - 128, 3), round(stats.stddev[0] * 100 / 255 * 0.3, 3)]


def colour_distance(first, second):
    return math.dist(first['colour'], second['colour'])


def colour_sequence(group):
    if len(group) < 3:
        return sorted(group, key=lambda p: (-p['colour'][0], p['name']))
    # Try every starting photo, then keep the smoothest nearest-neighbour path.
    candidates = []
    for start in range(len(group)):
        remaining = list(range(len(group)))
        remaining.remove(start)
        path = [start]
        while remaining:
            next_index = min(remaining, key=lambda i: (colour_distance(group[path[-1]], group[i]), group[i]['name']))
            path.append(next_index)
            remaining.remove(next_index)
        cost = sum(colour_distance(group[a], group[b]) for a, b in zip(path, path[1:]))
        candidates.append((cost, path))
    path = min(candidates, key=lambda candidate: candidate[0])[1]
    if group[path[0]]['colour'][0] < group[path[-1]]['colour'][0]:
        path.reverse()
    return [group[i] for i in path]


def arrange_photos(photos):
    groups = {}
    for photo in photos:
        day = photo['metadata'].get('capturedAt', '')[:10]
        groups.setdefault((photo['owner'], day), []).append(photo)
    arranged = []
    for key in sorted(groups, key=lambda key: (key[0], key[1] or '9999')):
        arranged.extend(colour_sequence(groups[key]))
    return arranged


def build():
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    shutil.copytree(ROOT / 'public', OUTPUT)
    photos = []
    images = [p for p in sorted((ROOT / 'photos').rglob('*')) if p.is_file() and p.suffix.lower() in SUPPORTED]
    if images:
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS = None
        for directory in ('thumbnails', 'previews', 'originals'):
            (OUTPUT / 'media' / directory).mkdir(parents=True, exist_ok=True)
        for source in images:
            relative = source.relative_to(ROOT / 'photos')
            owner = relative.parts[0] if relative.parts[0] in {'guigui', 'xiaoqiu'} else 'guigui'
            key = hashlib.sha256(relative.as_posix().encode() + source.read_bytes()).hexdigest()[:24]
            original = f'media/originals/{key}{source.suffix.lower()}'
            shutil.copyfile(source, OUTPUT / original)
            with Image.open(source) as image:
                metadata = camera_metadata(image)
                if not metadata.get('capturedAt'):
                    for part in relative.parts[:-1]:
                        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', part) and capture_date(part):
                            metadata['capturedAt'] = part
                image_format = image.format
                image = ImageOps.exif_transpose(image).convert('RGB')
                width, height = image.size
                colour = colour_features(image)
                for directory, edge, quality in (('thumbnails', 720, 80), ('previews', 2400, 88)):
                    copy = image.copy()
                    copy.thumbnail((edge, edge))
                    copy.save(OUTPUT / 'media' / directory / f'{key}.webp', quality=quality, method=6)
            photos.append({'name': source.stem, 'filename': source.name, 'owner': owner,
                           'width': width, 'height': height, 'bytes': source.stat().st_size,
                           'format': image_format, 'metadata': metadata, 'colour': colour,
                           'thumbnail': f'media/thumbnails/{key}.webp',
                           'preview': f'media/previews/{key}.webp', 'original': original})
    photos = arrange_photos(photos)
    (OUTPUT / 'photos.json').write_text(json.dumps({'photos': photos}, ensure_ascii=False), encoding='utf-8')
    (OUTPUT / '.nojekyll').touch()
    print(f'Built {len(photos)} photos in {OUTPUT}')


if __name__ == '__main__':
    build()
