CREATE TABLE public.ds_report_badges (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  hostname text NOT NULL,
  report_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (report_id)
    REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '30 days'),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

REVOKE ALL ON public.ds_report_badges FROM PUBLIC;
