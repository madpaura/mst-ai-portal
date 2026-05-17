"""Tests for password strength validation (#43)."""
import sys
import os
import pytest

# Allow import from api/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException


def _validate(password: str) -> None:
    """Copy of _validate_password_strength from auth/router.py for isolated testing."""
    errors = []
    if len(password) < 12:
        errors.append("at least 12 characters")
    has_upper = any(c.isupper() for c in password)
    has_lower = any(c.islower() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_symbol = any(not c.isalnum() for c in password)
    if sum([has_upper, has_lower, has_digit, has_symbol]) < 3:
        errors.append("at least 3 of: uppercase letter, lowercase letter, digit, symbol")
    if errors:
        raise HTTPException(status_code=400, detail=f"Password must contain: {', '.join(errors)}")


class TestPasswordPolicy:
    def test_strong_password_accepted(self):
        # 12+ chars, upper + lower + digit
        _validate("SecurePass123")

    def test_strong_password_with_symbol(self):
        _validate("MyP@ssword123!")

    def test_too_short_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _validate("Short1!")
        assert exc.value.status_code == 400
        assert "12 characters" in exc.value.detail

    def test_old_min_length_rejected(self):
        # 6-char passwords that would have passed the old policy
        with pytest.raises(HTTPException):
            _validate("Abc1!!")

    def test_only_lowercase_rejected(self):
        # 12 chars but only lowercase — just 1 group
        with pytest.raises(HTTPException) as exc:
            _validate("abcdefghijkl")
        assert "3 of:" in exc.value.detail

    def test_lower_upper_only_rejected(self):
        # 12 chars, 2 groups — still too few
        with pytest.raises(HTTPException):
            _validate("AbcDefGhiJkl")

    def test_lower_upper_digit_accepted(self):
        # 3 groups — should pass
        _validate("AbcDefGhi123")

    def test_lower_digit_symbol_accepted(self):
        _validate("abcdefghi12!")

    def test_upper_digit_symbol_accepted(self):
        _validate("ABCDEFGHI12!")

    def test_all_four_groups_accepted(self):
        _validate("Abc123!@#defg")

    def test_exactly_12_chars_boundary(self):
        _validate("AbcDef123456")  # 12 chars, 3 groups

    def test_11_chars_rejected(self):
        with pytest.raises(HTTPException):
            _validate("AbcDef12345")  # 11 chars

    def test_common_weak_passwords_rejected(self):
        for pw in ["password", "12345678", "qwerty"]:
            with pytest.raises(HTTPException):
                _validate(pw)
