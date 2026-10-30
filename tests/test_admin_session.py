import time
import unittest
from unittest.mock import patch
import server


class AdminSessionTest(unittest.TestCase):
    def test_expired_and_forged_sessions_cannot_reveal_admin_controls(self):
        expiry = int(time.time()) + 60
        value = str(expiry) + '.' + 'a' * 32
        cookie = server.ADMIN_COOKIE + '=' + value + '.' + server.admin_session_signature(value)
        self.assertEqual(server.admin_session_expiry(cookie), expiry)
        with patch('server.time.time', return_value=expiry):
            self.assertEqual(server.admin_session_expiry(cookie), 0)
        with patch.object(server, 'PASSWORD', 'rotated-password'):
            self.assertEqual(server.admin_session_expiry(cookie), 0)
        for invalid in ['', 'bad cookie', cookie.replace('a' * 32, 'b' * 32), cookie + 'extra']:
            self.assertEqual(server.admin_session_expiry(invalid), 0)

    def test_production_cookie_cannot_be_read_by_scripts_and_is_https_only(self):
        with patch.object(server, 'CLOUD', True):
            cookie = server.admin_cookie('test-token', 28800)
        for flag in ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']:
            self.assertIn(flag, cookie)
