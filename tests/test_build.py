import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

PROJECT = Path(__file__).resolve().parent.parent


class PhotoBuildTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        shutil.copytree(PROJECT / "public", self.root / "public")
        (self.root / "photos").mkdir()
        spec = importlib.util.spec_from_file_location("photo_build", PROJECT / "scripts/build.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.ROOT = self.root
        self.module.OUTPUT = self.root / "_site"

    def tearDown(self):
        self.temp.cleanup()

    def test_empty_shelf(self):
        self.module.build()
        self.assertEqual(json.loads((self.root / "_site/photos.json").read_text()), {"photos": []})
        self.assertTrue((self.root / "_site/index.html").exists())

    def test_original_is_unchanged_and_previews_are_resized(self):
        original = self.root / "photos/测试照片.png"
        Image.new("RGB", (3200, 1800), "blue").save(original)
        expected = hashlib.sha256(original.read_bytes()).hexdigest()
        self.module.build()
        record = json.loads((self.root / "_site/photos.json").read_text(encoding="utf-8"))["photos"][0]
        self.assertEqual(record["name"], "测试照片")
        self.assertEqual(record["metadata"], {})
        self.assertEqual(hashlib.sha256((self.root / "_site" / record["original"]).read_bytes()).hexdigest(), expected)
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), expected)
        for key, maximum in (("thumbnail", 720), ("preview", 2400)):
            with Image.open(self.root / "_site" / record[key]) as image:
                self.assertLessEqual(max(image.size), maximum)

    def test_camera_parameters_are_read_from_original_exif(self):
        source = self.root / "photos/camera.jpg"
        exif = Image.Exif()
        exif[271] = "FUJIFILM"
        exif[272] = "X-T30"
        exif[34665] = {33434: IFDRational(1, 1250), 33437: IFDRational(4),
                       34855: 200, 37386: IFDRational(444, 10), 41989: 67,
                       36867: "2026:11:09 15:55:32", 41987: 0,
                       42036: "XF18-55mmF2.8-4 R LM OIS"}
        Image.new("RGB", (800, 600), "blue").save(source, exif=exif)
        self.module.build()
        record = json.loads((self.root / "_site/photos.json").read_text(encoding="utf-8"))["photos"][0]
        self.assertEqual(record["metadata"], {
            "camera": "FUJIFILM X-T30", "lens": "XF18-55mmF2.8-4 R LM OIS",
            "shutter": "1/1250 s", "aperture": "f/4", "iso": "200",
            "focalLength": "44.4 mm", "equivalentFocalLength": "67 mm",
            "capturedAt": "2026-11-09 15:55:32", "whiteBalance": "自动"})
        self.assertEqual(record["filename"], "camera.jpg")
        self.assertEqual(record["bytes"], source.stat().st_size)
        self.assertEqual(record["format"], "JPEG")


if __name__ == "__main__":
    unittest.main()
