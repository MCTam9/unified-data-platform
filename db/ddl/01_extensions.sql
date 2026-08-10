-- ============================================================================
-- UNIFIED DATA PLATFORM — EXTENSIONS AND SCHEMAS
-- Illustrative demo. All data synthetic. Structure is a proposal.
-- ============================================================================

create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;  -- overlap exclusion on licences
create extension if not exists citext;
create extension if not exists vector;      -- document chunks (hybrid retrieval)

create schema if not exists core;
create schema if not exists reporting;
