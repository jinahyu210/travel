from io import BytesIO
from pathlib import Path
from http.server import ThreadingHTTPServer
import random
import tempfile
from threading import Thread
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image
import image_delivery as delivery
from api.thumbnail import handler


class ImageDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.filename = 'a' * 32 + '.jpg'
        self.path = '/api/thumbnails/640/' + self.filename
        delivery.thumbnail.cache_clear()

    def tearDown(self):
        self.folder.cleanup()
        delivery.thumbnail.cache_clear()

    def source(self, dimensions=(1800, 1200), **save_options):
        image = Image.new('RGB', dimensions, '#9b6041')
        image.save(self.root / self.filename, 'JPEG', **save_options)
        return (self.root / self.filename).read_bytes()

    def test_preserves_aspect_ratio_and_original_and_caches_copy(self):
        original = self.source()
        status, body, mime, cache = delivery.thumbnail_response(self.path, self.root)
        self.assertEqual(status, 200)
        self.assertEqual(mime, 'image/webp')
        self.assertIn('immutable', cache)
        with Image.open(BytesIO(body)) as image:
            self.assertEqual(image.size, (640, 427))
        self.assertEqual((self.root / self.filename).read_bytes(), original)
        with patch.object(delivery, 'read_source', side_effect=AssertionError('cached image fetched again')):
            self.assertEqual(delivery.thumbnail_response(self.path, self.root)[1], body)

    def test_does_not_upscale_small_images(self):
        self.source((80, 60))
        with Image.open(BytesIO(delivery.thumbnail_response(self.path, self.root)[1])) as image:
            self.assertEqual(image.size, (80, 60))

    def test_exif_orientation_and_color_profile(self):
        exif = Image.Exif()
        exif[274] = 6
        profile = b'test-embedded-color-profile'
        self.source((60, 30), exif=exif, icc_profile=profile)
        with Image.open(BytesIO(delivery.thumbnail_response(self.path, self.root)[1])) as image:
            self.assertEqual(image.size, (30, 60))
            self.assertEqual(image.info['icc_profile'], profile)

    def test_preserves_grayscale_transparency(self):
        source = BytesIO()
        Image.new('LA', (12, 8), (120, 60)).save(source, 'PNG')
        with Image.open(BytesIO(delivery.resize_image(source.getvalue(), 640))) as image:
            self.assertEqual(image.mode, 'RGBA')
            self.assertEqual(image.getpixel((0, 0))[3], 60)

    def test_rejects_excessive_decoded_pixels(self):
        self.source((12, 12))
        with patch.object(delivery, 'MAX_SOURCE_PIXELS', 100):
            self.assertEqual(delivery.thumbnail_response(self.path, self.root)[0], 422)

    def test_large_jpeg_subsampling_preserves_orientation_and_final_bounds(self):
        exif = Image.Exif()
        exif[274] = 6
        self.source((3600, 2400), exif=exif)
        with Image.open(BytesIO(delivery.thumbnail_response(self.path, self.root)[1])) as image:
            self.assertEqual(image.size, (427, 640))

    def test_standalone_route_and_conditional_response(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/api/thumbnail.py?route=640/{self.filename}'
            with patch('api.thumbnail.thumbnail_response', return_value=(200, b'image-bytes', 'image/webp', delivery.THUMBNAIL_CACHE)) as response:
                with urlopen(url) as result:
                    self.assertEqual(result.status, 200)
                    self.assertEqual(result.read(), b'image-bytes')
                    etag = result.headers['ETag']
                response.assert_called_with(self.path)
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(url, headers={'If-None-Match': etag}))
                self.assertEqual(caught.exception.code, 304)
                self.assertEqual(caught.exception.read(), b'')
                self.assertNotIn('Content-Length', caught.exception.headers)
        finally:
            server.shutdown()
            worker.join()
            server.server_close()

    def test_invalid_sizes_names_and_paths_never_open_sources(self):
        with patch.object(delivery, 'read_source', side_effect=AssertionError('invalid source fetched')):
            for path in [self.path.replace('/640/', '/9000/'), '/api/thumbnails/640/../../secret',
                         self.path + '/extra', self.path.replace('.jpg', '.svg'),
                         '/api/thumbnails/640/https://example.com/image.jpg',
                         '/api/thumbnails/640/%2e%2e%2fsecret.jpg']:
                with self.subTest(path=path):
                    self.assertEqual(delivery.thumbnail_response(path, self.root)[0], 404)

    def test_missing_corrupt_and_oversized_sources_are_not_cached(self):
        self.assertEqual(delivery.thumbnail_response(self.path, self.root)[0], 404)
        (self.root / self.filename).write_bytes(b'not an image')
        status, _, _, cache = delivery.thumbnail_response(self.path, self.root)
        self.assertEqual(status, 422)
        self.assertEqual(cache, 'no-store')
        (self.root / self.filename).write_bytes(b'a' * (delivery.MAX_SOURCE_BYTES + 1))
        self.assertEqual(delivery.thumbnail_response(self.path, self.root)[0], 422)
        self.assertEqual(delivery.thumbnail.cache_info().currsize, 0)

    def test_symlink_is_rejected(self):
        target = self.root / 'outside.jpg'
        Image.new('RGB', (10, 10)).save(target)
        (self.root / self.filename).symlink_to(target)
        self.assertEqual(delivery.thumbnail_response(self.path, self.root)[0], 404)

    def test_cloud_source_is_fixed_public_bucket_and_bounded(self):
        self.source((80, 60))
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = (self.root / self.filename).read_bytes()
        opener = Mock()
        opener.open.return_value = response
        with patch('cloud_backend.supabase_url', return_value='https://project.supabase.co'), \
             patch.object(delivery, 'build_opener', return_value=opener):
            self.assertEqual(delivery.thumbnail_response(self.path)[0], 200)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://project.supabase.co/storage/v1/object/public/gallery-artworks/' + self.filename)
        self.assertFalse(request.has_header('Authorization'))
        response.read.assert_called_once_with(delivery.MAX_SOURCE_BYTES + 1)
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 10)
        self.assertIsNone(delivery.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://elsewhere'))

    def test_cloud_failure_is_not_cached(self):
        with patch.object(delivery, 'read_source', side_effect=HTTPError('url', 404, 'missing', {}, None)):
            status, _, _, cache = delivery.thumbnail_response(self.path)
        self.assertEqual(status, 404)
        self.assertEqual(cache, 'no-store')

    def test_real_display_copy_is_smaller_than_photographic_original(self):
        image = Image.frombytes('RGB', (1800, 1200), random.Random(42).randbytes(1800 * 1200 * 3))
        image.save(self.root / self.filename, 'JPEG', quality=90)
        original_size = (self.root / self.filename).stat().st_size
        status, body, _, _ = delivery.thumbnail_response(self.path, self.root)
        self.assertEqual(status, 200)
        self.assertLess(len(body), original_size // 3)
