-- Migration: Enable REPLICA IDENTITY FULL on enrollment tables for Supabase Realtime
-- Timestamp: 20260324063000
-- Purpose: Ensures UPDATE events on enrollment_tokens include full row data in payload.new

-- REPLICA IDENTITY FULL is required for Supabase Realtime to include all column values
-- in UPDATE event payloads (not just the primary key).
ALTER TABLE public.enrollment_tokens REPLICA IDENTITY FULL;
ALTER TABLE public.enrollment_results REPLICA IDENTITY FULL;
