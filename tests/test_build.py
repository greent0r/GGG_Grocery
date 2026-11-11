import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from PIL import Image

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
        self.assertEqual(hashlib.sha256((self.root / "_site" / record["original"]).read_bytes()).hexdigest(), expected)
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), expected)
        for key, maximum in (("thumbnail", 720), ("preview", 2400)):
            with Image.open(self.root / "_site" / record[key]) as image:
                self.assertLessEqual(max(image.size), maximum)


if __name__ == "__main__":
    unittest.main()
