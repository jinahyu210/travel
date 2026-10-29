"""Small display copies of public artwork; originals are never modified."""
from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import re
from threading import BoundedSemaphore
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_SOURCE_BYTES = 10_000_000
MAX_SOURCE_PIXELS = 60_000_000
THUMBNAIL_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable'
PATH_PATTERN = re.compile(r'/api/thumbnails/(320|640|1280)/((?:exhibition-)?[0-9a-f]{32}\.(?:png|jpg|webp))')
# Large PNG/WebP sources still need a full decode. Keep those buffers from
# multiplying when a warm server handles several new thumbnails together.
DECODE_SLOTS = BoundedSemaphore(1)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Public storage objects must stay on the configured project origin.
        return None


def read_source(origin, filename, local):
    if local:
        folder = Path(origin)
        source = folder / filename
        if source.is_symlink() or source.resolve().parent != folder.resolve():
            raise FileNotFoundError()
        with source.open('rb') as stream:
            raw = stream.read(MAX_SOURCE_BYTES + 1)
    else:
        request = Request(origin + '/storage/v1/object/public/gallery-artworks/' + filename,
                          headers={'Accept': 'image/jpeg,image/png,image/webp'})
        with build_opener(NoRedirect()).open(request, timeout=10) as response:
            raw = response.read(MAX_SOURCE_BYTES + 1)
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ValueError('invalid source size')
    return raw


def resize_image(raw, size):
    with DECODE_SLOTS:
        return _resize_image(raw, size)


def _resize_image(raw, size):
    with Image.open(BytesIO(raw)) as source:
        if source.format not in {'JPEG', 'PNG', 'WEBP'} or source.width * source.height > MAX_SOURCE_PIXELS:
            raise ValueError('unsupported source')
        icc = source.info.get('icc_profile')
        if source.format == 'JPEG':
            # Ask libjpeg to subsample during decoding, before EXIF transposition
            # creates another buffer. Final LANCZOS sizing still sets the bounds.
            ratio = min(1, size / max(source.size))
            source.draft('RGB', (max(1, int(source.width * ratio)), max(1, int(source.height * ratio))))
        image = ImageOps.exif_transpose(source)
        image.thumbnail((size, size), Image.Resampling.LANCZOS, reducing_gap=3)
        if image.mode not in {'RGB', 'RGBA'}:
            alpha = 'A' in image.getbands() or 'transparency' in image.info
            image = image.convert('RGBA' if alpha else 'RGB')
        output = BytesIO()
        options = {'icc_profile': icc} if icc else {}
        image.save(output, 'WEBP', quality=86, method=4, **options)
        return output.getvalue()


@lru_cache(maxsize=24)
def thumbnail(origin, filename, size, local):
    # At most 24 bounded display images are retained per warm process. UUID
    # source names change when an image is replaced, so copies remain immutable.
    return resize_image(read_source(origin, filename, local), size)


def thumbnail_response(path, image_dir=None):
    match = PATH_PATTERN.fullmatch(urlsplit(path).path)
    if not match:
        return error_response(404)
    size, filename = match.groups()
    try:
        if image_dir is None:
            from cloud_backend import supabase_url
            origin = supabase_url()
        else:
            origin = str(Path(image_dir).resolve())
        data = thumbnail(origin, filename, int(size), image_dir is not None)
    except FileNotFoundError:
        return error_response(404)
    except HTTPError as error:
        return error_response(404 if error.code == 404 else 502)
    except (ValueError, OSError, URLError, UnidentifiedImageError, Image.DecompressionBombError):
        return error_response(422)
    return 200, data, 'image/webp', THUMBNAIL_CACHE


def error_response(status):
    body = json.dumps({'error': '이미지 미리보기를 불러오지 못했습니다.'}, ensure_ascii=False).encode()
    return status, body, 'application/json; charset=utf-8', 'no-store'
