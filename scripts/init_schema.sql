-- TopickTube Production Schema for Supabase (PostgreSQL)
-- Run this in Supabase SQL Editor to initialize the database

-- Status enum type
DO $$ BEGIN
    CREATE TYPE status_enum AS ENUM ('queued', 'processing', 'done', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    youtube_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(500),
    status status_enum DEFAULT 'queued' NOT NULL,
    hash_version VARCHAR(64),
    overall_summary TEXT,
    issue_outline TEXT,
    video_summary TEXT,
    video_summary_status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_id);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    like_count INTEGER DEFAULT 0,
    published_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);

-- Clusters table
CREATE TABLE IF NOT EXISTS clusters (
    id SERIAL PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    summary TEXT,
    size INTEGER DEFAULT 0,
    ord_x FLOAT DEFAULT 0.0,
    ord_y FLOAT DEFAULT 0.0,
    stance VARCHAR(20),
    rep_comments_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_clusters_video_id ON clusters(video_id);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(100) PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    status status_enum DEFAULT 'queued' NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_videos_updated_at ON videos;
CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
