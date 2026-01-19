DROP POLICY IF EXISTS "Service role has full access to tracker_data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Admin users have full access to tracker_data" ON "public"."tracker_data";

-- Allow service role full access to tracker_data
CREATE POLICY "Service role has full access to tracker_data"
ON "public"."tracker_data"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow admin users full access to tracker_data
CREATE POLICY "Admin users have full access to tracker_data"
ON "public"."tracker_data"
FOR ALL
TO authenticated
USING (auth.jwt()->>'role' = 'admin')
WITH CHECK (auth.jwt()->>'role' = 'admin');
