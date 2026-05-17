"""Pytest configuration — prevents .env loading during unit tests."""
import os
import sys

# Point pydantic-settings away from the project .env so unit tests
# can import config-dependent modules without a real database.
os.environ.setdefault("DATABASE_URL", "postgresql://portal:Test1234!abc@localhost:5432/test_db")
os.environ.setdefault("JWT_SECRET", "TestSecret12345!abcdef")

# Ensure api/ is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
