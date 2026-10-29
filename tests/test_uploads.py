import base64
import json
import time
import unittest
from unittest.mock import patch

import cloud_backend
import server


class UploadTest(unittest.TestCase):
    def test_signed_ticket_is_expiring_and_cannot_choose_another_object(self):
        value = 'a' * 32 + '.' + str(int(time.time()) + 900)
        token = value + '.' + server.upload_signature(value)
        with patch('cloud_backend.read_upload', return_value=b'image') as read, patch('cloud_backend.remove_upload') as remove:
            self.assertEqual(server.read_signed_upload(token), b'image')
            read.assert_called_once_with('a' * 32)
            remove.assert_called_once_with('a' * 32)
        expired = 'a' * 32 + '.' + str(int(time.time()) - 1)
        for invalid in [token.replace('a', 'b', 1), '../secret', None,
                        expired + '.' + server.upload_signature(expired)]:
            with patch('cloud_backend.read_upload') as read:
                with self.assertRaises(server.ImageValidationError):
                    server.read_signed_upload(invalid)
                read.assert_not_called()

    def test_ten_mb_staged_image_is_accepted_but_one_more_byte_is_rejected(self):
        raw = b'\xff\xd8\xff' + b'\0' * (10_000_000 - 3)
        with patch.object(server, 'CLOUD', True), patch.object(server, 'save_image', create=True, return_value=('url', 'file')) as save, patch('cloud_backend.read_upload', return_value=raw), patch('cloud_backend.remove_upload'):
            value = 'a' * 32 + '.' + str(int(time.time()) + 900)
            ticket = {'upload_token': value + '.' + server.upload_signature(value)}
            server.save_uploaded_image(ticket)
            self.assertEqual(len(save.call_args.args[1]), 10_000_000)
            with patch('cloud_backend.read_upload', return_value=raw + b'\0'):
                with self.assertRaises(server.ImageValidationError):
                    server.save_uploaded_image(ticket)
            self.assertEqual(save.call_count, 1)

    def test_existing_three_mb_bucket_is_upgraded(self):
        old = {'public': True, 'file_size_limit': 3_000_000,
               'allowed_mime_types': ['image/png', 'image/jpeg', 'image/webp']}
        with patch('cloud_backend.storage_request', side_effect=[json.dumps(old).encode(), b'{}']) as request:
            cloud_backend.ensure_bucket()
        args = request.call_args.args
        self.assertEqual((args[0], args[2]), ('bucket/gallery-artworks', 'PUT'))
        self.assertEqual(json.loads(args[1])['file_size_limit'], 10_000_000)

    def test_direct_upload_uses_private_bucket_and_scoped_token(self):
        with patch('cloud_backend.ensure_bucket') as bucket, patch('cloud_backend.storage_request', return_value=b'{"url":"/object/upload/sign/gallery-uploads/abc?token=scoped-token"}'), patch('cloud_backend.supabase_url', return_value='https://example.supabase.co'):
            url = cloud_backend.sign_upload('abc')
        bucket.assert_called_once_with('gallery-uploads', private=True)
        self.assertEqual(url, 'https://example.supabase.co/storage/v1/object/upload/sign/gallery-uploads/abc?token=scoped-token')
