import io
import os
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.error import HTTPError
import cloud_backend


class CloudAdapterTest(unittest.TestCase):
    def test_first_database_request_initializes_once_and_closes_sqlite_connections(self):
        import server
        connection = MagicMock()
        connection.__enter__.return_value = connection
        with patch.object(server, 'CLOUD', False), patch.object(server, '_schema_ready', False), \
                patch.object(server, 'connect_database', return_value=connection) as connect, \
                patch.object(server, 'initialize_database') as initialize:
            for _ in range(2):
                with server.database() as db:
                    self.assertIs(db, connection)
            self.assertEqual(connect.call_count, 2)
            initialize.assert_called_once_with(connection)
            self.assertEqual(connection.close.call_count, 2)

    def test_failed_first_transaction_does_not_mark_schema_ready(self):
        import server
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.__exit__.return_value = False
        with patch.object(server, 'CLOUD', False), patch.object(server, '_schema_ready', False), \
                patch.object(server, 'connect_database', return_value=connection), \
                patch.object(server, 'initialize_database') as initialize:
            with self.assertRaises(RuntimeError):
                with server.database():
                    raise RuntimeError('transaction failed')
            self.assertFalse(server._schema_ready)
            with server.database():
                pass
            self.assertTrue(server._schema_ready)
            self.assertEqual(initialize.call_count, 2)

    def test_schema_fast_path_checks_columns_and_privacy_in_one_query(self):
        rows = [{'relname': name, 'columns': list(columns), 'relrowsecurity': True, 'public_access': False}
                for name, columns in cloud_backend.SCHEMA_COLUMNS.items()]
        db = Mock()
        db.execute.return_value = rows
        self.assertTrue(cloud_backend.schema_ready(db))
        self.assertEqual(db.execute.call_count, 1)
        self.assertIn('has_table_privilege', db.execute.call_args.args[0])

        for change in [dict(columns=['id']), dict(relrowsecurity=False), dict(public_access=True)]:
            with self.subTest(change=change):
                db.execute.return_value = [dict(rows[0], **change), *rows[1:]]
                self.assertFalse(cloud_backend.schema_ready(db))
        db.execute.return_value = rows[:-1]
        self.assertFalse(cloud_backend.schema_ready(db))

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
