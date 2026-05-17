"""Tests for email retry logic (#51)."""
import sys
import os
import smtplib
import pytest
from unittest.mock import patch, MagicMock

# Patch required env vars before importing config-dependent modules
os.environ.setdefault("DATABASE_URL", "postgresql://portal:Test1234!abc@localhost:5432/mst_portal")
os.environ.setdefault("JWT_SECRET", "TestSecret12345!abc")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from email_utils.utils import _send_smtp, _TRANSIENT_SMTP_ERRORS, _EMAIL_MAX_ATTEMPTS


def _make_cfg():
    return {
        "server": "localhost",
        "port": 25,
        "user": "",
        "password": "",
        "from_email": "test@example.com",
        "from_name": "Test",
    }


class TestEmailRetry:
    def test_success_on_first_attempt(self):
        cfg = _make_cfg()
        msg = MagicMock()
        msg.as_string.return_value = "raw email"

        with patch("email_utils.utils._make_smtp_connection") as mock_conn:
            server = MagicMock()
            mock_conn.return_value = server
            _send_smtp(cfg, msg, ["to@example.com"])

        mock_conn.assert_called_once()
        server.sendmail.assert_called_once()
        server.quit.assert_called_once()

    def test_retries_on_transient_error(self):
        cfg = _make_cfg()
        msg = MagicMock()
        msg.as_string.return_value = "raw email"

        server = MagicMock()
        server.sendmail.side_effect = [
            smtplib.SMTPServerDisconnected("connection lost"),
            smtplib.SMTPServerDisconnected("connection lost"),
            None,  # third attempt succeeds
        ]

        with patch("email_utils.utils._make_smtp_connection", return_value=server):
            with patch("time.sleep"):  # don't actually sleep in tests
                _send_smtp(cfg, msg, ["to@example.com"])

        assert server.sendmail.call_count == _EMAIL_MAX_ATTEMPTS

    def test_raises_after_max_attempts(self):
        cfg = _make_cfg()
        msg = MagicMock()
        msg.as_string.return_value = "raw email"

        server = MagicMock()
        server.sendmail.side_effect = smtplib.SMTPServerDisconnected("always fails")

        with patch("email_utils.utils._make_smtp_connection", return_value=server):
            with patch("time.sleep"):
                with pytest.raises(smtplib.SMTPServerDisconnected):
                    _send_smtp(cfg, msg, ["to@example.com"])

        assert server.sendmail.call_count == _EMAIL_MAX_ATTEMPTS

    def test_no_retry_on_non_transient_error(self):
        cfg = _make_cfg()
        msg = MagicMock()
        msg.as_string.return_value = "raw email"

        server = MagicMock()
        # SMTPRecipientsRefused is a permanent error — should not retry
        server.sendmail.side_effect = smtplib.SMTPRecipientsRefused({"bad@example.com": (550, b"User unknown")})

        with patch("email_utils.utils._make_smtp_connection", return_value=server):
            with pytest.raises(smtplib.SMTPRecipientsRefused):
                _send_smtp(cfg, msg, ["bad@example.com"])

        assert server.sendmail.call_count == 1  # only tried once

    def test_exponential_backoff_delays(self):
        cfg = _make_cfg()
        msg = MagicMock()
        msg.as_string.return_value = "raw email"

        server = MagicMock()
        server.sendmail.side_effect = [
            smtplib.SMTPConnectError(421, b"Service not available"),
            None,  # second attempt succeeds
        ]

        sleep_calls = []
        with patch("email_utils.utils._make_smtp_connection", return_value=server):
            with patch("time.sleep", side_effect=lambda s: sleep_calls.append(s)):
                _send_smtp(cfg, msg, ["to@example.com"])

        # First retry should sleep 2^1 = 2 seconds
        assert sleep_calls == [2]
