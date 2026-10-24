"""Small photos for an atlas's lists (deploy/make-small-photos.mjs).

Reads a JSON list on stdin: [{"in": <photo file>, "out": <small .jpg>}, ...]
and writes each as a JPEG at most SIZE pixels on its longest side, turned the
way the camera meant (EXIF), on white where the photo was see-through.
Prints one JSON line per photo: {"out": ..., "ok": true, "bytes": n} or
{"out": ..., "ok": false, "why": "..."}. Pillow only.
"""
import json
import os
import sys

from PIL import Image, ImageOps

SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 160
QUALITY = int(sys.argv[2]) if len(sys.argv) > 2 else 70


def small(src, out):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            ground = Image.new("RGB", im.size, (255, 255, 255))
            ground.paste(im, mask=im.split()[-1])
            im = ground
        elif im.mode != "RGB":
            im = im.convert("RGB")
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
        im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)


def main():
    jobs = json.load(sys.stdin)
    for job in jobs:
        try:
            small(job["in"], job["out"])
            print(json.dumps({"out": job["out"], "ok": True, "bytes": os.path.getsize(job["out"])}), flush=True)
        except Exception as e:  # one bad photo never stops the rest
            print(json.dumps({"out": job["out"], "ok": False, "why": (type(e).__name__ + ": " + str(e))[:200]}), flush=True)


if __name__ == "__main__":
    main()
