-- Future scans use the complete currently available root-page profile.
-- Existing reports remain immutable and retain their original profile version.
UPDATE public.ds_domains
SET profile_version = 'domain-v1'
WHERE profile_version = 'transport-v1';
