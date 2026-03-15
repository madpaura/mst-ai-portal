-- Migration: Add video_banners table
-- Run this on an existing database to add banner support

CREATE TABLE IF NOT EXISTS video_banners (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE UNIQUE,
    variant         TEXT NOT NULL DEFAULT 'A' CHECK (variant IN ('A', 'B', 'C')),
    company_logo    TEXT NOT NULL DEFAULT 'SAMSUNG',
    series_tag      TEXT NOT NULL DEFAULT 'KNOWLEDGE SERIES',
    topic           TEXT NOT NULL DEFAULT 'Intro to AI Agents',
    subtopic        TEXT NOT NULL DEFAULT 'Environment Setup & First Run',
    episode         TEXT NOT NULL DEFAULT 'EP 01',
    duration        TEXT NOT NULL DEFAULT '3:15',
    presenter       TEXT NOT NULL DEFAULT 'Vishwa',
    presenter_initial TEXT NOT NULL DEFAULT 'V',
    status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'error')),
    banner_video_path TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
