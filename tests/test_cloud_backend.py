import io
import os
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
import cloud_backend


class CloudAdapterTest(unittest.TestCase):
    @patch.dict(os.environ, {'SUPABASE_URL': '  SUPABASE_URL="https://example.supabase.co/"  '})
    def test_dashboard_wrappers_are_removed_from_project_url(self):
        self.assertEqual(cloud_backend.supabase_url(), 'https://example.supabase.co')

    @patch.dict(os.environ, {'SUPABASE_URL': 'not a project URL'}, clear=True)
    def test_project_url_falls_back_to_known_public_origin(self):
        self.assertEqual(cloud_backend.supabase_url(), cloud_backend.PROJECT_URL)

    @patch.dict(os.environ, {
        'SUPABASE_URL': 'copied the wrong value',
        'SUPABASE_DB_URL': 'postgresql://postgres.gpplsvtkejdeqcruhhjh:secret@pooler.example.com:6543/postgres'
    })
    def test_project_url_is_recovered_from_pooler_username(self):
        self.assertEqual(cloud_backend.supabase_url(), 'https://gpplsvtkejdeqcruhhjh.supabase.co')

    @patch.dict(os.environ, {'SUPABASE_SERVICE_ROLE_KEY': 'service role: copied label'}, clear=True)
    def test_malformed_service_key_is_reported_as_authentication_error(self):
        with self.assertRaises(cloud_backend.StorageAuthenticationError):
            cloud_backend.service_key()

    def test_sql_values_remain_bound_and_ordering_is_portable(self):
        connection = Mock()
        db = cloud_backend.Database(connection)
        value = "x'; DROP TABLE artworks; --"
        db.execute('SELECT * FROM artworks WHERE series=? ORDER BY rowid DESC', (value,))
        connection.execute.assert_called_once_with(
            'SELECT * FROM artworks WHERE series=%s ORDER BY id DESC', (value,))

    @patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co',
                             'SUPABASE_SERVICE_ROLE_KEY': 'server-only-test-key'})
    def test_storage_credentials_are_headers_not_public_url(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{}'
        with patch('cloud_backend.urlopen', return_value=response) as request:
            url = cloud_backend.save_image('unique.png', b'image', 'image/png')
        self.assertEqual(url, 'https://example.supabase.co/storage/v1/object/public/gallery-artworks/unique.png')
        self.assertNotIn('key', url)
        upload = request.call_args.args[0]
        self.assertEqual(upload.get_header('Authorization'), 'Bearer server-only-test-key')
        self.assertEqual(upload.get_header('Content-type'), 'image/png')
        self.assertEqual(upload.data, b'image')

    @patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co'})
    def test_missing_bucket_created_before_upload(self):
        error = HTTPError('https://example.supabase.co', 404, 'missing', {}, io.BytesIO())
        with patch('cloud_backend.storage_request', side_effect=[error, b'{}', b'{}']) as request:
            cloud_backend.save_image('unique.jpg', b'image', 'image/jpeg')
        self.assertEqual(request.call_args_list[1].args[0], 'bucket')
        self.assertIn(b'"public": true', request.call_args_list[1].args[1])
        self.assertEqual(request.call_args_list[2].args[0], 'object/gallery-artworks/unique.jpg')

    def test_storage_authentication_error_is_not_ignored(self):
        error = HTTPError('https://example.supabase.co', 401, 'invalid', {}, io.BytesIO())
        with patch('cloud_backend.storage_request', side_effect=error) as request:
            with self.assertRaises(HTTPError):
                cloud_backend.save_image('unique.jpg', b'image', 'image/jpeg')
        self.assertEqual(request.call_count, 1)
