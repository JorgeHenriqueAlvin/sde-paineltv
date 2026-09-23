-- Remove the 50 MB bucket cap and the MIME allowlist.
-- Supabase account/plan storage limits still apply.
update storage.buckets
set file_size_limit = null,
    allowed_mime_types = null
where id = 'tv-media';
