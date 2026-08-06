-- pod-files lockdown -- 10b: privatize. Run AFTER the signed-URL app is deployed. Safe to re-run.
-- No destructive data clear: the app's classifier self-heals legacy public URLs (recovers the
-- object path and signs it), so old rows keep working and nothing is wiped.
update storage.buckets set public = false where id = 'pod-files';

-- VERIFY (expect public = false):
--   select id, public from storage.buckets where id = 'pod-files';
