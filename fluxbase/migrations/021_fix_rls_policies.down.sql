--
-- Migration: 021_fix_rls_policies.down.sql
-- Description: Revert RLS policy fixes - restore original PUBLIC role policies
-- Author: Wayli Migration System
-- Created: 2025-01-29
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- USER_PROFILES TABLE - Restore original policies from 006_rls_policies.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "User profiles can be viewed" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be inserted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be updated" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be deleted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "Service role full access to user_profiles" ON "public"."user_profiles";

CREATE POLICY "User profiles can be deleted" ON "public"."user_profiles" FOR DELETE USING (
    (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "id"
        )
        OR (
            (
                SELECT "auth"."role"() AS "role"
            ) = 'service_role'::"text"
        )
    )
);

CREATE POLICY "User profiles can be inserted" ON "public"."user_profiles" FOR
INSERT WITH CHECK (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );

CREATE POLICY "User profiles can be updated" ON "public"."user_profiles" FOR
UPDATE USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );

CREATE POLICY "User profiles can be viewed" ON "public"."user_profiles" FOR
SELECT USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );

-- =============================================================================
-- USER_PREFERENCES TABLE - Restore original policies from 006_rls_policies.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "User preferences can be viewed" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be inserted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be updated" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be deleted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "Service role full access to user_preferences" ON "public"."user_preferences";

CREATE POLICY "User preferences can be deleted" ON "public"."user_preferences" FOR DELETE USING (
    (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "id"
        )
        OR (
            (
                SELECT "auth"."role"() AS "role"
            ) = 'service_role'::"text"
        )
    )
);

CREATE POLICY "User preferences can be inserted" ON "public"."user_preferences" FOR
INSERT WITH CHECK (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );

CREATE POLICY "User preferences can be updated" ON "public"."user_preferences" FOR
UPDATE USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );

CREATE POLICY "User preferences can be viewed" ON "public"."user_preferences" FOR
SELECT USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );

-- =============================================================================
-- TRACKER_DATA TABLE - Restore original policies from 006_rls_policies.up.sql
-- Note: Admin policies from 018 are not affected
-- =============================================================================

DROP POLICY IF EXISTS "Users can view their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can insert their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can update their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can delete their own tracker data" ON "public"."tracker_data";

CREATE POLICY "Users can delete their own tracker data" ON "public"."tracker_data" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "user_id"
    )
);

CREATE POLICY "Users can insert their own tracker data" ON "public"."tracker_data" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

CREATE POLICY "Users can update their own tracker data" ON "public"."tracker_data" FOR
UPDATE USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

CREATE POLICY "Users can view their own tracker data" ON "public"."tracker_data" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

-- =============================================================================
-- TRIPS TABLE - Restore original policies from 006_rls_policies.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "Users can view their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can insert their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can update their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can delete their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Service role full access to trips" ON "public"."trips";

CREATE POLICY "Users can delete their own trips" ON "public"."trips" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "user_id"
    )
);

CREATE POLICY "Users can insert their own trips" ON "public"."trips" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

CREATE POLICY "Users can update their own trips" ON "public"."trips" FOR
UPDATE USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

CREATE POLICY "Users can view their own trips" ON "public"."trips" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

-- =============================================================================
-- WANT_TO_VISIT_PLACES TABLE - Restore original policies from 006_rls_policies.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "Users can view their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can insert their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can update their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can delete their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Service role full access to want_to_visit_places" ON "public"."want_to_visit_places";

CREATE POLICY "Users can delete their own want to visit places" ON "public"."want_to_visit_places" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "user_id"
    )
);

CREATE POLICY "Users can insert their own want to visit places" ON "public"."want_to_visit_places" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

CREATE POLICY "Users can update their own want to visit places" ON "public"."want_to_visit_places" FOR
UPDATE USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

CREATE POLICY "Users can view their own want to visit places" ON "public"."want_to_visit_places" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );

-- =============================================================================
-- POI_EMBEDDINGS TABLE - Restore original policies from 011_pgvector_rls.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "poi_embeddings_select_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_insert_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_update_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_delete_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "Service role full access to poi_embeddings" ON "public"."poi_embeddings";

CREATE POLICY "poi_embeddings_select_own" ON "public"."poi_embeddings"
FOR SELECT USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "poi_embeddings_insert_own" ON "public"."poi_embeddings"
FOR INSERT WITH CHECK (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "poi_embeddings_update_own" ON "public"."poi_embeddings"
FOR UPDATE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "poi_embeddings_delete_own" ON "public"."poi_embeddings"
FOR DELETE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

-- =============================================================================
-- TRIP_EMBEDDINGS TABLE - Restore original policies from 011_pgvector_rls.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "trip_embeddings_select_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_insert_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_update_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_delete_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "Service role full access to trip_embeddings" ON "public"."trip_embeddings";

CREATE POLICY "trip_embeddings_select_own" ON "public"."trip_embeddings"
FOR SELECT USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "trip_embeddings_insert_own" ON "public"."trip_embeddings"
FOR INSERT WITH CHECK (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "trip_embeddings_update_own" ON "public"."trip_embeddings"
FOR UPDATE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "trip_embeddings_delete_own" ON "public"."trip_embeddings"
FOR DELETE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

-- =============================================================================
-- USER_PREFERENCE_VECTORS TABLE - Restore original policies from 011_pgvector_rls.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "user_preference_vectors_select_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_insert_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_update_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_delete_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "Service role full access to user_preference_vectors" ON "public"."user_preference_vectors";

CREATE POLICY "user_preference_vectors_select_own" ON "public"."user_preference_vectors"
FOR SELECT USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "user_preference_vectors_insert_own" ON "public"."user_preference_vectors"
FOR INSERT WITH CHECK (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "user_preference_vectors_update_own" ON "public"."user_preference_vectors"
FOR UPDATE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "user_preference_vectors_delete_own" ON "public"."user_preference_vectors"
FOR DELETE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

-- =============================================================================
-- PLACE_VISITS TABLE - Restore original policies from 017_place_visits_incremental.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own place_visits" ON "public"."place_visits";
DROP POLICY IF EXISTS "Service role full access to place_visits" ON "public"."place_visits";
DROP POLICY IF EXISTS "Admin users full access to place_visits" ON "public"."place_visits";

CREATE POLICY "Users can view own place_visits"
    ON "public"."place_visits"
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Service role full access to place_visits"
    ON "public"."place_visits"
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admin users full access to place_visits"
    ON "public"."place_visits"
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'admin');

-- =============================================================================
-- PLACE_VISITS_STATE TABLE - Restore original policies from 017_place_visits_incremental.up.sql
-- =============================================================================

DROP POLICY IF EXISTS "Service role full access to place_visits_state" ON "public"."place_visits_state";
DROP POLICY IF EXISTS "Admin users full access to place_visits_state" ON "public"."place_visits_state";

CREATE POLICY "Service role full access to place_visits_state"
    ON "public"."place_visits_state"
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admin users full access to place_visits_state"
    ON "public"."place_visits_state"
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'admin');
