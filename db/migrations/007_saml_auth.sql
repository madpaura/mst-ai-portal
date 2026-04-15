-- Migration 007: Add SAML/ADFS auth support
-- Run against existing database when enabling AUTH_MODE=saml

-- Track how each user account was created
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'local'
    CHECK (auth_provider IN ('local', 'saml', 'ldap'));

-- Store the SAML NameID (UPN/email from ADFS) for SLO support
-- Also used to match returning SAML users without relying solely on email
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS saml_name_id TEXT;

-- Index for fast SAML user lookup on login
CREATE INDEX IF NOT EXISTS idx_users_saml_name_id ON users (saml_name_id)
  WHERE saml_name_id IS NOT NULL;

-- Allow NULL password_hash for SAML-only accounts (no local password)
-- password_hash is already nullable in the schema (TEXT without NOT NULL) — no change needed.

COMMENT ON COLUMN users.auth_provider IS
  'local = username/password, saml = ADFS/SAML 2.0, ldap = LDAP bind';
COMMENT ON COLUMN users.saml_name_id IS
  'SAML NameID value (UPN or email) returned by ADFS in assertions';
