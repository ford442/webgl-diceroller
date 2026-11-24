"""Unit tests for deploy.py's pure logic. Run: python3 -m unittest discover -s tests/python"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import deploy  # noqa: E402


class DeployTests(unittest.TestCase):
    def make_dist(self, files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for rel, content in files.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(content)
        return root

    def test_token_required_and_not_in_source(self):
        with self.assertRaises(SystemExit):
            deploy.require_token({})
        self.assertEqual(deploy.require_token({"DEPLOY_TOKEN": " abc "}), "abc")
        src = Path(deploy.__file__).read_text()
        self.assertNotRegex(src, r"[0-9a-f]{64}")

    def test_targets(self):
        self.assertEqual(deploy.target_config("staging", {})["site"], "test")
        with self.assertRaises(SystemExit):
            deploy.target_config("production", {})
        self.assertEqual(deploy.target_config("production", {"DEPLOY_PRODUCTION_SITE": "go"})["site"], "go")
        with self.assertRaises(SystemExit):
            deploy.target_config("prod-typo", {})

    def test_same_size_different_content_is_uploaded(self):
        root = self.make_dist({"index.html": b"AAAA", "images/a.glb": b"1111", "images/b.glb": b"2222"})
        files = deploy.local_files(root)
        old_hashes = {
            "index.html": deploy.sha256_file(root / "index.html"),
            "images/a.glb": deploy.sha256_file(root / "images/a.glb"),
            "images/b.glb": "deadbeef",  # same size remote copy, different content
        }
        sizes = {"index.html": 4, "images/a.glb": 4, "images/b.glb": 4}
        _, upload, skipped = deploy.select_uploads(files, sizes, old_hashes)
        self.assertIn("index.html", upload)  # always uploaded, even when identical
        self.assertIn("images/b.glb", upload)  # size matches, hash does not
        self.assertEqual(skipped, ["images/a.glb"])

    def test_no_remote_manifest_uploads_everything(self):
        root = self.make_dist({"images/a.glb": b"1111"})
        _, upload, skipped = deploy.select_uploads(deploy.local_files(root), {"images/a.glb": 4}, {})
        self.assertEqual((upload, skipped), (["images/a.glb"], []))

    def test_always_upload_set(self):
        for name in ("index.html", "sw.js", "registerSW.js", "manifest.webmanifest", "build-info.json", "workbox-835c8c05.js"):
            self.assertTrue(deploy.is_always_upload(name), name)
        self.assertFalse(deploy.is_always_upload("assets/index-abc.js"))
        self.assertFalse(deploy.is_always_upload("images/index.html"))

    def test_force_uploads_all(self):
        root = self.make_dist({"images/a.glb": b"1111"})
        files = deploy.local_files(root)
        h = {"images/a.glb": deploy.sha256_file(root / "images/a.glb")}
        _, upload, _ = deploy.select_uploads(files, {"images/a.glb": 4}, h, force=True)
        self.assertEqual(upload, ["images/a.glb"])


if __name__ == "__main__":
    unittest.main()
