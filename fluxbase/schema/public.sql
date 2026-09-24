--
-- pgschema database dump
--

-- Dumped from database version PostgreSQL 18.3
-- Dumped by pgschema version 1.12.1


--
-- Name: country_name_aliases; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS country_name_aliases (
    name text,
    iso2 character(2) NOT NULL,
    CONSTRAINT country_name_aliases_pkey PRIMARY KEY (name)
);

--
-- Name: place_visits; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS place_visits (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    duration_minutes integer,
    location public.geometry(Point,4326),
    poi_name text,
    poi_layer text,
    poi_amenity text,
    poi_cuisine text,
    poi_sport text,
    poi_category text,
    confidence_score numeric(5,3),
    avg_distance_meters numeric(8,2),
    poi_tags jsonb,
    city text,
    country_code varchar(2),
    gps_points_count integer,
    visit_hour integer,
    visit_time_of_day text,
    day_of_week text,
    is_weekend boolean,
    duration_category text,
    poi_name_search tsvector,
    alt_poi_name text,
    alt_poi_amenity text,
    alt_poi_cuisine text,
    alt_poi_sport text,
    alt_poi_distance numeric(8,2),
    alt_poi_tags jsonb,
    alt_poi_confidence numeric(5,3),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT place_visits_pkey PRIMARY KEY (id),
    CONSTRAINT place_visits_unique_visit UNIQUE (user_id, started_at)
);


COMMENT ON TABLE place_visits IS 'Detected POI visits using dual-source detection. Updated incrementally.';


COMMENT ON COLUMN place_visits.poi_tags IS '{"_fluxbase_jsonb_schema": {"type": "object", "description": "OpenStreetMap tags for the POI", "properties": {"osm": {"type": "object", "description": "OpenStreetMap-specific tags", "properties": {"amenity": {"type": "string", "description": "Type of amenity (e.g., restaurant, cafe, bar)"}, "cuisine": {"type": "string", "description": "Cuisine type (e.g., japanese, italian, vietnamese)"}, "name": {"type": "string", "description": "Name of the place"}, "outdoor_seating": {"type": "boolean", "description": "Has outdoor seating"}, "internet_access": {"type": "string", "description": "Internet access type (yes, wlan, no)"}, "wifi": {"type": "string", "description": "WiFi availability"}, "wheelchair": {"type": "string", "description": "Wheelchair accessibility (yes, limited, no)"}, "takeaway": {"type": "string", "description": "Takeaway option (yes, only, no)"}, "delivery": {"type": "string", "description": "Delivery service (yes, no)"}, "smoking": {"type": "string", "description": "Smoking policy (yes, outside, separated, no)"}, "air_conditioning": {"type": "string", "description": "Air conditioning (yes, no)"}, "leisure": {"type": "string", "description": "Leisure type (e.g., park, sports_centre)"}, "tourism": {"type": "string", "description": "Tourism type (e.g., hotel, museum)"}, "shop": {"type": "string", "description": "Shop type (e.g., supermarket, convenience)"}, "sport": {"type": "string", "description": "Sport type (e.g., tennis, swimming)"}}}}}}';

--
-- Name: place_visits_location_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_location_idx ON place_visits USING gist (location);

--
-- Name: place_visits_poi_category_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_poi_category_idx ON place_visits (poi_category);

--
-- Name: place_visits_poi_name_search_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_poi_name_search_idx ON place_visits USING gin (poi_name_search);

--
-- Name: place_visits_started_at_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_started_at_idx ON place_visits (started_at DESC);

--
-- Name: place_visits_user_id_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_user_id_idx ON place_visits (user_id);

--
-- Name: place_visits_user_started_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_user_started_idx ON place_visits (user_id, started_at DESC);

--
-- Name: place_visits; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE place_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: place_visits; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE place_visits FORCE ROW LEVEL SECURITY;

--
-- Name: Admin users full access to place_visits; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users full access to place_visits" ON place_visits TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role full access to place_visits; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to place_visits" ON place_visits TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to place_visits; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to place_visits" ON place_visits TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can view own place_visits; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can view own place_visits" ON place_visits FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: place_visits_state; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS place_visits_state (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    user_id uuid,
    last_processed_at timestamptz,
    last_full_refresh_at timestamptz,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT place_visits_state_pkey PRIMARY KEY (id),
    CONSTRAINT place_visits_state_user_unique UNIQUE (user_id)
);


COMMENT ON TABLE place_visits_state IS 'Tracks incremental refresh state for place_visits - per user and global';


COMMENT ON COLUMN place_visits_state.user_id IS 'User ID for per-user tracking, NULL for global state';

--
-- Name: place_visits_state_user_id_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS place_visits_state_user_id_idx ON place_visits_state (user_id);

--
-- Name: place_visits_state; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE place_visits_state ENABLE ROW LEVEL SECURITY;

--
-- Name: place_visits_state; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE place_visits_state FORCE ROW LEVEL SECURITY;

--
-- Name: Admin users full access to place_visits_state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users full access to place_visits_state" ON place_visits_state TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role full access to place_visits_state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to place_visits_state" ON place_visits_state TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to place_visits_state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to place_visits_state" ON place_visits_state TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: poi_embeddings; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS poi_embeddings (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    poi_name text NOT NULL,
    poi_amenity text,
    poi_category text,
    city text,
    country_code varchar(2),
    embedding public.vector(1536),
    source_text text,
    poi_cuisine text,
    poi_sport text,
    visit_count integer DEFAULT 0,
    avg_duration_minutes integer DEFAULT 0,
    embedded_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT poi_embeddings_pkey PRIMARY KEY (id),
    CONSTRAINT poi_embeddings_unique UNIQUE (user_id, poi_name, city, country_code)
);


COMMENT ON TABLE poi_embeddings IS 'DEPRECATED: Use knowledge base "wayli-pois" instead. This table is kept for backwards compatibility and will not be removed. New installations should use the Fluxbase knowledge base feature.';


COMMENT ON COLUMN poi_embeddings.embedding IS 'Vector embedding (1536 dimensions) for semantic search. Generated from source_text using text-embedding-3-small model.';


COMMENT ON COLUMN poi_embeddings.source_text IS 'Text used to generate the embedding. Format: "POI Name. Type: X. Category: Y. Cuisine: Z. City: C, Country: CC"';


COMMENT ON COLUMN poi_embeddings.embedded_at IS 'When the embedding was last generated. NULL if not yet embedded.';

--
-- Name: idx_poi_embeddings_amenity; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_amenity ON poi_embeddings (poi_amenity);

--
-- Name: idx_poi_embeddings_category; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_category ON poi_embeddings (poi_category);

--
-- Name: idx_poi_embeddings_city; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_city ON poi_embeddings (city);

--
-- Name: idx_poi_embeddings_country; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_country ON poi_embeddings (country_code);

--
-- Name: idx_poi_embeddings_cuisine; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_cuisine ON poi_embeddings (poi_cuisine);

--
-- Name: idx_poi_embeddings_not_embedded; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_not_embedded ON poi_embeddings (user_id) WHERE (embedded_at IS NULL);

--
-- Name: idx_poi_embeddings_user_category; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_user_category ON poi_embeddings (user_id, poi_category);

--
-- Name: idx_poi_embeddings_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_user_id ON poi_embeddings (user_id);

--
-- Name: idx_poi_embeddings_vector_hnsw; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_poi_embeddings_vector_hnsw ON poi_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);


COMMENT ON INDEX idx_poi_embeddings_vector_hnsw IS 'HNSW index for fast approximate nearest neighbor search on POI embeddings. m=16 for good recall/speed balance, ef_construction=64 for build quality.';

--
-- Name: poi_embeddings; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE poi_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to poi_embeddings; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to poi_embeddings" ON poi_embeddings TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to poi_embeddings; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to poi_embeddings" ON poi_embeddings TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: poi_embeddings_delete_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY poi_embeddings_delete_own ON poi_embeddings FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: poi_embeddings_insert_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY poi_embeddings_insert_own ON poi_embeddings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: poi_embeddings_select_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY poi_embeddings_select_own ON poi_embeddings FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: poi_embeddings_update_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY poi_embeddings_update_own ON poi_embeddings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: tracker_daily_activity; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS tracker_daily_activity (
    user_id uuid,
    day date,
    distance numeric(12,2) DEFAULT 0,
    time_spent numeric(12,2) DEFAULT 0,
    points integer DEFAULT 0,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT tracker_daily_activity_pkey PRIMARY KEY (user_id, day)
);


COMMENT ON TABLE tracker_daily_activity IS 'Cached per-day distance/time/point-count aggregates from tracker_data. Refreshed incrementally by the refresh-daily-activity job. The activity_calendar RPC reads this instead of aggregating tracker_data live.';

--
-- Name: idx_tracker_daily_activity_user_day; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_daily_activity_user_day ON tracker_daily_activity (user_id, day);

--
-- Name: tracker_daily_activity; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE tracker_daily_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: Admin users have full access to daily activity; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users have full access to daily activity" ON tracker_daily_activity TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role has full access to daily activity; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to daily activity" ON tracker_daily_activity TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to daily activity; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to daily activity" ON tracker_daily_activity TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can read own daily activity; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can read own daily activity" ON tracker_daily_activity FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can update own daily activity; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can update own daily activity" ON tracker_daily_activity FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can write own daily activity; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can write own daily activity" ON tracker_daily_activity FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: visited_countries; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS visited_countries (
    user_id uuid NOT NULL,
    country_code varchar(2) NOT NULL,
    first_visit timestamptz,
    last_visit timestamptz,
    visits integer DEFAULT 0,
    total_stay_hours numeric(12,2) DEFAULT 0,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT visited_countries_pkey PRIMARY KEY (user_id, country_code)
);


COMMENT ON TABLE visited_countries IS 'Cached per-country presence aggregates from tracker_data: countries where the user dwelled at least one continuous hour (24h gap splits stays), so flyovers and transit corridors are excluded. Recomputed wholesale by the refresh-daily-activity job (refresh-visited-countries-sql RPC); the visited-countries RPC reads this for the "Where I''ve been" map instead of aggregating tracker_data live.';

--
-- Name: idx_visited_countries_user; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visited_countries_user ON visited_countries (user_id);

--
-- Name: visited_countries; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE visited_countries ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role has full access to visited countries; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to visited countries" ON visited_countries TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to visited countries; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to visited countries" ON visited_countries TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can read own visited countries; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can read own visited countries" ON visited_countries FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can write own visited countries; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can write own visited countries" ON visited_countries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can delete own visited countries; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can delete own visited countries" ON visited_countries FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: tracker_daily_activity_state; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS tracker_daily_activity_state (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    user_id uuid,
    last_processed_at timestamptz,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT tracker_daily_activity_state_pkey PRIMARY KEY (id),
    CONSTRAINT tracker_daily_activity_state_user_unique UNIQUE (user_id)
);


COMMENT ON TABLE tracker_daily_activity_state IS 'Incremental watermark for the refresh-daily-activity job. last_processed_at is the cutoff up to which days have been aggregated.';

--
-- Name: tracker_daily_activity_state_user_id_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS tracker_daily_activity_state_user_id_idx ON tracker_daily_activity_state (user_id);

--
-- Name: tracker_daily_activity_state; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE tracker_daily_activity_state ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role has full access to daily activity state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to daily activity state" ON tracker_daily_activity_state TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to daily activity state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to daily activity state" ON tracker_daily_activity_state TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can read own daily activity state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can read own daily activity state" ON tracker_daily_activity_state FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can update own daily activity state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can update own daily activity state" ON tracker_daily_activity_state FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can write own daily activity state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can write own daily activity state" ON tracker_daily_activity_state FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: tracker_data; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS tracker_data (
    user_id uuid,
    tracker_type text NOT NULL,
    device_id text,
    recorded_at timestamptz,
    location public.geometry(Point,4326),
    country_code varchar(2),
    altitude numeric(8,2),
    accuracy numeric(8,2),
    speed numeric(12,2),
    distance numeric(12,2),
    time_spent numeric(12,2),
    heading numeric(5,2),
    battery_level integer,
    is_charging boolean,
    activity_type text,
    geocode jsonb,
    tz_diff numeric(4,1),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    transport_mode text,
    detection_reason text,
    transport_mode_confidence numeric(4,3),
    transport_mode_manual boolean DEFAULT false NOT NULL,
    CONSTRAINT tracker_data_pkey PRIMARY KEY (user_id, recorded_at),
    CONSTRAINT tracker_data_plausible_speed CHECK (speed IS NULL OR speed >= 0::numeric AND speed <= 1000::numeric),
    CONSTRAINT tracker_data_positive_accuracy CHECK (accuracy IS NULL OR accuracy >= 0::numeric),
    CONSTRAINT tracker_data_valid_battery CHECK (battery_level IS NULL OR battery_level >= 0 AND battery_level <= 100),
    CONSTRAINT tracker_data_valid_heading CHECK (heading IS NULL OR heading >= 0::numeric AND heading < 360::numeric)
);


COMMENT ON COLUMN tracker_data.distance IS 'Distance in meters from the previous chronological point for this user';


COMMENT ON COLUMN tracker_data.time_spent IS 'Time spent in seconds from the previous chronological point for this user';


COMMENT ON COLUMN tracker_data.tz_diff IS 'Timezone difference from UTC in hours (e.g., +2.0 for UTC+2, -5.0 for UTC-5)';


COMMENT ON COLUMN tracker_data.transport_mode IS 'Detected transport mode: stationary|walking|cycling|car|train|airplane. NULL when not yet processed by the detect-transport-mode job.';


COMMENT ON COLUMN tracker_data.detection_reason IS 'Machine-readable reason key for the detected transport_mode (see TransportDetectionReason labels in the UI).';


COMMENT ON COLUMN tracker_data.transport_mode_confidence IS 'HMM emission confidence in [0,1] for the detected transport_mode.';


COMMENT ON COLUMN tracker_data.transport_mode_manual IS 'true when transport_mode was set manually by the user (the detect-transport-mode job must not overwrite these rows).';

--
-- Name: idx_tracker_data_device_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_device_id ON tracker_data (device_id);

--
-- Name: idx_tracker_data_geocode; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_geocode ON tracker_data USING gin (geocode);


COMMENT ON INDEX idx_tracker_data_geocode IS 'Optimizes JSONB geocode searches using GIN index';

--
-- Name: idx_tracker_data_location; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_location ON tracker_data USING gist (location);

--
-- Name: idx_tracker_data_timestamp; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_timestamp ON tracker_data (recorded_at);

--
-- Name: idx_tracker_data_transport_mode; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_transport_mode ON tracker_data (user_id, transport_mode) WHERE (transport_mode IS NOT NULL);

--
-- Name: idx_tracker_data_tz_diff; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_tz_diff ON tracker_data (tz_diff);

--
-- Name: idx_tracker_data_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_user_id ON tracker_data (user_id);

--
-- Name: idx_tracker_data_user_timestamp_distance; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_user_timestamp_distance ON tracker_data (user_id, recorded_at) WHERE (distance IS NULL) OR (distance = (0)::numeric);


COMMENT ON INDEX idx_tracker_data_user_timestamp_distance IS 'Optimizes finding records that need distance calculation';

--
-- Name: idx_tracker_data_user_timestamp_location; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_user_timestamp_location ON tracker_data (user_id, recorded_at) WHERE (location IS NOT NULL);


COMMENT ON INDEX idx_tracker_data_user_timestamp_location IS 'Optimizes distance calculation queries by user and timestamp with location filter';

--
-- Name: idx_tracker_data_user_timestamp_ordered; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_user_timestamp_ordered ON tracker_data (user_id, recorded_at, location) WHERE (location IS NOT NULL);


COMMENT ON INDEX idx_tracker_data_user_timestamp_ordered IS 'Optimizes LAG window function performance for distance calculations';

--
-- Name: idx_tracker_data_user_country_time; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tracker_data_user_country_time
  ON tracker_data (user_id, country_code, recorded_at)
  WHERE location IS NOT NULL AND country_code IS NOT NULL;

COMMENT ON INDEX idx_tracker_data_user_country_time IS 'Serves the visited-countries dwell aggregation (refresh-visited-countries-sql RPC): per-country ordered scans of the user''s points.';

--
-- Name: tracker_data; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE tracker_data ENABLE ROW LEVEL SECURITY;

--
-- Name: Admin users have full access to tracker_data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users have full access to tracker_data" ON tracker_data TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role has full access to tracker_data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to tracker_data" ON tracker_data TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to tracker_data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to tracker_data" ON tracker_data TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can delete their own tracker data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can delete their own tracker data" ON tracker_data FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can insert their own tracker data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can insert their own tracker data" ON tracker_data FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can update their own tracker data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can update their own tracker data" ON tracker_data FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can view their own tracker data; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can view their own tracker data" ON tracker_data FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: fitness_activities; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS fitness_activities (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    title text,
    description text,
    sport text,
    sub_sport text,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    total_distance_m numeric(12,2),
    elapsed_time_s numeric(12,2),
    moving_time_s numeric(12,2),
    avg_heartrate integer,
    max_heartrate integer,
    avg_power integer,
    max_power integer,
    avg_cadence integer,
    calories integer,
    manufacturer text,
    product text,
    serial_number text,
    source_file text,
    visibility text,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT fitness_activities_pkey PRIMARY KEY (id),
    CONSTRAINT fitness_activities_user_started_key UNIQUE (user_id, started_at),
    CONSTRAINT fitness_activities_time_order CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT fitness_activities_visibility_check CHECK (visibility IS NULL OR visibility IN ('private'::text, 'friends'::text, 'public'::text)),
    CONSTRAINT fitness_activities_valid_heartrate CHECK (avg_heartrate IS NULL OR avg_heartrate >= 0 AND avg_heartrate <= 255),
    CONSTRAINT fitness_activities_valid_max_heartrate CHECK (max_heartrate IS NULL OR max_heartrate >= 0 AND max_heartrate <= 255),
    CONSTRAINT fitness_activities_valid_power CHECK (avg_power IS NULL OR avg_power >= 0 AND avg_power <= 65535),
    CONSTRAINT fitness_activities_valid_max_power CHECK (max_power IS NULL OR max_power >= 0 AND max_power <= 65535),
    CONSTRAINT fitness_activities_valid_cadence CHECK (avg_cadence IS NULL OR avg_cadence >= 0 AND avg_cadence <= 255),
    CONSTRAINT fitness_activities_valid_calories CHECK (calories IS NULL OR calories >= 0),
    CONSTRAINT fitness_activities_valid_distance CHECK (total_distance_m IS NULL OR total_distance_m >= 0::numeric),
    CONSTRAINT fitness_activities_valid_elapsed CHECK (elapsed_time_s IS NULL OR elapsed_time_s >= 0::numeric),
    CONSTRAINT fitness_activities_valid_moving CHECK (moving_time_s IS NULL OR moving_time_s >= 0::numeric)
);


COMMENT ON TABLE fitness_activities IS 'Fitness activity sessions imported from .fit files (beta). GPS points live in tracker_data; this table holds the session summary decoded from the FIT session message.';


COMMENT ON COLUMN fitness_activities.title IS 'User-defined activity name; NULL falls back to sport + date in the UI';


COMMENT ON COLUMN fitness_activities.description IS 'User-defined comment/notes for the activity';


COMMENT ON COLUMN fitness_activities.sport IS 'FIT sport mapped to a lowercase slug (e.g. cycling, running); fitness when unmappable';


COMMENT ON COLUMN fitness_activities.sub_sport IS 'FIT sub_sport mapped to a lowercase slug (e.g. road, mountain, gravel)';


COMMENT ON COLUMN fitness_activities.total_distance_m IS 'Total distance in meters from the FIT session message';


COMMENT ON COLUMN fitness_activities.elapsed_time_s IS 'Total elapsed time in seconds from the FIT session message';


COMMENT ON COLUMN fitness_activities.moving_time_s IS 'Timer (moving) time in seconds from the FIT session message';

COMMENT ON COLUMN fitness_activities.visibility IS 'Sharing audience override: private, friends, or public. NULL inherits the user''s global fitness_sharing.default preference (resolved by effective_activity_visibility()).';

--
-- Name: fitness_records; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS fitness_records (
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL,
    heart_rate integer,
    cadence integer,
    power integer,
    temperature integer,
    cumulative_distance_m numeric(12,2),
    created_at timestamptz DEFAULT now(),
    CONSTRAINT fitness_records_pkey PRIMARY KEY (activity_id, recorded_at),
    CONSTRAINT fitness_records_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES fitness_activities (id) ON DELETE CASCADE,
    CONSTRAINT fitness_records_valid_heartrate CHECK (heart_rate IS NULL OR heart_rate >= 0 AND heart_rate <= 255),
    CONSTRAINT fitness_records_valid_cadence CHECK (cadence IS NULL OR cadence >= 0 AND cadence <= 255),
    CONSTRAINT fitness_records_valid_power CHECK (power IS NULL OR power >= 0 AND power <= 65535),
    CONSTRAINT fitness_records_valid_temperature CHECK (temperature IS NULL OR temperature >= -100 AND temperature <= 100),
    CONSTRAINT fitness_records_valid_distance CHECK (cumulative_distance_m IS NULL OR cumulative_distance_m >= 0::numeric)
);


COMMENT ON TABLE fitness_records IS 'Per-point fitness metrics (heart rate, cadence, power, temperature) for a fitness activity, one row per FIT record. Joins tracker_data by recorded_at within the activity time range.';


COMMENT ON COLUMN fitness_records.cumulative_distance_m IS 'Cumulative distance in meters since activity start, as reported by the device';

--
-- Name: idx_fitness_records_user_recorded; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fitness_records_user_recorded ON fitness_records (user_id, recorded_at);

--
-- Name: fitness_activities; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE fitness_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: Admin users have full access to fitness_activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users have full access to fitness_activities" ON fitness_activities TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role has full access to fitness_activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to fitness_activities" ON fitness_activities TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to fitness_activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to fitness_activities" ON fitness_activities TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can delete their own fitness activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can delete their own fitness activities" ON fitness_activities FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can insert their own fitness activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can insert their own fitness activities" ON fitness_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can update their own fitness activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can update their own fitness activities" ON fitness_activities FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can view their own fitness activities; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can view their own fitness activities" ON fitness_activities FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: fitness_records; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE fitness_records ENABLE ROW LEVEL SECURITY;

--
-- Name: Admin users have full access to fitness_records; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users have full access to fitness_records" ON fitness_records TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role has full access to fitness_records; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to fitness_records" ON fitness_records TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to fitness_records; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to fitness_records" ON fitness_records TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can delete their own fitness records; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can delete their own fitness records" ON fitness_records FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can insert their own fitness records; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can insert their own fitness records" ON fitness_records FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can view their own fitness records; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can view their own fitness records" ON fitness_records FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: transport_mode_state; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS transport_mode_state (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    user_id uuid,
    last_processed_at timestamptz,
    detector_version integer DEFAULT 1,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT transport_mode_state_pkey PRIMARY KEY (id),
    CONSTRAINT transport_mode_state_user_unique UNIQUE (user_id)
);


COMMENT ON TABLE transport_mode_state IS 'Incremental watermark for the detect-transport-mode job. last_processed_at is exclusive; the job resumes from last_processed_at - LOOKBACK (1h) to re-decode the tail of the previous segment. detector_version records which DETECTOR_VERSION produced the current labels; a stored version older than the job''s constant triggers a one-time full re-decode (3 years) so improved detection logic relabels history.';

--
-- Name: transport_mode_state_user_id_idx; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS transport_mode_state_user_id_idx ON transport_mode_state (user_id);

--
-- Name: transport_mode_state; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE transport_mode_state ENABLE ROW LEVEL SECURITY;

--
-- Name: Admin users have full access to transport_mode_state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Admin users have full access to transport_mode_state" ON transport_mode_state TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

--
-- Name: Service role has full access to transport_mode_state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role has full access to transport_mode_state" ON transport_mode_state TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to transport_mode_state; Type: POLICY; Schema: -; Owner: -
--
-- The detect-transport-mode job runs as tenant_service; without this policy
-- its watermark upsert violated RLS, so the table stayed empty and every run
-- re-decoded each user's full window from scratch.
--

CREATE POLICY "Tenant service full access to transport_mode_state" ON transport_mode_state TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can read own transport_mode_state; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can read own transport_mode_state" ON transport_mode_state FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: trips; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trips (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid,
    title text NOT NULL,
    description text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    image_url text,
    labels text[] DEFAULT '{}',
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    visibility text DEFAULT 'private',
    budget_total numeric(10,2),
    budget_currency text DEFAULT 'EUR',
    costs_visible_to text DEFAULT 'private',
    gps_visible_to text DEFAULT 'private',
    comments_allowed text DEFAULT 'friends',
    plan_visible_to text DEFAULT 'private',
    CONSTRAINT trips_pkey PRIMARY KEY (id),
    CONSTRAINT trips_comments_allowed_check CHECK (comments_allowed IN ('owner'::text, 'friends'::text, 'public'::text)),
    CONSTRAINT trips_costs_visible_to_check CHECK (costs_visible_to IN ('private'::text, 'friends'::text, 'public'::text)),
    CONSTRAINT trips_gps_visible_to_check CHECK (gps_visible_to IN ('private'::text, 'friends'::text, 'public'::text)),
    CONSTRAINT trips_plan_visible_to_check CHECK (plan_visible_to IN ('private'::text, 'friends'::text, 'public'::text)),
    CONSTRAINT trips_status_check CHECK (status IN ('active'::text, 'planned'::text, 'completed'::text, 'cancelled'::text, 'pending'::text, 'rejected'::text)),
    CONSTRAINT trips_valid_dates CHECK (end_date >= start_date),
    CONSTRAINT trips_visibility_check CHECK (visibility IN ('private'::text, 'friends'::text, 'public'::text, 'unlisted'::text))
);


COMMENT ON COLUMN trips.status IS 'Trip status: active, planned, completed, cancelled, pending (suggested), rejected';


COMMENT ON COLUMN trips.labels IS 'Array of labels including "suggested" for trips created from suggestions';


COMMENT ON COLUMN trips.metadata IS 'Trip metadata including dataPoints, visitedCities, visitedCountries, etc.';


COMMENT ON COLUMN trips.visibility IS 'private (default), public (anyone can view), or unlisted (owner only).';

--
-- Name: idx_trips_date_range; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trips_date_range ON trips (user_id, start_date, end_date);


COMMENT ON INDEX idx_trips_date_range IS 'Optimizes trip date range queries for a specific user';

--
-- Name: idx_trips_end_date; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trips_end_date ON trips (end_date);

--
-- Name: idx_trips_metadata; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trips_metadata ON trips USING gin (metadata);


COMMENT ON INDEX idx_trips_metadata IS 'Optimizes JSONB metadata searches using GIN index';

--
-- Name: idx_trips_start_date; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trips_start_date ON trips (start_date);

--
-- Name: idx_trips_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips (user_id);

--
-- Name: trips; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to trips; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to trips" ON trips TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to trips; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to trips" ON trips TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can delete their own trips; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can delete their own trips" ON trips FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can insert their own trips; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can insert their own trips" ON trips FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can update their own trips; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can update their own trips" ON trips FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: trip_collaborators; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_collaborators (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'editor',
    created_at timestamptz DEFAULT now(),
    CONSTRAINT trip_collaborators_pkey PRIMARY KEY (id),
    CONSTRAINT trip_collaborators_trip_id_user_id_key UNIQUE (trip_id, user_id),
    CONSTRAINT trip_collaborators_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
);

--
-- Name: trip_collaborators; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_collaborators ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_embeddings; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_embeddings (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    trip_id uuid NOT NULL,
    embedding public.vector(1536),
    source_text text,
    embedded_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT trip_embeddings_pkey PRIMARY KEY (id),
    CONSTRAINT trip_embeddings_unique UNIQUE (trip_id),
    CONSTRAINT trip_embeddings_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
);


COMMENT ON TABLE trip_embeddings IS 'DEPRECATED: Use knowledge base "wayli-trips" instead. This table is kept for backwards compatibility and will not be removed. New installations should use the Fluxbase knowledge base feature.';


COMMENT ON COLUMN trip_embeddings.source_text IS 'Text used to generate the embedding. Format: "Trip Title. Description. Cities: X. Countries: Y. Labels: Z"';

--
-- Name: idx_trip_embeddings_not_embedded; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_embeddings_not_embedded ON trip_embeddings (user_id) WHERE (embedded_at IS NULL);

--
-- Name: idx_trip_embeddings_trip_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_embeddings_trip_id ON trip_embeddings (trip_id);

--
-- Name: idx_trip_embeddings_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_embeddings_user_id ON trip_embeddings (user_id);

--
-- Name: idx_trip_embeddings_vector_hnsw; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_embeddings_vector_hnsw ON trip_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);


COMMENT ON INDEX idx_trip_embeddings_vector_hnsw IS 'HNSW index for fast approximate nearest neighbor search on trip embeddings.';

--
-- Name: trip_embeddings; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to trip_embeddings; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to trip_embeddings" ON trip_embeddings TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to trip_embeddings; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to trip_embeddings" ON trip_embeddings TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: trip_embeddings_delete_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_embeddings_delete_own ON trip_embeddings FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: trip_embeddings_insert_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_embeddings_insert_own ON trip_embeddings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: trip_embeddings_select_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_embeddings_select_own ON trip_embeddings FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: trip_embeddings_update_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_embeddings_update_own ON trip_embeddings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: trip_gps_tracks; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_gps_tracks (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    points jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT trip_gps_tracks_pkey PRIMARY KEY (id),
    CONSTRAINT trip_gps_tracks_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
);

--
-- Name: trip_gps_tracks; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_gps_tracks ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_gps_tracks_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_gps_tracks_delete ON trip_gps_tracks FOR DELETE TO PUBLIC USING (user_id = auth.uid());

--
-- Name: trip_gps_tracks_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_gps_tracks_insert ON trip_gps_tracks FOR INSERT TO PUBLIC WITH CHECK (user_id = auth.uid());

--
-- Name: trip_shares; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_shares (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    shared_with_user_id uuid NOT NULL,
    role text DEFAULT 'viewer',
    created_at timestamptz DEFAULT now(),
    CONSTRAINT trip_shares_pkey PRIMARY KEY (id),
    CONSTRAINT trip_shares_trip_id_shared_with_user_id_key UNIQUE (trip_id, shared_with_user_id),
    CONSTRAINT trip_shares_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
    CONSTRAINT trip_shares_role_check CHECK (role IN ('viewer'::text, 'editor'::text))
);

--
-- Name: trip_shares; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: user_connections; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS user_connections (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    status text DEFAULT 'pending',
    created_at timestamptz DEFAULT now(),
    CONSTRAINT user_connections_pkey PRIMARY KEY (id),
    CONSTRAINT user_connections_user_id_friend_id_key UNIQUE (user_id, friend_id),
    CONSTRAINT user_connections_status_check CHECK (status IN ('pending'::text, 'accepted'::text, 'blocked'::text))
);

--
-- Name: user_connections; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE user_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: user_connections_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_connections_delete ON user_connections FOR DELETE TO PUBLIC USING ((user_id = auth.uid()) OR (friend_id = auth.uid()));

--
-- Name: user_connections_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_connections_insert ON user_connections FOR INSERT TO PUBLIC WITH CHECK (user_id = auth.uid());

--
-- Name: user_connections_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_connections_select ON user_connections FOR SELECT TO PUBLIC USING ((user_id = auth.uid()) OR (friend_id = auth.uid()));

--
-- Name: user_connections_update; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_connections_update ON user_connections FOR UPDATE TO PUBLIC USING (friend_id = auth.uid());

--
-- Name: user_data_sampling; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS user_data_sampling (
    user_id uuid,
    enabled boolean DEFAULT false NOT NULL,
    min_distance_m integer DEFAULT 25 NOT NULL,
    min_time_s integer DEFAULT 60 NOT NULL,
    last_run_at timestamptz,
    last_deleted integer DEFAULT 0,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT user_data_sampling_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_data_sampling_min_distance_m_check CHECK (min_distance_m >= 0 AND min_distance_m <= 5000),
    CONSTRAINT user_data_sampling_min_time_s_check CHECK (min_time_s >= 0 AND min_time_s <= 3600)
);

--
-- Name: user_data_sampling; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE user_data_sampling ENABLE ROW LEVEL SECURITY;

--
-- Name: user_data_sampling_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_data_sampling_delete ON user_data_sampling FOR DELETE TO PUBLIC USING (user_id = auth.uid());

--
-- Name: user_data_sampling_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_data_sampling_select ON user_data_sampling FOR SELECT TO PUBLIC USING (user_id = auth.uid());

--
-- Name: user_data_sampling_update; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_data_sampling_update ON user_data_sampling FOR UPDATE TO PUBLIC USING (user_id = auth.uid());

--
-- Name: user_data_sampling_upsert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_data_sampling_upsert ON user_data_sampling FOR INSERT TO PUBLIC WITH CHECK (user_id = auth.uid());

--
-- Name: user_preference_vectors; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS user_preference_vectors (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    preference_type text NOT NULL,
    preference_embedding public.vector(1536),
    top_items jsonb,
    confidence_score numeric(4,3),
    sample_count integer DEFAULT 0,
    computed_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT user_preference_vectors_pkey PRIMARY KEY (id),
    CONSTRAINT user_preference_vectors_unique UNIQUE (user_id, preference_type),
    CONSTRAINT user_preference_vectors_type_check CHECK (preference_type IN ('cuisine'::text, 'poi_category'::text, 'travel_style'::text, 'time_of_day'::text, 'overall'::text))
);


COMMENT ON TABLE user_preference_vectors IS 'DEPRECATED: Use user_preferences table instead. This table is kept for backwards compatibility and will not be removed. New installations should use the simpler user_preferences table with array fields.';


COMMENT ON COLUMN user_preference_vectors.preference_type IS 'Type of preference: cuisine (food preferences), poi_category (activity preferences), travel_style (adventure vs relaxation), time_of_day (morning/evening person), overall (general preferences)';


COMMENT ON COLUMN user_preference_vectors.top_items IS 'JSON object with top items for this preference type. Example: {"japanese": 15, "italian": 12, "vietnamese": 8}';


COMMENT ON COLUMN user_preference_vectors.confidence_score IS 'Confidence in the preference vector (0.000 - 1.000). Higher values indicate more data points.';


COMMENT ON COLUMN user_preference_vectors.sample_count IS 'Number of data points (visits/trips) used to compute this preference public.vector.';

--
-- Name: idx_user_preference_vectors_type; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preference_vectors_type ON user_preference_vectors (preference_type);

--
-- Name: idx_user_preference_vectors_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preference_vectors_user_id ON user_preference_vectors (user_id);

--
-- Name: idx_user_preference_vectors_user_type; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preference_vectors_user_type ON user_preference_vectors (user_id, preference_type);

--
-- Name: idx_user_preference_vectors_vector_hnsw; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preference_vectors_vector_hnsw ON user_preference_vectors USING hnsw (preference_embedding vector_cosine_ops) WITH (m=16, ef_construction=64);


COMMENT ON INDEX idx_user_preference_vectors_vector_hnsw IS 'HNSW index for user preference similarity search.';

--
-- Name: user_preference_vectors; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE user_preference_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to user_preference_vectors; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to user_preference_vectors" ON user_preference_vectors TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to user_preference_vectors; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to user_preference_vectors" ON user_preference_vectors TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: user_preference_vectors_delete_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_preference_vectors_delete_own ON user_preference_vectors FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: user_preference_vectors_insert_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_preference_vectors_insert_own ON user_preference_vectors FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: user_preference_vectors_select_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_preference_vectors_select_own ON user_preference_vectors FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: user_preference_vectors_update_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY user_preference_vectors_update_own ON user_preference_vectors FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: user_preferences; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS user_preferences (
    id uuid,
    theme text DEFAULT 'light',
    language text DEFAULT 'en',
    notifications_enabled boolean DEFAULT true,
    timezone text DEFAULT 'UTC+00:00 (London, Dublin)',
    trip_exclusions jsonb DEFAULT '[]',
    preferences jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT user_preferences_pkey PRIMARY KEY (id)
);

--
-- Name: idx_user_preferences_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preferences_id ON user_preferences (id);

--
-- Name: idx_user_preferences_id_trip_exclusions; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preferences_id_trip_exclusions ON user_preferences (id) WHERE (jsonb_array_length(trip_exclusions) > 0);

--
-- Name: idx_user_preferences_trip_exclusions; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_preferences_trip_exclusions ON user_preferences USING gin (trip_exclusions);


COMMENT ON INDEX idx_user_preferences_trip_exclusions IS 'Optimizes JSONB trip_exclusions searches using GIN index';

--
-- Name: user_preferences; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to user_preferences; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to user_preferences" ON user_preferences TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to user_preferences; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to user_preferences" ON user_preferences TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: User preferences can be deleted; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User preferences can be deleted" ON user_preferences FOR DELETE TO authenticated USING (auth.uid() = id);

--
-- Name: User preferences can be inserted; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User preferences can be inserted" ON user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

--
-- Name: User preferences can be updated; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User preferences can be updated" ON user_preferences FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

--
-- Name: User preferences can be viewed; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User preferences can be viewed" ON user_preferences FOR SELECT TO authenticated USING (auth.uid() = id);

--
-- Name: user_profiles; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS user_profiles (
    id uuid,
    first_name text,
    last_name text,
    full_name text,
    role text DEFAULT 'user',
    avatar_url text,
    home_address jsonb,
    onboarding_completed boolean DEFAULT false,
    onboarding_dismissed boolean DEFAULT false,
    home_address_skipped boolean DEFAULT false,
    first_login_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    username text,
    cover_photo_url text,
    cover_focal_x real DEFAULT 0.5,
    cover_focal_y real DEFAULT 0.5,
    discoverable text DEFAULT 'everyone',
    CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
    CONSTRAINT user_profiles_username_key UNIQUE (username),
    CONSTRAINT user_profiles_discoverable_check CHECK (discoverable IN ('everyone'::text, 'friends_of_friends'::text, 'nobody'::text)),
    CONSTRAINT user_profiles_role_check CHECK (role IN ('user'::text, 'admin'::text, 'moderator'::text, 'reader'::text)),
    CONSTRAINT user_profiles_username_format_check CHECK (username IS NULL OR username ~ '^[a-z0-9-]{3,30}$'::text)
);


COMMENT ON TABLE user_profiles IS 'User profile information. RLS policies ensure users can only access their own profiles.';


COMMENT ON COLUMN user_profiles.onboarding_completed IS 'Whether user has completed initial onboarding flow';


COMMENT ON COLUMN user_profiles.onboarding_dismissed IS 'Whether user has permanently dismissed onboarding prompts';


COMMENT ON COLUMN user_profiles.home_address_skipped IS 'Whether user explicitly skipped home address setup during onboarding';


COMMENT ON COLUMN user_profiles.first_login_at IS 'Timestamp of first successful login after registration';


COMMENT ON COLUMN user_profiles.username IS 'Unique URL-safe username for public profile pages (/u/username).';

--
-- Name: idx_user_profiles_home_address_gin; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_profiles_home_address_gin ON user_profiles USING gin (home_address) WHERE (home_address IS NOT NULL);

--
-- Name: idx_user_profiles_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_profiles_id ON user_profiles (id);

--
-- Name: user_profiles; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to user_profiles; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to user_profiles" ON user_profiles TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to user_profiles; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to user_profiles" ON user_profiles TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: User profiles can be deleted; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User profiles can be deleted" ON user_profiles FOR DELETE TO authenticated USING (auth.uid() = id);

--
-- Name: User profiles can be inserted; Type: POLICY; Schema: -; Owner: -
--

-- Clients may only bootstrap themselves as plain users. The first-user→admin
-- decision is made server-side by request_user_profile() (SECURITY DEFINER,
-- advisory-locked) via the ensure_user_profile RPC; this clamp is the
-- defense-in-depth that keeps a direct insert from self-appointing an admin.
CREATE POLICY "User profiles can be inserted" ON user_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id AND role = 'user');

--
-- Name: User profiles can be updated; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User profiles can be updated" ON user_profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

--
-- Name: User profiles can be viewed; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "User profiles can be viewed" ON user_profiles FOR SELECT TO authenticated USING (auth.uid() = id);

--
-- Name: want_to_visit_places; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS want_to_visit_places (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    place_id text,
    title text NOT NULL,
    country_code varchar(2),
    type text DEFAULT 'place',
    favorite boolean DEFAULT false,
    description text,
    location public.geometry(Point,4326) NOT NULL,
    address text,
    marker_type text DEFAULT 'default',
    marker_color text DEFAULT '#3B82F6',
    labels text[] DEFAULT ARRAY[]::text[],
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    rating integer DEFAULT 0,
    image_url text,
    image_attribution jsonb,
    CONSTRAINT want_to_visit_places_pkey PRIMARY KEY (id)
);


COMMENT ON COLUMN want_to_visit_places.title IS 'Place title/name';


COMMENT ON COLUMN want_to_visit_places.location IS 'PostGIS Point public.geometry storing the place coordinates';


COMMENT ON COLUMN want_to_visit_places.address IS 'Full address of the place';


COMMENT ON COLUMN want_to_visit_places.marker_type IS 'Type of marker icon (default, home, restaurant, etc.)';


COMMENT ON COLUMN want_to_visit_places.marker_color IS 'Hex color code for the marker';


COMMENT ON COLUMN want_to_visit_places.labels IS 'Custom labels/tags for the place';

--
-- Name: idx_want_to_visit_places_created_at; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_want_to_visit_places_created_at ON want_to_visit_places (created_at);

--
-- Name: idx_want_to_visit_places_favorite; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_want_to_visit_places_favorite ON want_to_visit_places (favorite);

--
-- Name: idx_want_to_visit_places_marker_type; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_want_to_visit_places_marker_type ON want_to_visit_places (marker_type);

--
-- Name: idx_want_to_visit_places_type; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_want_to_visit_places_type ON want_to_visit_places (type);

--
-- Name: idx_want_to_visit_places_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_want_to_visit_places_user_id ON want_to_visit_places (user_id);

--
-- Name: want_to_visit_places; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE want_to_visit_places ENABLE ROW LEVEL SECURITY;

--
-- Name: Service role full access to want_to_visit_places; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Service role full access to want_to_visit_places" ON want_to_visit_places TO service_role USING (true) WITH CHECK (true);

--
-- Name: Tenant service full access to want_to_visit_places; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Tenant service full access to want_to_visit_places" ON want_to_visit_places TO tenant_service USING (true) WITH CHECK (true);

--
-- Name: Users can delete their own want to visit places; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can delete their own want to visit places" ON want_to_visit_places FOR DELETE TO authenticated USING (auth.uid() = user_id);

--
-- Name: Users can insert their own want to visit places; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can insert their own want to visit places" ON want_to_visit_places FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can update their own want to visit places; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can update their own want to visit places" ON want_to_visit_places FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

--
-- Name: Users can view their own want to visit places; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY "Users can view their own want to visit places" ON want_to_visit_places FOR SELECT TO authenticated USING (auth.uid() = user_id);

--
-- Name: trip_plan_items; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_plan_items (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    day_number integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    description text,
    type text DEFAULT 'activity' NOT NULL,
    start_time text,
    end_time text,
    address text,
    cost_estimate numeric(10,2),
    currency text DEFAULT 'EUR',
    booking_url text,
    booking_status text DEFAULT 'not_booked',
    want_to_visit_id uuid,
    notes text,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    location_lat double precision,
    location_lng double precision,
    metadata jsonb,
    CONSTRAINT trip_plan_items_pkey PRIMARY KEY (id),
    CONSTRAINT trip_plan_items_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
    CONSTRAINT trip_plan_items_want_to_visit_id_fkey FOREIGN KEY (want_to_visit_id) REFERENCES want_to_visit_places (id) ON DELETE SET NULL
);

--
-- Name: trip_plan_items; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_plan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_plan_items_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_plan_items_delete ON trip_plan_items FOR DELETE TO PUBLIC USING (user_id = auth.uid());

--
-- Name: trip_plan_items_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_plan_items_insert ON trip_plan_items FOR INSERT TO PUBLIC WITH CHECK (user_id = auth.uid());

--
-- Name: trip_plan_items_update; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_plan_items_update ON trip_plan_items FOR UPDATE TO PUBLIC USING (user_id = auth.uid());

--
-- Name: trip_comments; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_comments (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    entry_id uuid,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT trip_comments_pkey PRIMARY KEY (id),
    CONSTRAINT trip_comments_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
);


COMMENT ON TABLE trip_comments IS 'Comments on trips (and optionally entries). Any authenticated user can comment on public trips.';

--
-- Name: idx_trip_comments_entry_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_comments_entry_id ON trip_comments (entry_id);

--
-- Name: idx_trip_comments_trip_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_comments_trip_id ON trip_comments (trip_id);

--
-- Name: idx_trip_comments_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_comments_user_id ON trip_comments (user_id);

--
-- Name: trip_comments; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_comments_delete_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_comments_delete_own ON trip_comments FOR DELETE TO authenticated USING (user_id = auth.uid());

--
-- Name: trip_entries; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_entries (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT '' NOT NULL,
    body text DEFAULT '' NOT NULL,
    entry_date date NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    highlight_start timestamptz,
    highlight_end timestamptz,
    end_date date,
    cover_media_id uuid,
    cover_focal_x real DEFAULT 0.5,
    cover_focal_y real DEFAULT 0.5,
    status text DEFAULT 'published'::text,
    blocks jsonb,
    CONSTRAINT trip_entries_pkey PRIMARY KEY (id),
    CONSTRAINT trip_entries_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
    CONSTRAINT trip_entries_status_check CHECK (status IN ('published'::text, 'draft'::text))
);


COMMENT ON TABLE trip_entries IS 'Dated markdown journal entries within a trip (Polarsteps-style).';

COMMENT ON COLUMN trip_entries.blocks IS 'Ordered content blocks: {"v":1,"blocks":[{"t":"text","md":"…"},{"t":"photos","ids":["<trip_media.id>",…]}]}. Source of truth for entry content; body is the flat markdown projection (inline wayli-media: tokens at photo-block positions) kept for legacy clients, search, and excerpts. NULL = not yet migrated, derive from body + trip_media.';


COMMENT ON COLUMN trip_entries.highlight_start IS 'Optional start of the map highlight window. NULL = use entry_date 00:00.';


COMMENT ON COLUMN trip_entries.highlight_end IS 'Optional end of the map highlight window. NULL = use entry_date 23:59.';

--
-- Name: idx_trip_entries_entry_date; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_entries_entry_date ON trip_entries (entry_date);

--
-- Name: idx_trip_entries_trip_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_entries_trip_id ON trip_entries (trip_id);

--
-- Name: idx_trip_entries_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_entries_user_id ON trip_entries (user_id);

--
-- Name: trip_entries; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_entries_owner_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_entries_owner_delete ON trip_entries FOR DELETE TO authenticated USING (user_id = auth.uid());

--
-- Name: trip_entries_owner_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_entries_owner_select ON trip_entries FOR SELECT TO PUBLIC USING (user_id = auth.uid());

--
-- Name: trip_entries_owner_update; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_entries_owner_update ON trip_entries FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

--
-- Name: trip_likes; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS trip_likes (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    entry_id uuid,
    CONSTRAINT trip_likes_pkey PRIMARY KEY (id),
    CONSTRAINT trip_likes_entry_user_unique UNIQUE (entry_id, user_id),
    CONSTRAINT trip_likes_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES trip_entries (id) ON DELETE CASCADE,
    CONSTRAINT trip_likes_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
);


COMMENT ON TABLE trip_likes IS 'Likes on trips. One per user per trip (UNIQUE constraint).';

--
-- Name: idx_trip_likes_entry_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_likes_entry_id ON trip_likes (entry_id);

--
-- Name: idx_trip_likes_trip_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_likes_trip_id ON trip_likes (trip_id);

--
-- Name: idx_trip_likes_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_likes_user_id ON trip_likes (user_id);

--
-- Name: trip_likes; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_likes_delete_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_likes_delete_own ON trip_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

--
-- Name: notifications; Type: TABLE; Schema: -; Owner: -
--

CREATE TABLE IF NOT EXISTS notifications (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text DEFAULT '',
    icon text,
    link text,
    related_job_id uuid,
    read_at timestamptz,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    -- One notification per (user, job) so retries/realtime can't double-create.
    CONSTRAINT notifications_user_job_unique UNIQUE (user_id, related_job_id)
);


COMMENT ON TABLE notifications IS 'Persistent in-app notifications for a user (e.g. job completed/failed, trip suggestions). Owner-private; no anon access. Fed by the client job-store on terminal job transitions, so notifications survive past the transient 60s job-state window.';


COMMENT ON COLUMN notifications.type IS 'Notification category, e.g. job_completed, job_failed, job_cancelled, trip_suggestion.';


COMMENT ON COLUMN notifications.related_job_id IS 'Optional jobs.queue id this notification originated from (for deep-linking).';

--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

--
-- Name: notifications; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications_insert_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY notifications_insert_own ON notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

--
-- Name: notifications_select_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY notifications_select_own ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());

--
-- Name: notifications_update_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY notifications_update_own ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

--
-- Name: notifications_delete_own; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY notifications_delete_own ON notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

--
-- Name: trip_media; Type: TABLE; Schema: -;
--

CREATE TABLE IF NOT EXISTS trip_media (
    id uuid DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL,
    entry_id uuid,
    user_id uuid NOT NULL,
    storage_path text NOT NULL,
    thumbnail_path text,
    media_type text DEFAULT 'image' NOT NULL,
    caption text DEFAULT '',
    sort_order integer DEFAULT 0,
    width integer,
    height integer,
    taken_at timestamptz,
    exif jsonb,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT trip_media_pkey PRIMARY KEY (id),
    CONSTRAINT trip_media_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES trip_entries (id) ON DELETE SET NULL,
    CONSTRAINT trip_media_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
);


COMMENT ON TABLE trip_media IS 'User-uploaded photos/videos for trips and journal entries.';

--
-- Name: idx_trip_media_entry_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_media_entry_id ON trip_media (entry_id);

--
-- Name: idx_trip_media_trip_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_media_trip_id ON trip_media (trip_id);

--
-- Name: idx_trip_media_user_id; Type: INDEX; Schema: -; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trip_media_user_id ON trip_media (user_id);

--
-- Name: trip_media; Type: RLS; Schema: -; Owner: -
--

ALTER TABLE trip_media ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_media_owner_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_media_owner_delete ON trip_media FOR DELETE TO authenticated USING (user_id = auth.uid());

--
-- Name: trip_media_owner_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_media_owner_select ON trip_media FOR SELECT TO PUBLIC USING (user_id = auth.uid());

--
-- Name: trip_media_owner_update; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_media_owner_update ON trip_media FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

--
-- Name: MAX_PLAUSIBLE_SPEED_KMH(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION MAX_PLAUSIBLE_SPEED_KMH()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT 1000::numeric;
$$;

--
-- Name: can_comment(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION can_comment(
    trip_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS(SELECT 1 FROM trips WHERE id = trip_uuid AND (
        user_id = auth.uid()
        OR (comments_allowed = 'public' AND visibility = 'public')
        OR (comments_allowed IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(SELECT 1 FROM trip_shares WHERE trip_id = trip_uuid AND shared_with_user_id = auth.uid()))
        OR (comments_allowed IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(
                SELECT 1 FROM user_connections
                WHERE status = 'accepted'
                  AND ((user_id = auth.uid() AND friend_id = (SELECT user_id FROM trips WHERE id = trip_uuid))
                    OR (friend_id = auth.uid() AND user_id = (SELECT user_id FROM trips WHERE id = trip_uuid)))
            ))
    ));
$$;

--
-- Name: can_see_costs(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION can_see_costs(
    trip_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS(SELECT 1 FROM trips WHERE id = trip_uuid AND (
        user_id = auth.uid()
        OR (costs_visible_to = 'public' AND visibility = 'public')
        OR (costs_visible_to IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(SELECT 1 FROM trip_shares WHERE trip_id = trip_uuid AND shared_with_user_id = auth.uid()))
        OR (costs_visible_to IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(
                SELECT 1 FROM user_connections
                WHERE status = 'accepted'
                  AND ((user_id = auth.uid() AND friend_id = (SELECT user_id FROM trips WHERE id = trip_uuid))
                    OR (friend_id = auth.uid() AND user_id = (SELECT user_id FROM trips WHERE id = trip_uuid)))
            ))
    ));
$$;

--
-- Name: can_see_gps(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION can_see_gps(
    trip_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS(SELECT 1 FROM trips WHERE id = trip_uuid AND (
        user_id = auth.uid()
        OR (gps_visible_to = 'public' AND visibility = 'public')
        OR (gps_visible_to IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(SELECT 1 FROM trip_shares WHERE trip_id = trip_uuid AND shared_with_user_id = auth.uid()))
        OR (gps_visible_to IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(
                SELECT 1 FROM user_connections
                WHERE status = 'accepted'
                  AND ((user_id = auth.uid() AND friend_id = (SELECT user_id FROM trips WHERE id = trip_uuid))
                    OR (friend_id = auth.uid() AND user_id = (SELECT user_id FROM trips WHERE id = trip_uuid)))
            ))
    ));
$$;

--
-- Name: can_see_plan(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION can_see_plan(
    trip_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS(SELECT 1 FROM trips WHERE id = trip_uuid AND (
        user_id = auth.uid()
        OR (plan_visible_to = 'public' AND visibility = 'public')
        OR (plan_visible_to IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(SELECT 1 FROM trip_shares WHERE trip_id = trip_uuid AND shared_with_user_id = auth.uid()))
        OR (plan_visible_to IN ('friends', 'public') AND auth.uid() IS NOT NULL
            AND EXISTS(
                SELECT 1 FROM user_connections
                WHERE status = 'accepted'
                  AND ((user_id = auth.uid() AND friend_id = (SELECT user_id FROM trips WHERE id = trip_uuid))
                    OR (friend_id = auth.uid() AND user_id = (SELECT user_id FROM trips WHERE id = trip_uuid)))
            ))
    ));
$$;

--
-- Name: can_see_trip(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION can_see_trip(
    trip_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL
    AND EXISTS(
        SELECT 1 FROM trips WHERE id = trip_uuid
        AND (user_id = auth.uid() OR visibility = 'public'
             OR visibility = 'friends'
                AND EXISTS(
                    SELECT 1 FROM user_connections uc
                    WHERE uc.status = 'accepted'
                      AND ((uc.user_id = auth.uid() AND uc.friend_id = trips.user_id)
                        OR (uc.friend_id = auth.uid() AND uc.user_id = trips.user_id))
                )
             OR EXISTS(SELECT 1 FROM trip_shares WHERE trip_id = trip_uuid AND shared_with_user_id = auth.uid()))
    ) OR EXISTS(SELECT 1 FROM trips WHERE id = trip_uuid AND visibility = 'public');
$$;

--
-- Name: is_discoverable_to(uuid); Type: FUNCTION; Schema: -; Owner: -
--
-- Whether `target_user` is visible to the current caller (auth.uid()) given
-- the target's discoverability setting:
--   everyone           -> visible to anyone (incl. anonymous)
--   nobody             -> hidden from everyone
--   friends_of_friends -> visible to direct friends and friends-of-friends
-- The friends graph is user_connections(user_id, friend_id, status='accepted').
-- An anonymous caller (auth.uid() IS NULL) sees only 'everyone'.
-- Used by the community travelers directory.

CREATE OR REPLACE FUNCTION is_discoverable_to(
    target_user uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        CASE (SELECT discoverable FROM user_profiles WHERE id = target_user)
            WHEN 'nobody' THEN false
            WHEN 'everyone' THEN true
            WHEN 'friends_of_friends' THEN
                auth.uid() IS NOT NULL
                AND (
                    -- direct friend of the target
                    EXISTS (
                        SELECT 1 FROM user_connections c
                        WHERE c.status = 'accepted'
                          AND ((c.user_id = auth.uid() AND c.friend_id = target_user)
                            OR (c.friend_id = auth.uid() AND c.user_id = target_user))
                    )
                    -- friend-of-a-friend: caller <-> mid <-> target
                    OR EXISTS (
                        SELECT 1
                        FROM user_connections c1
                        JOIN user_connections c2
                          ON c2.status = 'accepted'
                         AND ((c2.user_id = c1.friend_id AND c2.friend_id = target_user)
                           OR (c2.friend_id = c1.friend_id AND c2.user_id = target_user))
                        WHERE c1.status = 'accepted'
                          AND ((c1.user_id = auth.uid())
                            OR (c1.friend_id = auth.uid()))
                    )
                )
            ELSE true -- null/missing discoverable -> default 'everyone'
        END;
$$;

--
-- Name: disable_tracker_data_trigger(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION disable_tracker_data_trigger()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$ BEGIN
ALTER TABLE tracker_data DISABLE TRIGGER tracker_data_distance_trigger;
RAISE NOTICE 'Disabled tracker_data_distance_trigger for bulk operations';
END;
$$;

--
-- Name: disable_tracker_data_trigger(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION disable_tracker_data_trigger() IS 'Temporarily disables distance calculation trigger for bulk operations';

--
-- Name: enable_tracker_data_trigger(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION enable_tracker_data_trigger()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$ BEGIN
ALTER TABLE tracker_data ENABLE TRIGGER tracker_data_distance_trigger;
RAISE NOTICE 'Enabled tracker_data_distance_trigger';
END;
$$;

--
-- Name: enable_tracker_data_trigger(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION enable_tracker_data_trigger() IS 'Re-enables distance calculation trigger after bulk operations';

--
-- Name: find_similar_users_by_preference(uuid, text, integer, numeric); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION find_similar_users_by_preference(
    p_user_id uuid,
    p_preference_type text DEFAULT 'overall',
    p_limit integer DEFAULT 10,
    p_min_similarity numeric DEFAULT 0.6
)
RETURNS TABLE(similar_user_id uuid, similarity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH user_pref AS (
        SELECT preference_embedding
        FROM user_preference_vectors
        WHERE user_id = p_user_id
            AND preference_type = p_preference_type
            AND preference_embedding IS NOT NULL
        LIMIT 1
    )
    SELECT
        upv.user_id as similar_user_id,
        ROUND((1 - (upv.preference_embedding <=> (SELECT preference_embedding FROM user_pref)))::numeric, 4) as similarity
    FROM user_preference_vectors upv, user_pref
    WHERE upv.user_id != p_user_id
        AND upv.preference_type = p_preference_type
        AND upv.preference_embedding IS NOT NULL
        AND (1 - (upv.preference_embedding <=> user_pref.preference_embedding)) >= p_min_similarity
    ORDER BY upv.preference_embedding <=> (SELECT preference_embedding FROM user_pref)
    LIMIT p_limit;
$$;

--
-- Name: find_similar_users_by_preference(uuid, text, integer, numeric); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION find_similar_users_by_preference(uuid, text, integer, numeric) IS 'DEPRECATED: Collaborative filtering feature removed from new architecture. This function is kept for backwards compatibility.';

--
-- Name: full_country(text); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION full_country(
    country text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$ BEGIN RETURN (
        SELECT value
        FROM json_each_text(
                '{
  "AF": "Afghanistan",
  "AL": "Albania",
  "DZ": "Algeria",
  "AS": "American Samoa",
  "AD": "Andorra",
  "AO": "Angola",
  "AI": "Anguilla",
  "AQ": "Antarctica",
  "AG": "Antigua and Barbuda",
  "AR": "Argentina",
  "AM": "Armenia",
  "AW": "Aruba",
  "AU": "Australia",
  "AT": "Austria",
  "AZ": "Azerbaijan",
  "BS": "Bahamas",
  "BH": "Bahrain",
  "BD": "Bangladesh",
  "BB": "Barbados",
  "BY": "Belarus",
  "BE": "Belgium",
  "BZ": "Belize",
  "BJ": "Benin",
  "BM": "Bermuda",
  "BT": "Bhutan",
  "BO": "Bolivia",
  "BQ": "Bonaire, Sint Eustatius and Saba",
  "BA": "Bosnia and Herzegovina",
  "BW": "Botswana",
  "BV": "Bouvet Island",
  "BR": "Brazil",
  "IO": "British Indian Ocean Territory",
  "BN": "Brunei Darussalam",
  "BG": "Bulgaria",
  "BF": "Burkina Faso",
  "BI": "Burundi",
  "CV": "Cabo Verde",
  "KH": "Cambodia",
  "CM": "Cameroon",
  "CA": "Canada",
  "KY": "Cayman Islands",
  "CF": "Central African Republic",
  "TD": "Chad",
  "CL": "Chile",
  "CN": "China",
  "CX": "Christmas Island",
  "CC": "Cocos (Keeling) Islands",
  "CO": "Colombia",
  "KM": "Comoros",
  "CG": "Congo",
  "CD": "Congo, Democratic Republic of the",
  "CK": "Cook Islands",
  "CR": "Costa Rica",
  "CI": "Côte d''Ivoire",
  "HR": "Croatia",
  "CU": "Cuba",
  "CW": "Curaçao",
  "CY": "Cyprus",
  "CZ": "Czech Republic",
  "DK": "Denmark",
  "DJ": "Djibouti",
  "DM": "Dominica",
  "DO": "Dominican Republic",
  "EC": "Ecuador",
  "EG": "Egypt",
  "SV": "El Salvador",
  "GQ": "Equatorial Guinea",
  "ER": "Eritrea",
  "EE": "Estonia",
  "SZ": "Eswatini",
  "ET": "Ethiopia",
  "FK": "Falkland Islands (Malvinas)",
  "FO": "Faroe Islands",
  "FJ": "Fiji",
  "FI": "Finland",
  "FR": "France",
  "GF": "French Guiana",
  "PF": "French Polynesia",
  "TF": "French Southern Territories",
  "GA": "Gabon",
  "GM": "Gambia",
  "GE": "Georgia",
  "DE": "Germany",
  "GH": "Ghana",
  "GI": "Gibraltar",
  "GR": "Greece",
  "GL": "Greenland",
  "GD": "Grenada",
  "GP": "Guadeloupe",
  "GU": "Guam",
  "GT": "Guatemala",
  "GG": "Guernsey",
  "GN": "Guinea",
  "GW": "Guinea-Bissau",
  "GY": "Guyana",
  "HT": "Haiti",
  "HM": "Heard Island and McDonald Islands",
  "VA": "Holy See (Vatican City State)",
  "HN": "Honduras",
  "HK": "Hong Kong",
  "HU": "Hungary",
  "IS": "Iceland",
  "IN": "India",
  "ID": "Indonesia",
  "IR": "Iran, Islamic Republic of",
  "IQ": "Iraq",
  "IE": "Ireland",
  "IM": "Isle of Man",
  "IL": "Israel",
  "IT": "Italy",
  "JM": "Jamaica",
  "JP": "Japan",
  "JE": "Jersey",
  "JO": "Jordan",
  "KZ": "Kazakhstan",
  "KE": "Kenya",
  "KI": "Kiribati",
  "KP": "Korea, Democratic People''s Republic of",
  "KR": "Korea, Republic of",
  "KW": "Kuwait",
  "KG": "Kyrgyzstan",
  "LA": "Lao People''s Democratic Republic",
  "LV": "Latvia",
  "LB": "Lebanon",
  "LS": "Lesotho",
  "LR": "Liberia",
  "LY": "Libya",
  "LI": "Liechtenstein",
  "LT": "Lithuania",
  "LU": "Luxembourg",
  "MO": "Macao",
  "MK": "North Macedonia",
  "MG": "Madagascar",
  "MW": "Malawi",
  "MY": "Malaysia",
  "MV": "Maldives",
  "ML": "Mali",
  "MT": "Malta",
  "MH": "Marshall Islands",
  "MQ": "Martinique",
  "MR": "Mauritania",
  "MU": "Mauritius",
  "YT": "Mayotte",
  "MX": "Mexico",
  "FM": "Micronesia, Federated States of",
  "MD": "Moldova, Republic of",
  "MC": "Monaco",
  "MN": "Mongolia",
  "ME": "Montenegro",
  "MS": "Montserrat",
  "MA": "Morocco",
  "MZ": "Mozambique",
  "MM": "Myanmar",
  "NA": "Namibia",
  "NR": "Nauru",
  "NP": "Nepal",
  "NL": "Netherlands",
  "NC": "New Caledonia",
  "NZ": "New Zealand",
  "NI": "Nicaragua",
  "NE": "Niger",
  "NG": "Nigeria",
  "NU": "Niue",
  "NF": "Norfolk Island",
  "MP": "Northern Mariana Islands",
  "NO": "Norway",
  "OM": "Oman",
  "PK": "Pakistan",
  "PW": "Palau",
  "PS": "Palestine, State of",
  "PA": "Panama",
  "PG": "Papua New Guinea",
  "PY": "Paraguay",
  "PE": "Peru",
  "PH": "Philippines",
  "PN": "Pitcairn",
  "PL": "Poland",
  "PT": "Portugal",
  "PR": "Puerto Rico",
  "QA": "Qatar",
  "RE": "Réunion",
  "RO": "Romania",
  "RU": "Russian Federation",
  "RW": "Rwanda",
  "BL": "Saint Barthélemy",
  "SH": "Saint Helena, Ascension and Tristan da Cunha",
  "KN": "Saint Kitts and Nevis",
  "LC": "Saint Lucia",
  "MF": "Saint Martin (French part)",
  "PM": "Saint Pierre and Miquelon",
  "VC": "Saint Vincent and the Grenadines",
  "WS": "Samoa",
  "SM": "San Marino",
  "ST": "Sao Tome and Principe",
  "SA": "Saudi Arabia",
  "SN": "Senegal",
  "RS": "Serbia",
  "SC": "Seychelles",
  "SL": "Sierra Leone",
  "SG": "Singapore",
  "SK": "Slovakia",
  "SI": "Slovenia",
  "SB": "Solomon Islands",
  "SO": "Somalia",
  "ZA": "South Africa",
  "GS": "South Georgia and the South Sandwich Islands",
  "SS": "South Sudan",
  "ES": "Spain",
  "LK": "Sri Lanka",
  "SD": "Sudan",
  "SR": "Suriname",
  "SJ": "Svalbard and Jan Mayen",
  "SZ": "Eswatini",
  "SE": "Sweden",
  "CH": "Switzerland",
  "SY": "Syrian Arab Republic",
  "TW": "Taiwan, Province of China",
  "TJ": "Tajikistan",
  "TZ": "Tanzania, United Republic of",
  "TH": "Thailand",
  "TL": "Timor-Leste",
  "TG": "Togo",
  "TK": "Tokelau",
  "TO": "Tonga",
  "TT": "Trinidad and Tobago",
  "TN": "Tunisia",
  "TR": "Turkey",
  "TM": "Turkmenistan",
  "TC": "Turks and Caicos Islands",
  "TV": "Tuvalu",
  "UG": "Uganda",
  "UA": "Ukraine",
  "AE": "United Arab Emirates",
  "GB": "United Kingdom",
  "US": "United States",
  "UM": "United States Minor Outlying Islands",
  "UY": "Uruguay",
  "UZ": "Uzbekistan",
  "VU": "Vanuatu",
  "VE": "Venezuela, Bolivarian Republic of",
  "VN": "Viet Nam",
  "VG": "Virgin Islands, British",
  "VI": "Virgin Islands, U.S.",
  "WF": "Wallis and Futuna",
  "EH": "Western Sahara",
  "YE": "Yemen",
  "ZM": "Zambia",
  "ZW": "Zimbabwe"
}'
            ) AS json_data(key, value)
        WHERE key = UPPER(country)
    );
END;
$$;

--
-- Name: full_country(text); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION full_country(text) IS 'Maps ISO 3166-1 alpha-2 country codes to full country names';

--
-- Name: get_embedding_stats(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_embedding_stats(
    p_user_id uuid
)
RETURNS TABLE(poi_total bigint, poi_embedded bigint, poi_pending bigint, trip_total bigint, trip_embedded bigint, trip_pending bigint, preference_types bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = p_user_id) as poi_total,
        (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = p_user_id AND embedded_at IS NOT NULL) as poi_embedded,
        (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = p_user_id AND embedded_at IS NULL) as poi_pending,
        (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = p_user_id) as trip_total,
        (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = p_user_id AND embedded_at IS NOT NULL) as trip_embedded,
        (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = p_user_id AND embedded_at IS NULL) as trip_pending,
        (SELECT COUNT(*) FROM user_preference_vectors WHERE user_id = p_user_id AND preference_embedding IS NOT NULL) as preference_types;
$$;

--
-- Name: get_embedding_stats(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION get_embedding_stats(uuid) IS 'DEPRECATED: Statistics for deprecated embedding infrastructure. This function is kept for backwards compatibility.';

--
-- Name: jsonb_num(jsonb, text); Type: FUNCTION; Schema: -; Owner: -
--

-- Numeric field extraction that returns NULL instead of raising on
-- non-numeric/absent values — home_address and trip_exclusions have been
-- written in several shapes across platforms, so privacy-zone parsing must
-- never blow up a track query.
CREATE OR REPLACE FUNCTION jsonb_num(j jsonb, k text)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN j IS NULL OR j ->> k IS NULL OR (j ->> k) !~ '^-?[0-9]+(\.[0-9]+)?$'
            THEN NULL
        ELSE (j ->> k)::double precision
    END;
$$;

--
-- Name: effective_activity_visibility(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION effective_activity_visibility(
    activity_uuid uuid
)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        CASE
            WHEN fa.visibility IS NOT NULL THEN fa.visibility
            ELSE COALESCE(
                NULLIF(
                    CASE WHEN (up.preferences -> 'fitness_sharing' ->> 'default') IN ('private', 'friends', 'public')
                         THEN up.preferences -> 'fitness_sharing' ->> 'default'
                         ELSE NULL
                    END, ''),
                'private')
        END
    FROM fitness_activities fa
    LEFT JOIN user_preferences up ON up.id = fa.user_id
    WHERE fa.id = activity_uuid;
$$;

COMMENT ON FUNCTION effective_activity_visibility(uuid) IS 'Sharing audience of an activity: the per-activity visibility when set, else the user''s global fitness_sharing.default preference (private when unset).';

--
-- Name: can_see_activity(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION can_see_activity(
    activity_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS(
        SELECT 1 FROM fitness_activities fa
        WHERE fa.id = activity_uuid
          AND (
              fa.user_id = auth.uid()
              OR effective_activity_visibility(fa.id) = 'public'
              OR (effective_activity_visibility(fa.id) = 'friends'
                  AND auth.uid() IS NOT NULL
                  AND EXISTS(
                      SELECT 1 FROM user_connections uc
                      WHERE uc.status = 'accepted'
                        AND ((uc.user_id = auth.uid() AND uc.friend_id = fa.user_id)
                          OR (uc.friend_id = auth.uid() AND uc.user_id = fa.user_id))
                  ))
          )
    );
$$;

COMMENT ON FUNCTION can_see_activity(uuid) IS 'Whether the caller may see a fitness activity: owner, effective visibility public, or an accepted friend connection when friends. Mirrors can_see_trip().';

--
-- Name: Users can view fitness activities shared with them; Type: POLICY; Schema: -; Owner: -
--
-- Lives here (after its function, before the trips section) rather than with
-- the other fitness policies: fresh-install top-to-bottom loading needs
-- can_see_activity() to exist, which needs user_preferences/user_profiles.
CREATE POLICY "Users can view fitness activities shared with them" ON fitness_activities FOR SELECT TO authenticated USING (can_see_activity(id));

--
-- Name: privacy_zones(uuid); Type: FUNCTION; Schema: -; Owner: -
--

-- Points around which shared GPS tracks are clipped: the user's home address
-- and their trip-exclusion zones. Both sources have been stored in several
-- JSON shapes (web vs Android vs geocoder payloads), so every known shape is
-- probed. The radius comes from preferences.fitness_sharing.privacy_radius_m
-- (default 250 m, clamped to 50–2000 m).
CREATE OR REPLACE FUNCTION privacy_zones(
    p_user uuid
)
RETURNS TABLE(lat double precision, lng double precision, radius_m double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH r AS (
        SELECT COALESCE(
            LEAST(GREATEST(jsonb_num(up.preferences -> 'fitness_sharing', 'privacy_radius_m'), 50), 2000),
            250
        ) AS radius
        FROM user_preferences up
        WHERE up.id = p_user
    ),
    home AS (
        SELECT
            COALESCE(
                jsonb_num(p.home_address, 'lat'),
                jsonb_num(p.home_address -> 'location', 'lat'),
                jsonb_num(p.home_address -> 'coordinates', 'lat')
            ) AS lat,
            COALESCE(
                jsonb_num(p.home_address, 'lng'),
                jsonb_num(p.home_address, 'lon'),
                jsonb_num(p.home_address -> 'location', 'lng'),
                jsonb_num(p.home_address -> 'location', 'lon'),
                jsonb_num(p.home_address -> 'coordinates', 'lng'),
                jsonb_num(p.home_address -> 'coordinates', 'lon')
            ) AS lng
        FROM user_profiles p
        WHERE p.id = p_user AND p.home_address IS NOT NULL
    ),
    excl AS (
        SELECT
            COALESCE(
                jsonb_num(e -> 'location', 'lat'),
                jsonb_num(e -> 'location' -> 'coordinates', 'lat'),
                jsonb_num(e, 'lat')
            ) AS lat,
            COALESCE(
                jsonb_num(e -> 'location', 'lng'),
                jsonb_num(e -> 'location', 'lon'),
                jsonb_num(e -> 'location' -> 'coordinates', 'lng'),
                jsonb_num(e -> 'location' -> 'coordinates', 'lon'),
                jsonb_num(e, 'lng'),
                jsonb_num(e, 'lon')
            ) AS lng
        FROM user_preferences up,
             jsonb_array_elements(CASE WHEN jsonb_typeof(up.trip_exclusions) = 'array'
                                        THEN up.trip_exclusions ELSE '[]'::jsonb END) AS e
        WHERE up.id = p_user
    )
    SELECT home.lat, home.lng, r.radius FROM home, r
    WHERE home.lat IS NOT NULL AND home.lng IS NOT NULL
    UNION ALL
    SELECT excl.lat, excl.lng, r.radius FROM excl, r
    WHERE excl.lat IS NOT NULL AND excl.lng IS NOT NULL;
$$;

COMMENT ON FUNCTION privacy_zones(uuid) IS 'Privacy zones (home address + trip exclusions, any stored JSON shape) with the user''s privacy radius in meters. Shared-track RPCs drop tracker points within this radius of any zone.';

--
-- Name: get_public_trip_track(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_public_trip_track(
    trip_uuid uuid
)
RETURNS TABLE(lat double precision, lng double precision, recorded_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    trip_user_id uuid;
    trip_start date;
    trip_end date;
BEGIN
    -- Gate access via can_see_gps(): owner, or gps_visible_to allows the
    -- caller (public trip, explicit share, or accepted friend connection).
    -- Public trips (visibility = 'public') always serve their track: a trip
    -- the owner chose to publish shouldn't render an empty map just because
    -- gps_visible_to kept its default ('private') — the privacy-zone
    -- clipping below already strips the owner's home address and trip
    -- exclusions, so publishing never reveals where they live.
    -- Can't short-circuit into the SELECT below because SECURITY DEFINER
    -- makes that query bypass RLS regardless of who the caller is.
    IF NOT can_see_gps(trip_uuid) AND NOT EXISTS (
        SELECT 1 FROM trips WHERE id = trip_uuid AND visibility = 'public'
    ) THEN
        RETURN;
    END IF;

    SELECT user_id, start_date, end_date
    INTO trip_user_id, trip_start, trip_end
    FROM trips
    WHERE id = trip_uuid;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH zones AS MATERIALIZED (
        SELECT * FROM privacy_zones(trip_user_id)
    )
    SELECT
        ST_Y(tracker_data.location::public.geometry)::double precision AS lat,
        ST_X(tracker_data.location::public.geometry)::double precision AS lng,
        tracker_data.recorded_at
    FROM tracker_data
    WHERE tracker_data.user_id = trip_user_id
        AND tracker_data.recorded_at >= trip_start::timestamptz
        AND tracker_data.recorded_at <= (trip_end + INTERVAL '1 day')::timestamptz
        -- Privacy clipping: never serve points within the owner's privacy
        -- zones (home address + trip exclusions) — a shared trip must not
        -- reveal where the user lives.
        AND NOT EXISTS (
            SELECT 1 FROM zones z
            WHERE ST_DWithin(
                tracker_data.location::geography,
                ST_SetSRID(ST_MakePoint(z.lng, z.lat), 4326)::geography,
                z.radius_m
            )
        )
    ORDER BY tracker_data.recorded_at;
END;
$$;

--
-- Name: get_public_trip_track(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION get_public_trip_track(uuid) IS 'Returns the GPS track for a trip, with points inside the owner''s privacy zones (home + trip exclusions) clipped out. Gated by can_see_gps(trip_uuid) (owner, or gps_visible_to permits the caller) OR trips.visibility = ''public'' — public trips always serve their privacy-clipped track. SECURITY DEFINER — bypasses tracker_data RLS, which has no anon/public SELECT policy.';

--
-- Name: get_public_activity_track(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_public_activity_track(
    activity_uuid uuid
)
RETURNS TABLE(lat double precision, lng double precision, recorded_at timestamptz, speed numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    act_user_id uuid;
    act_started timestamptz;
    act_ended timestamptz;
BEGIN
    -- Gate access via can_see_activity(): owner, or the effective sharing
    -- audience (per-activity override or global default) permits the caller.
    IF NOT can_see_activity(activity_uuid) THEN
        RETURN;
    END IF;

    SELECT user_id, started_at, COALESCE(ended_at, started_at + INTERVAL '24 hours')
    INTO act_user_id, act_started, act_ended
    FROM fitness_activities
    WHERE id = activity_uuid;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH zones AS MATERIALIZED (
        SELECT * FROM privacy_zones(act_user_id)
    )
    SELECT
        ST_Y(tracker_data.location::public.geometry)::double precision AS lat,
        ST_X(tracker_data.location::public.geometry)::double precision AS lng,
        tracker_data.recorded_at,
        tracker_data.speed
    FROM tracker_data
    WHERE tracker_data.user_id = act_user_id
        AND tracker_data.recorded_at >= act_started
        AND tracker_data.recorded_at <= act_ended
        -- Privacy clipping: identical to get_public_trip_track — no shared
        -- points within the owner's privacy zones.
        AND NOT EXISTS (
            SELECT 1 FROM zones z
            WHERE ST_DWithin(
                tracker_data.location::geography,
                ST_SetSRID(ST_MakePoint(z.lng, z.lat), 4326)::geography,
                z.radius_m
            )
        )
    ORDER BY tracker_data.recorded_at;
END;
$$;

--
-- Name: get_public_activity_track(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION get_public_activity_track(uuid) IS 'Returns the GPS track + device speed for a fitness activity, with points inside the owner''s privacy zones (home + trip exclusions) clipped out. Gated by can_see_activity(activity_uuid). SECURITY DEFINER — bypasses tracker_data RLS, which has no anon/public SELECT policy. Heart-rate/power/cadence records are never served here — only the owner reads fitness_records.';

--
-- Name: get_shared_trip(text); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_shared_trip(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    trip_id uuid;
    trip_record jsonb;
    entries jsonb;
    media jsonb;
    profile jsonb;
BEGIN
    -- Find the trip by token
    SELECT id INTO trip_id FROM trips WHERE share_token = p_token;
    IF trip_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Get trip data
    SELECT to_jsonb(t.*) INTO trip_record
    FROM trips t WHERE t.id = trip_id;

    -- Get entries
    SELECT COALESCE(jsonb_agg(to_jsonb(e.*) ORDER BY e.entry_date), '[]'::jsonb) INTO entries
    FROM trip_entries e WHERE e.trip_id = trip_id;

    -- Get media
    SELECT COALESCE(jsonb_agg(to_jsonb(m.*) ORDER BY m.sort_order, m.created_at), '[]'::jsonb) INTO media
    FROM trip_media m WHERE m.trip_id = trip_id;

    -- Get owner profile (limited fields)
    SELECT to_jsonb(jsonb_build_object(
        'username', up.username,
        'full_name', up.full_name,
        'avatar_url', up.avatar_url
    )) INTO profile
    FROM user_profiles up
    JOIN trips t ON t.user_id = up.id
    WHERE t.id = trip_id;

    RETURN jsonb_build_object(
        'trip', trip_record,
        'entries', entries,
        'media', media,
        'owner', profile
    );
END;
$$;

--
-- Name: get_shared_trip(text); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION get_shared_trip(text) IS 'Fetches a trip (including private) + entries + media + owner profile by share token. SECURITY DEFINER.';

--
-- Name: get_user_preferences(uuid, text); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_user_preferences(
    p_user_id uuid,
    p_preference_type text DEFAULT NULL
)
RETURNS TABLE(preference_type text, top_items jsonb, confidence_score numeric, sample_count integer, computed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        upv.preference_type,
        upv.top_items,
        upv.confidence_score,
        upv.sample_count,
        upv.computed_at
    FROM user_preference_vectors upv
    WHERE upv.user_id = p_user_id
        AND upv.preference_embedding IS NOT NULL
        AND (p_preference_type IS NULL OR upv.preference_type = p_preference_type)
    ORDER BY upv.confidence_score DESC;
$$;

--
-- Name: get_user_preferences(uuid, text); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION get_user_preferences(uuid, text) IS 'DEPRECATED: Query user_preferences table directly instead. This function is kept for backwards compatibility.';

--
-- Name: get_user_tracking_data(uuid, timestamptz, timestamptz, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_user_tracking_data(
    user_uuid uuid,
    start_date timestamptz DEFAULT NULL,
    end_date timestamptz DEFAULT NULL,
    limit_count integer DEFAULT 1000
)
RETURNS TABLE(user_id uuid, recorded_at timestamptz, lat double precision, lon double precision, altitude numeric, accuracy numeric, speed numeric, activity_type text, geocode jsonb, distance numeric, time_spent numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$ BEGIN IF auth.uid() != user_uuid
    AND NOT EXISTS (
        SELECT 1
        FROM user_profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    ) THEN RAISE EXCEPTION 'Unauthorized: You can only access your own tracking data';
END IF;
RETURN QUERY
SELECT td.user_id,
    td.recorded_at,
    ST_Y(td.location::public.geometry) as lat,
    ST_X(td.location::public.geometry) as lon,
    td.altitude,
    td.accuracy,
    td.speed,
    td.activity_type,
    td.geocode,
    td.distance,
    td.time_spent
FROM tracker_data td
WHERE td.user_id = user_uuid
    AND (
        start_date IS NULL
        OR td.recorded_at >= start_date
    )
    AND (
        end_date IS NULL
        OR td.recorded_at <= end_date
    )
ORDER BY td.recorded_at ASC -- Changed to ASC for proper distance calculation
LIMIT limit_count;
END;
$$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
user_role TEXT;
first_name TEXT;
last_name TEXT;
full_name TEXT;
BEGIN -- Extract name information from user metadata (set during signup)
first_name := COALESCE(NEW.user_metadata->>'first_name', '');
last_name := COALESCE(NEW.user_metadata->>'last_name', '');
full_name := COALESCE(NEW.user_metadata->>'full_name', '');
IF full_name = ''
AND (
    first_name != ''
    OR last_name != ''
) THEN IF first_name != ''
AND last_name != '' THEN full_name := first_name || ' ' || last_name;
ELSIF first_name != '' THEN full_name := first_name;
ELSIF last_name != '' THEN full_name := last_name;
END IF;
END IF;
first_name := TRIM(first_name);
last_name := TRIM(last_name);
full_name := TRIM(full_name);
-- Determine user role: First user becomes admin, prevents race condition
SELECT CASE
    WHEN NOT EXISTS (
        SELECT 1
        FROM user_profiles
        LIMIT 1 FOR UPDATE
    ) THEN 'admin'
    ELSE 'user'
END INTO user_role;
INSERT INTO user_profiles (
        id,
        first_name,
        last_name,
        full_name,
        role,
        created_at,
        updated_at
    )
VALUES (
        NEW.id,
        first_name,
        last_name,
        full_name,
        user_role,
        NOW(),
        NOW()
    );
-- Sync the role to auth.users for JWT claims (admin or authenticated)
UPDATE "auth"."users"
SET "role" = CASE
    WHEN user_role = 'admin' THEN 'admin'
    ELSE 'authenticated'
END
WHERE "id" = NEW.id;
INSERT INTO user_preferences (
        id,
        created_at,
        updated_at
    )
VALUES (
        NEW.id,
        NOW(),
        NOW()
    );
RAISE NOTICE 'Successfully created profile and preferences for user: %',
NEW.id;
RETURN NEW;
EXCEPTION
WHEN OTHERS THEN RAISE WARNING 'Error in handle_new_user for user %: % %',
NEW.id,
SQLERRM,
SQLSTATE;
RAISE;
END;
$$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION handle_new_user() IS 'Trigger function to create user_profiles and user_preferences entries for new users.
    First user is automatically assigned admin role using atomic row-level locking to prevent race conditions.
    Uses empty search_path for security (SECURITY DEFINER function).

    NOTE: This function is currently DEAD CODE. The matching CREATE TRIGGER on
    auth.users cannot live in public.sql because Fluxbase owns and re-applies
    the auth schema on every restart (wiping triggers Wayli attaches to
    auth.users). Profile creation is instead handled app-side by
    ensureUserProfile() in web/src/lib/services/session/user-profile-bootstrap.ts,
    called from the signup, signin, and OAuth-callback flows. Kept here as
    documentation of the original intent and as a reference for the first-user
    admin assignment logic.';

--
-- Name: is_current_user_admin(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;

--
-- Name: is_trip_owner(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION is_trip_owner(
    trip_uuid uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS(SELECT 1 FROM trips WHERE id = trip_uuid AND user_id = auth.uid());
$$;

--
-- Name: is_user_admin(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION is_user_admin(
    user_uuid uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE user_role TEXT;
BEGIN
SELECT role INTO user_role
FROM user_profiles
WHERE id = user_uuid;
RETURN user_role = 'admin';
END;
$$;

--
-- Name: mark_setup_complete(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION mark_setup_complete()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
    -- Only update if this is the first user profile
    IF (SELECT COUNT(*) FROM "public"."user_profiles") = 1 THEN
        UPDATE "app"."settings"
        SET "value" = '{"value": true}'::jsonb,
            "updated_at" = NOW()
        WHERE "key" = 'wayli.is_setup_complete';
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: mark_setup_complete(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION mark_setup_complete() IS 'Trigger function to set is_setup_complete when first user is created';

--
-- Name: request_user_profile(text, text, text); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION request_user_profile(
    p_first_name text DEFAULT '',
    p_last_name text DEFAULT '',
    p_full_name text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile user_profiles;
    v_is_first boolean;
BEGIN
    -- Fast path: the profile already exists (every login calls this).
    SELECT * INTO v_profile FROM user_profiles WHERE id = auth.uid();
    IF FOUND THEN
        RETURN to_jsonb(v_profile);
    END IF;

    -- Serialize first-user bootstrap on fresh installs. SECURITY DEFINER sees
    -- past RLS (so the EXISTS check counts real rows — the client-side count
    -- this replaces could not, which made every signup an admin), and the
    -- advisory lock plus this VOLATILE function's fresh per-statement snapshot
    -- guarantee the loser of a concurrent-signup race sees the winner's row.
    PERFORM pg_advisory_xact_lock(703832001148);

    -- Re-check after acquiring the lock.
    SELECT * INTO v_profile FROM user_profiles WHERE id = auth.uid();
    IF NOT FOUND THEN
        SELECT NOT EXISTS (SELECT 1 FROM user_profiles) INTO v_is_first;
        INSERT INTO user_profiles (id, first_name, last_name, full_name, role, onboarding_completed)
        VALUES (
            auth.uid(),
            NULLIF(btrim(p_first_name), ''),
            NULLIF(btrim(p_last_name), ''),
            COALESCE(NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_first_name || ' ' || p_last_name), '')),
            CASE WHEN v_is_first THEN 'admin' ELSE 'user' END,
            false
        )
        ON CONFLICT (id) DO UPDATE SET updated_at = now()
        RETURNING * INTO v_profile;
    END IF;

    RETURN to_jsonb(v_profile);
END;
$$;

--
-- Name: prevent_role_escalation(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only allow role changes when the requester is the system (service_role)
    -- or when the role is being set by the initial-user trigger (INSERT path).
    -- For UPDATEs by authenticated users, preserve the existing role.
    IF TG_OP = 'UPDATE' THEN
        -- Check if the current user is trying to change their role
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            -- Allow if the current role is 'admin' (admins can manage roles)
            -- or if called by service_role (auth.role() = 'service_role')
            DECLARE
                current_role text;
            BEGIN
                SELECT role INTO current_role FROM user_profiles WHERE id = auth.uid();
                IF current_role IS DISTINCT FROM 'admin' AND auth.role() IS DISTINCT FROM 'service_role' THEN
                    -- Non-admin trying to change role — block it
                    NEW.role := OLD.role;
                END IF;
            END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: refresh_place_visits(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION refresh_place_visits()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only refresh if place_visits is a materialized view (not a table from migration 017)
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'place_visits' AND schemaname = 'public') THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."place_visits";
    END IF;
    -- If it's a table, do nothing - it's updated incrementally by the RPC
END;
$$;

--
-- Name: refresh_place_visits(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION refresh_place_visits() IS 'Refreshes the place_visits materialized view. No-op if place_visits is a table (migration 017+).';

--
-- Name: remove_duplicate_tracking_points(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION remove_duplicate_tracking_points(
    target_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE deleted_count INTEGER := 0;
BEGIN -- Delete duplicates, keeping the most recent record (highest created_at)
WITH duplicates AS (
    SELECT ctid,
        ROW_NUMBER() OVER (
            PARTITION BY user_id,
            recorded_at
            ORDER BY created_at DESC,
                ctid DESC
        ) as rn
    FROM tracker_data
    WHERE (
            target_user_id IS NULL
            OR user_id = target_user_id
        )
)
DELETE FROM tracker_data
WHERE ctid IN (
        SELECT ctid
        FROM duplicates
        WHERE rn > 1
    );
GET DIAGNOSTICS deleted_count = ROW_COUNT;
RETURN deleted_count;
END;
$$;

--
-- Name: remove_duplicate_tracking_points(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION remove_duplicate_tracking_points(uuid) IS 'Removes duplicate tracking points, keeping the most recent record for each unique (user_id, recorded_at) combination';

--
-- Name: resolve_country_code(text); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION resolve_country_code(
    input text
)
RETURNS character
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT iso2 FROM country_name_aliases WHERE name = lower(input) LIMIT 1),
        upper(input)
    );
$$;

--
-- Name: search_similar_pois(public.vector, uuid, integer, text, text, text, varchar, numeric); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION search_similar_pois(
    query_embedding public.vector,
    p_user_id uuid,
    p_limit integer DEFAULT 10,
    p_poi_category text DEFAULT NULL,
    p_poi_cuisine text DEFAULT NULL,
    p_city text DEFAULT NULL,
    p_country_code varchar DEFAULT NULL,
    p_min_similarity numeric DEFAULT 0.5
)
RETURNS TABLE(id uuid, poi_name text, poi_amenity text, poi_category text, poi_cuisine text, poi_sport text, city text, country_code varchar, visit_count integer, avg_duration_minutes integer, similarity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pe.id,
        pe.poi_name,
        pe.poi_amenity,
        pe.poi_category,
        pe.poi_cuisine,
        pe.poi_sport,
        pe.city,
        pe.country_code,
        pe.visit_count,
        pe.avg_duration_minutes,
        ROUND((1 - (pe.embedding <=> query_embedding))::numeric, 4) as similarity
    FROM poi_embeddings pe
    WHERE pe.user_id = p_user_id
        AND pe.embedding IS NOT NULL
        AND pe.embedded_at IS NOT NULL
        AND (p_poi_category IS NULL OR pe.poi_category = p_poi_category)
        AND (p_poi_cuisine IS NULL OR pe.poi_cuisine ILIKE '%' || p_poi_cuisine || '%')
        AND (p_city IS NULL OR pe.city ILIKE '%' || p_city || '%')
        AND (p_country_code IS NULL OR pe.country_code = p_country_code)
        AND (1 - (pe.embedding <=> query_embedding)) >= p_min_similarity
    ORDER BY pe.embedding <=> query_embedding
    LIMIT p_limit;
$$;

--
-- Name: search_similar_pois(public.vector, uuid, integer, text, text, text, varchar, numeric); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION search_similar_pois(public.vector, uuid, integer, text, text, text, varchar, numeric) IS 'DEPRECATED: Use knowledge base semantic search instead. This function is kept for backwards compatibility.';

--
-- Name: search_similar_trips(public.vector, uuid, integer, numeric); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION search_similar_trips(
    query_embedding public.vector,
    p_user_id uuid,
    p_limit integer DEFAULT 10,
    p_min_similarity numeric DEFAULT 0.5
)
RETURNS TABLE(id uuid, trip_id uuid, trip_title text, trip_description text, start_date date, end_date date, status text, image_url text, visited_cities text, visited_countries text, similarity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        te.id,
        te.trip_id,
        t.title as trip_title,
        t.description as trip_description,
        t.start_date,
        t.end_date,
        t.status,
        t.image_url,
        t.metadata->>'visitedCities' as visited_cities,
        t.metadata->>'visitedCountries' as visited_countries,
        ROUND((1 - (te.embedding <=> query_embedding))::numeric, 4) as similarity
    FROM trip_embeddings te
    JOIN trips t ON te.trip_id = t.id
    WHERE te.user_id = p_user_id
        AND te.embedding IS NOT NULL
        AND te.embedded_at IS NOT NULL
        AND t.status IN ('active', 'completed', 'planned')
        AND (1 - (te.embedding <=> query_embedding)) >= p_min_similarity
    ORDER BY te.embedding <=> query_embedding
    LIMIT p_limit;
$$;

--
-- Name: search_similar_trips(public.vector, uuid, integer, numeric); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION search_similar_trips(public.vector, uuid, integer, numeric) IS 'DEPRECATED: Use knowledge base semantic search instead. This function is kept for backwards compatibility.';

--
-- Name: set_first_user_admin(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION set_first_user_admin()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if any user_profiles exist. If not, this is the first user.
    -- Must check user_profiles (not auth.users) because the first auth.users
    -- row is being inserted RIGHT NOW and hasn't committed yet.
    IF NOT EXISTS (SELECT 1 FROM user_profiles LIMIT 1) THEN
        -- BUG (in dead code): 'instance_admin' is NOT in the user_profiles_role_check
        -- constraint (role IN ('user','admin','moderator','reader')) and would be
        -- rejected. The correct value is 'admin' (matches is_current_user_admin,
        -- sync_user_role_to_auth, and all RLS policies). This trigger is unwired
        -- (Fluxbase wipes auth.users triggers on restart); first-user-admin is
        -- now handled app-side by ensureUserProfile(). Do not resurrect as-is.
        NEW.role := 'instance_admin';
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: st_distancesphere(public.geography, public.geography); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION st_distancesphere(
    geog1 public.geography,
    geog2 public.geography
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
SELECT ST_Distance(geog1, geog2);
$$;

--
-- Name: calculate_distances_batch_v2(uuid, integer, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION calculate_distances_batch_v2(
    p_user_id uuid,
    p_offset integer,
    p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE updated_count INTEGER := 0;
BEGIN -- Set timeout for batch processing
SET statement_timeout = '30s';
WITH batch AS (
    SELECT user_id,
        recorded_at,
        location
    FROM tracker_data
    WHERE user_id = p_user_id
        AND location IS NOT NULL
    ORDER BY recorded_at OFFSET p_offset
    LIMIT p_limit
), -- Calculate distances using LATERAL join to get previous record
calculations AS (
    SELECT b.user_id,
        b.recorded_at,
        COALESCE(
            st_distancesphere(prev.location, b.location),
            0
        ) AS distance,
        COALESCE(
            EXTRACT(
                EPOCH
                FROM (b.recorded_at - prev.recorded_at)
            ),
            0
        ) AS time_spent
    FROM batch b
        LEFT JOIN LATERAL (
            -- Find the actual previous record for this user
            -- This works because we're not limiting the search to the batch
            SELECT location,
                recorded_at
            FROM public.tracker_data
            WHERE user_id = b.user_id
                AND recorded_at < b.recorded_at
                AND location IS NOT NULL
            ORDER BY recorded_at DESC
            LIMIT 1
        ) prev ON true
) -- Update the records in this batch using composite primary key
UPDATE public.tracker_data t
SET distance = LEAST(ROUND(c.distance::numeric, 2), 9999999999.99),
    time_spent = LEAST(ROUND(c.time_spent::numeric, 2), 9999999999.99),
    speed = LEAST(
        ROUND(
            (
                CASE
                    WHEN c.time_spent > 0 THEN (c.distance / c.time_spent) * 3.6 -- Convert m/s to km/h
                    ELSE 0
                END
            )::numeric,
            2
        ),
        9999999999.99
    ),
    updated_at = NOW()
FROM calculations c
WHERE t.user_id = c.user_id
    AND t.recorded_at = c.recorded_at;
GET DIAGNOSTICS updated_count = ROW_COUNT;
RETURN updated_count;
END;
$$;

--
-- Name: calculate_distances_batch_v2(uuid, integer, integer); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION calculate_distances_batch_v2(uuid, integer, integer) IS 'V2 distance calculation using chronological batch processing with offset. Processes records in order to ensure each record can find its previous record. Returns number of records updated.';

--
-- Name: calculate_mode_aware_speed(uuid, timestamptz, text); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION calculate_mode_aware_speed(
    user_id_param uuid,
    recorded_at_param timestamptz,
    transport_mode text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE speed_result DECIMAL := 0;
window_size INTEGER;
point_count INTEGER;
valid_speeds DECIMAL [];
median_speed DECIMAL;
avg_speed DECIMAL;
mode_factor DECIMAL := 1.0;
BEGIN -- Adjust window size based on transport mode
CASE
    transport_mode
    WHEN 'walking' THEN window_size := 3;
WHEN 'cycling' THEN window_size := 4;
WHEN 'car' THEN window_size := 5;
WHEN 'train' THEN window_size := 7;
WHEN 'airplane' THEN window_size := 10;
ELSE window_size := 5;
END CASE
;
WITH point_window AS (
    SELECT location,
        recorded_at,
        st_distancesphere(
            LAG(location) OVER (
                ORDER BY recorded_at
            ),
            location
        ) AS distance,
        EXTRACT(
            EPOCH
            FROM (
                    recorded_at - LAG(recorded_at) OVER (
                        ORDER BY recorded_at
                    )
                )
        ) AS time_diff
    FROM tracker_data
    WHERE user_id = user_id_param
        AND location IS NOT NULL
        AND recorded_at BETWEEN (recorded_at_param - INTERVAL '15 minutes')
        AND (recorded_at_param + INTERVAL '15 minutes')
    ORDER BY recorded_at
),
speed_calculations AS (
    SELECT CASE
            WHEN time_diff > 0
            AND distance > 5 THEN -- Minimum 5m distance
            (distance / time_diff) * 3.6 -- Convert m/s to km/h
            ELSE NULL
        END AS speed_kmh
    FROM point_window
    WHERE distance IS NOT NULL
        AND time_diff IS NOT NULL
        AND time_diff > 0
        AND distance > 5
    ORDER BY recorded_at
    LIMIT window_size
)
SELECT ARRAY_AGG(
        speed_kmh
        ORDER BY speed_kmh
    ),
    COUNT(*) INTO valid_speeds,
    point_count
FROM speed_calculations
WHERE speed_kmh IS NOT NULL
    AND speed_kmh > 0
    AND speed_kmh < 1000;
IF point_count < 2 THEN RETURN 0;
END IF;
median_speed := valid_speeds [CEIL(point_count::DECIMAL / 2)];
SELECT AVG(speed) INTO avg_speed
FROM UNNEST(valid_speeds) AS speed;
CASE
    transport_mode
    WHEN 'walking' THEN mode_factor := 0.8;
WHEN 'cycling' THEN mode_factor := 0.9;
WHEN 'car' THEN mode_factor := 1.0;
WHEN 'train' THEN mode_factor := 1.1;
WHEN 'airplane' THEN mode_factor := 1.2;
ELSE mode_factor := 1.0;
END CASE
;
IF median_speed IS NOT NULL THEN speed_result := median_speed * mode_factor;
ELSIF avg_speed IS NOT NULL THEN speed_result := avg_speed * mode_factor;
ELSE speed_result := 0;
END IF;
speed_result := GREATEST(0, LEAST(speed_result, 1000));
RETURN ROUND(speed_result, 2);
END;
$$;

--
-- Name: calculate_mode_aware_speed(uuid, timestamptz, text); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION calculate_mode_aware_speed(uuid, timestamptz, text) IS 'Calculates speed with transport mode awareness and appropriate window sizes';

--
-- Name: calculate_stable_speed(uuid, timestamptz, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION calculate_stable_speed(
    user_id_param uuid,
    recorded_at_param timestamptz,
    window_size integer DEFAULT 5
)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE speed_result DECIMAL := 0;
point_count INTEGER;
valid_speeds DECIMAL [];
median_speed DECIMAL;
avg_speed DECIMAL;
outlier_threshold DECIMAL;
BEGIN -- Get points in window around the target point
WITH point_window AS (
    SELECT location,
        recorded_at,
        st_distancesphere(
            LAG(location) OVER (
                ORDER BY recorded_at
            ),
            location
        ) AS distance,
        EXTRACT(
            EPOCH
            FROM (
                    recorded_at - LAG(recorded_at) OVER (
                        ORDER BY recorded_at
                    )
                )
        ) AS time_diff
    FROM tracker_data
    WHERE user_id = user_id_param
        AND location IS NOT NULL
        AND recorded_at BETWEEN (recorded_at_param - INTERVAL '10 minutes')
        AND (recorded_at_param + INTERVAL '10 minutes')
    ORDER BY recorded_at
),
speed_calculations AS (
    SELECT CASE
            WHEN time_diff > 0
            AND distance > 10 THEN -- Minimum 10m distance
            (distance / time_diff) * 3.6 -- Convert m/s to km/h
            ELSE NULL
        END AS speed_kmh
    FROM point_window
    WHERE distance IS NOT NULL
        AND time_diff IS NOT NULL
        AND time_diff > 0
        AND distance > 10
    ORDER BY recorded_at
    LIMIT window_size
)
SELECT ARRAY_AGG(
        speed_kmh
        ORDER BY speed_kmh
    ),
    COUNT(*) INTO valid_speeds,
    point_count
FROM speed_calculations
WHERE speed_kmh IS NOT NULL
    AND speed_kmh > 0
    AND speed_kmh < 500;
IF point_count < 3 THEN RETURN 0;
END IF;
median_speed := valid_speeds [CEIL(point_count::DECIMAL / 2)];
SELECT AVG(speed) INTO avg_speed
FROM UNNEST(valid_speeds) AS speed;
WITH speed_stats AS (
    SELECT AVG(speed) as mean_speed,
        STDDEV(speed) as std_dev
    FROM UNNEST(valid_speeds) AS speed
)
SELECT mean_speed + (2 * std_dev) INTO outlier_threshold
FROM speed_stats;
IF median_speed IS NOT NULL
AND median_speed < outlier_threshold THEN speed_result := median_speed;
ELSIF avg_speed IS NOT NULL
AND avg_speed < outlier_threshold THEN speed_result := avg_speed;
ELSE -- If all speeds are outliers, use the most recent valid speed
speed_result := valid_speeds [ARRAY_LENGTH(valid_speeds, 1)];
END IF;
speed_result := GREATEST(0, LEAST(speed_result, 500));
RETURN ROUND(speed_result, 2);
END;
$$;

--
-- Name: calculate_stable_speed(uuid, timestamptz, integer); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION calculate_stable_speed(uuid, timestamptz, integer) IS 'Calculates stable speed using multiple points and outlier filtering for noise reduction';

--
-- Name: get_points_within_radius(double precision, double precision, double precision, uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION get_points_within_radius(
    center_lat double precision,
    center_lon double precision,
    radius_meters double precision,
    user_uuid uuid
)
RETURNS TABLE(user_id uuid, recorded_at timestamptz, lat double precision, lon double precision, distance_meters double precision)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$ BEGIN IF auth.uid() != user_uuid
    AND NOT EXISTS (
        SELECT 1
        FROM user_profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    ) THEN RAISE EXCEPTION 'Unauthorized: You can only access your own tracking points';
END IF;
RETURN QUERY
SELECT td.user_id,
    td.recorded_at,
    ST_Y(td.location::public.geometry) as lat,
    ST_X(td.location::public.geometry) as lon,
    st_distancesphere(
        td.location,
        ST_SetSRID(
            ST_MakePoint(center_lon, center_lat),
            4326
        )
    ) as distance_meters
FROM tracker_data td
WHERE td.user_id = user_uuid
    AND ST_DWithin(
        td.location::public.geography,
        ST_SetSRID(
            ST_MakePoint(center_lon, center_lat),
            4326
        )::public.geography,
        radius_meters
    )
ORDER BY td.recorded_at;
END;
$$;

--
-- Name: sample_tracker_data_if_needed(uuid, timestamptz, timestamptz, integer, numeric, numeric, integer, integer, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION sample_tracker_data_if_needed(
    p_target_user_id uuid,
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL,
    p_max_points_threshold integer DEFAULT 1000,
    p_min_distance_meters numeric DEFAULT 500,
    p_min_time_minutes numeric DEFAULT 5,
    p_max_points_per_hour integer DEFAULT 30,
    p_offset integer DEFAULT 0,
    p_limit integer DEFAULT 1000
)
RETURNS TABLE(result_user_id uuid, result_tracker_type text, result_device_id text, result_recorded_at timestamptz, result_location public.geometry, result_country_code varchar, result_altitude numeric, result_accuracy numeric, result_speed numeric, result_distance numeric, result_time_spent numeric, result_heading numeric, result_battery_level integer, result_is_charging boolean, result_activity_type text, result_geocode jsonb, result_tz_diff numeric, result_created_at timestamptz, result_updated_at timestamptz, result_is_sampled boolean, result_total_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE total_point_count BIGINT;
min_distance_degrees DECIMAL;
min_time_interval INTERVAL;
BEGIN -- Convert meters to degrees (approximate: 1 degree ≈ 111,000 meters)
min_distance_degrees := p_min_distance_meters / 111000.0;
min_time_interval := (p_min_time_minutes || ' minutes')::INTERVAL;
SELECT COUNT(*) INTO total_point_count
FROM tracker_data
WHERE user_id = p_target_user_id
    AND location IS NOT NULL
    AND (
        p_start_date IS NULL
        OR recorded_at >= p_start_date
    )
    AND (
        p_end_date IS NULL
        OR recorded_at <= p_end_date
    );
IF total_point_count <= p_max_points_threshold
OR (
    p_min_distance_meters = 0
    AND p_min_time_minutes = 0
) THEN RETURN QUERY
SELECT td.user_id as result_user_id,
    td.tracker_type as result_tracker_type,
    td.device_id as result_device_id,
    td.recorded_at as result_recorded_at,
    td.location as result_location,
    td.country_code as result_country_code,
    td.altitude as result_altitude,
    td.accuracy as result_accuracy,
    td.speed as result_speed,
    td.distance as result_distance,
    td.time_spent as result_time_spent,
    td.heading as result_heading,
    td.battery_level as result_battery_level,
    td.is_charging as result_is_charging,
    td.activity_type as result_activity_type,
    td.geocode as result_geocode,
    td.tz_diff as result_tz_diff,
    td.created_at as result_created_at,
    td.updated_at as result_updated_at,
    false as result_is_sampled,
    total_point_count as result_total_count
FROM tracker_data td
WHERE td.user_id = p_target_user_id
    AND td.location IS NOT NULL
    AND (
        p_start_date IS NULL
        OR td.recorded_at >= p_start_date
    )
    AND (
        p_end_date IS NULL
        OR td.recorded_at <= p_end_date
    )
ORDER BY td.recorded_at
LIMIT p_limit OFFSET p_offset;
ELSE -- Apply intelligent sampling with time-based priority
RETURN QUERY WITH ranked_points AS (
    SELECT td.user_id as result_user_id,
        td.tracker_type as result_tracker_type,
        td.device_id as result_device_id,
        td.recorded_at as result_recorded_at,
        td.location as result_location,
        td.country_code as result_country_code,
        td.altitude as result_altitude,
        td.accuracy as result_accuracy,
        td.speed as result_speed,
        td.distance as result_distance,
        td.time_spent as result_time_spent,
        td.heading as result_heading,
        td.battery_level as result_battery_level,
        td.is_charging as result_is_charging,
        td.activity_type as result_activity_type,
        td.geocode as result_geocode,
        td.tz_diff as result_tz_diff,
        td.created_at as result_created_at,
        td.updated_at as result_updated_at,
        -- Calculate distance from previous point
        CASE
            WHEN LAG(td.location) OVER (
                ORDER BY td.recorded_at
            ) IS NULL THEN 0
            ELSE st_distancesphere(
                LAG(td.location) OVER (
                    ORDER BY td.recorded_at
                ),
                td.location
            )
        END as distance_from_prev,
        -- Calculate time from previous point
        CASE
            WHEN LAG(td.recorded_at) OVER (
                ORDER BY td.recorded_at
            ) IS NULL THEN INTERVAL '0 seconds'
            ELSE td.recorded_at - LAG(td.recorded_at) OVER (
                ORDER BY td.recorded_at
            )
        END as time_from_prev,
        -- Calculate points per hour in sliding window
        COUNT(*) OVER (
            ORDER BY td.recorded_at RANGE BETWEEN INTERVAL '1 hour' PRECEDING
                AND CURRENT ROW
        ) as points_in_hour,
        -- Row number for sampling
        ROW_NUMBER() OVER (
            ORDER BY td.recorded_at
        ) as row_num
    FROM tracker_data td
    WHERE td.user_id = p_target_user_id
        AND td.location IS NOT NULL
        AND (
            p_start_date IS NULL
            OR td.recorded_at >= p_start_date
        )
        AND (
            p_end_date IS NULL
            OR td.recorded_at <= p_end_date
        )
),
sampled_points AS (
    SELECT rp.result_user_id,
        rp.result_tracker_type,
        rp.result_device_id,
        rp.result_recorded_at,
        rp.result_location,
        rp.result_country_code,
        rp.result_altitude,
        rp.result_accuracy,
        rp.result_speed,
        rp.result_distance,
        rp.result_time_spent,
        rp.result_heading,
        rp.result_battery_level,
        rp.result_is_charging,
        rp.result_activity_type,
        rp.result_geocode,
        rp.result_tz_diff,
        rp.result_created_at,
        rp.result_updated_at,
        rp.distance_from_prev,
        rp.time_from_prev,
        rp.points_in_hour,
        rp.row_num,
        -- Keep first and last points
        CASE
            WHEN rp.row_num = 1
            OR rp.row_num = total_point_count THEN true -- Prioritize time-based sampling: keep points with significant time gap
            -- This is the primary filter for reducing density
            WHEN rp.time_from_prev >= min_time_interval THEN true -- Secondary: keep points with significant movement only if also some time has passed
            -- Require at least 25% of the time interval to prevent excessive points during fast travel
            WHEN rp.distance_from_prev >= p_min_distance_meters
            AND rp.time_from_prev >= (min_time_interval * 0.25) THEN true -- Keep points if we're under the hourly limit (safety net)
            WHEN rp.points_in_hour <= p_max_points_per_hour THEN true -- Sample remaining points (keep every nth point)
            WHEN rp.row_num % CEIL(
                total_point_count::DECIMAL / p_max_points_threshold
            ) = 0 THEN true
            ELSE false
        END as should_keep
    FROM ranked_points rp
)
SELECT sp.result_user_id,
    sp.result_tracker_type,
    sp.result_device_id,
    sp.result_recorded_at,
    sp.result_location,
    sp.result_country_code,
    sp.result_altitude,
    sp.result_accuracy,
    sp.result_speed,
    sp.result_distance,
    sp.result_time_spent,
    sp.result_heading,
    sp.result_battery_level,
    sp.result_is_charging,
    sp.result_activity_type,
    sp.result_geocode,
    sp.result_tz_diff,
    sp.result_created_at,
    sp.result_updated_at,
    true as result_is_sampled,
    total_point_count as result_total_count
FROM sampled_points sp
WHERE sp.should_keep
ORDER BY sp.result_recorded_at
LIMIT p_limit OFFSET p_offset;
END IF;
END;
$$;

--
-- Name: sample_tracker_data_if_needed(uuid, timestamptz, timestamptz, integer, numeric, numeric, integer, integer, integer); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION sample_tracker_data_if_needed(uuid, timestamptz, timestamptz, integer, numeric, numeric, integer, integer, integer) IS 'Intelligently samples tracker data when point count exceeds threshold. Uses dynamic spatial-temporal sampling with configurable parameters that become more aggressive for larger datasets.';

--
-- Name: sync_user_role_to_auth(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION sync_user_role_to_auth()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Update the role in auth.users to match user_profiles
    -- admin → admin (PostgreSQL role that inherits from authenticated)
    -- user → authenticated (standard PostgreSQL role)
    UPDATE "auth"."users"
    SET "role" = CASE
        WHEN NEW."role" = 'admin' THEN 'admin'
        ELSE 'authenticated'
    END
    WHERE "id" = NEW."id";

    RAISE NOTICE 'Synced role % to auth.users for user %', NEW."role", NEW."id";

    RETURN NEW;
END;
$$;

--
-- Name: sync_user_role_to_auth(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION sync_user_role_to_auth() IS 'Trigger function to sync user role from user_profiles to auth.users so JWT claims include the correct role. Maps application roles (admin, user) to PostgreSQL roles (admin, authenticated).';

--
-- Name: trigger_calculate_distance(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION trigger_calculate_distance()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
    prev_point RECORD;
    calculated_distance DECIMAL;
    calculated_time_spent DECIMAL;
    stable_speed DECIMAL;
    -- Speed ceiling (km/h). Above commercial cruise (~950), below every observed glitch.
    max_plausible_speed CONSTANT DECIMAL := 1000;
    -- Minimum inter-point gap (s) before the derived speed is trusted.
    -- Sub-second gaps make distance/time explode (the 481k km/h outlier).
    min_time_spent CONSTANT DECIMAL := 1.0;
BEGIN
    IF NEW.location IS NOT NULL THEN
        -- Find the previous point for this user based on recorded_at.
        SELECT location, recorded_at
        INTO prev_point
        FROM tracker_data
        WHERE user_id = NEW.user_id
          AND recorded_at < NEW.recorded_at
          AND location IS NOT NULL
        ORDER BY recorded_at DESC
        LIMIT 1;

        IF prev_point IS NOT NULL THEN
            calculated_distance := st_distancesphere(prev_point.location, NEW.location);
            NEW.distance := calculated_distance;

            calculated_time_spent := EXTRACT(EPOCH FROM (NEW.recorded_at - prev_point.recorded_at));
            NEW.time_spent := calculated_time_spent;

            IF calculated_time_spent >= min_time_spent THEN
                stable_speed := (calculated_distance / calculated_time_spent) * 3.6;
            ELSE
                -- Sub-second gap: the division is unreliable. Keep distance/
                -- time_spent for the record, but don't compute a speed from a
                -- near-zero denominator. Leave speed unchanged on UPDATE, or 0
                -- on INSERT (upstream default).
                stable_speed := COALESCE(NEW.speed, 0);
            END IF;

            -- Hard clamp: nothing we model moves faster than this.
            NEW.speed := LEAST(ROUND(stable_speed::numeric, 2), max_plausible_speed);
        ELSE
            -- First point for this user.
            NEW.distance := 0;
            NEW.time_spent := 0;
            NEW.speed := 0;
        END IF;

        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;

--
-- Name: trigger_calculate_distance(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION trigger_calculate_distance() IS 'Computes distance/time_spent/speed from the previous chronological point. Speed is only derived when the inter-point gap is >= 1s (sub-second gaps are untrusted) and is clamped to 1000 km/h.';

--
-- Name: notify_job_terminal(); Type: FUNCTION; Schema: -; Owner: -
--
-- Builds a persistent notification row from a terminal jobs.queue update
-- (completed/failed/cancelled). Currently uncalled: the trigger that
-- invoked it targeted the Fluxbase-owned jobs.queue table, which the
-- declarative public-schema sync does not manage, so the trigger is not
-- applied here. Notifications are instead written client-side by the job
-- store (web/src/lib/stores/job-store.ts). This function is kept in-tree
-- and deployed so a future managed-trigger mechanism can attach it without
-- a schema change. SECURITY DEFINER so it can INSERT into public.notifications
-- regardless of the caller role.
CREATE OR REPLACE FUNCTION notify_job_terminal()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type text;
    v_title text;
    v_body text;
    v_link text;
BEGIN
    -- Only act on a real transition INTO a terminal state.
    IF NEW.status NOT IN ('completed', 'failed', 'cancelled') THEN
        RETURN NEW;
    END IF;
    IF (OLD.status = NEW.status) THEN
        RETURN NEW;
    END IF;
    -- Skip if there's no owning user (can't address a notification).
    IF NEW.created_by IS NULL THEN
        RETURN NEW;
    END IF;

    v_type := 'job_' || NEW.status;

    -- Friendly job name (mirrors jobDisplayName in job-store.ts).
    v_title := CASE
        WHEN NEW.job_name LIKE 'data-import%' OR NEW.job_name LIKE 'data_import%' THEN 'Data import'
        WHEN NEW.job_name = 'data-export' THEN 'Data export'
        WHEN NEW.job_name IN ('reverse-geocoding', 'reverse-geocoding-missing') THEN 'Reverse geocoding'
        WHEN NEW.job_name IN ('trip-generation', 'trip-detection') THEN 'Trip generation'
        WHEN NEW.job_name LIKE 'detect-place-visits%' THEN 'Place visit detection'
        WHEN NEW.job_name LIKE 'detect-transport-mode%' THEN 'Transport mode detection'
        WHEN NEW.job_name LIKE 'refresh-daily-activity%' THEN 'Daily activity refresh'
        WHEN NEW.job_name LIKE 'polarsteps-import%' THEN 'Polarsteps import'
        WHEN NEW.job_name LIKE 'scheduled-trip-generation%' THEN 'Scheduled trip suggestions'
        ELSE REPLACE(REPLACE(NEW.job_name, '-', ' '), '_', ' ')
    END;

    v_title := v_title || ' ' || CASE NEW.status
        WHEN 'completed' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        ELSE 'cancelled'
    END;

    v_body := COALESCE(NULLIF(NEW.error_message, ''), '');

    -- Deep-link completed exports so the user can download.
    v_link := CASE
        WHEN NEW.job_name = 'data-export' AND NEW.status = 'completed'
            THEN '/dashboard/import-export'
        ELSE NULL
    END;

    -- Guard: notifications may not exist yet on a fresh bootstrap. Never let
    -- that break the underlying job update.
    BEGIN
        INSERT INTO public.notifications
            (user_id, type, title, body, link, related_job_id)
        VALUES
            (NEW.created_by, v_type, v_title, v_body, v_link, NEW.id)
        ON CONFLICT (user_id, related_job_id) DO NOTHING;
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;

    RETURN NEW;
END;
$$;

--
-- Name: trigger_calculate_distance_enhanced(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION trigger_calculate_distance_enhanced()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE prev_point RECORD;
calculated_distance DECIMAL;
calculated_time_spent DECIMAL;
stable_speed DECIMAL;
BEGIN -- Only calculate if location is provided
IF NEW.location IS NOT NULL THEN -- Find the previous point for this user based on recorded_at
SELECT location,
    recorded_at INTO prev_point
FROM tracker_data
WHERE user_id = NEW.user_id
    AND recorded_at < NEW.recorded_at
    AND location IS NOT NULL
ORDER BY recorded_at DESC
LIMIT 1;
IF prev_point IS NOT NULL THEN -- Calculate distance from previous point
calculated_distance := st_distancesphere(prev_point.location, NEW.location);
NEW.distance := calculated_distance;
calculated_time_spent := EXTRACT(
    EPOCH
    FROM (NEW.recorded_at - prev_point.recorded_at)
);
NEW.time_spent := calculated_time_spent;
IF calculated_time_spent > 0 THEN stable_speed := (calculated_distance / calculated_time_spent) * 3.6;
ELSE stable_speed := 0;
END IF;
NEW.speed := LEAST(ROUND(stable_speed::numeric, 2), 9999999999.99);
ELSE -- First point for this user - set distance and time_spent to 0
NEW.distance := 0;
NEW.time_spent := 0;
NEW.speed := 0;
END IF;
END IF;
RETURN NEW;
END;
$$;

--
-- Name: trigger_calculate_distance_enhanced(); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION trigger_calculate_distance_enhanced() IS 'Enhanced trigger that uses stable speed calculation for new records';

--
-- Name: update_tracker_distances(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_tracker_distances(
    target_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $_$
DECLARE total_updated INTEGER := 0;
batch_size INTEGER := 1000;
batch_updated INTEGER;
has_more_records BOOLEAN := TRUE;
user_filter TEXT := '';
BEGIN
SET LOCAL statement_timeout = '30min';
IF target_user_id IS NOT NULL THEN RAISE NOTICE 'Starting enhanced distance and speed calculation for user %...',
target_user_id;
user_filter := ' AND t1.user_id = $1';
ELSE RAISE NOTICE 'Starting enhanced distance and speed calculation for ALL users...';
END IF;
WHILE has_more_records LOOP -- Use enhanced speed calculation with multi-point window
WITH distance_and_time_calculations AS (
    SELECT t1.user_id,
        t1.recorded_at,
        t1.location,
        CASE
            WHEN LAG(t1.location) OVER (
                PARTITION BY t1.user_id
                ORDER BY t1.recorded_at
            ) IS NULL THEN 0
            ELSE st_distancesphere(
                LAG(t1.location) OVER (
                    PARTITION BY t1.user_id
                    ORDER BY t1.recorded_at
                ),
                t1.location
            )
        END AS calculated_distance,
        CASE
            WHEN LAG(t1.recorded_at) OVER (
                PARTITION BY t1.user_id
                ORDER BY t1.recorded_at
            ) IS NULL THEN 0
            ELSE EXTRACT(
                EPOCH
                FROM (
                        t1.recorded_at - LAG(t1.recorded_at) OVER (
                            PARTITION BY t1.user_id
                            ORDER BY t1.recorded_at
                        )
                    )
            )
        END AS calculated_time_spent
    FROM tracker_data t1
    WHERE t1.location IS NOT NULL
        AND (
            t1.distance IS NULL
            OR t1.distance = 0
        )
        AND (
            target_user_id IS NULL
            OR t1.user_id = target_user_id
        )
    ORDER BY t1.user_id,
        t1.recorded_at
    LIMIT batch_size
)
UPDATE tracker_data AS td
SET distance = LEAST(
        ROUND(dc.calculated_distance::numeric, 2),
        9999999999.99
    ),
    time_spent = LEAST(
        ROUND(dc.calculated_time_spent::numeric, 2),
        9999999999.99
    ),
    -- Calculate simple speed (distance / time)
    speed = LEAST(
        ROUND(
            (
                CASE
                    WHEN dc.calculated_time_spent > 0 THEN (
                        dc.calculated_distance / dc.calculated_time_spent
                    ) * 3.6
                    ELSE 0
                END
            )::numeric,
            2
        ),
        9999999999.99
    ),
    updated_at = NOW()
FROM distance_and_time_calculations dc
WHERE td.user_id = dc.user_id
    AND td.recorded_at = dc.recorded_at;
GET DIAGNOSTICS batch_updated = ROW_COUNT;
IF batch_updated = 0 THEN has_more_records := FALSE;
ELSE total_updated := total_updated + batch_updated;
RAISE NOTICE 'Updated % records in batch. Total updated: %',
batch_updated,
total_updated;
END IF;
END LOOP;
IF target_user_id IS NOT NULL THEN RAISE NOTICE 'Enhanced distance and speed calculation complete for user %. Updated % records.',
target_user_id,
total_updated;
ELSE RAISE NOTICE 'Enhanced distance and speed calculation complete for ALL users. Updated % records.',
total_updated;
END IF;
RETURN total_updated;
END;
$_$;

--
-- Name: update_tracker_distances(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION update_tracker_distances(uuid) IS 'Enhanced version that uses stable speed calculation with multi-point windows for better accuracy';

--
-- Name: perform_bulk_import_with_distance_calculation(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION perform_bulk_import_with_distance_calculation(
    target_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE updated_count INTEGER;
BEGIN RAISE NOTICE 'Starting bulk import optimization for user %...',
target_user_id;
PERFORM disable_tracker_data_trigger();
SELECT update_tracker_distances(target_user_id) INTO updated_count;
PERFORM enable_tracker_data_trigger();
RAISE NOTICE 'Bulk import optimization complete for user %. Updated % records.',
target_user_id,
updated_count;
RETURN updated_count;
END;
$$;

--
-- Name: perform_bulk_import_with_distance_calculation(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION perform_bulk_import_with_distance_calculation(uuid) IS 'Optimized bulk import helper that disables triggers, calculates distances, and re-enables triggers';

--
-- Name: update_tracker_distances_batch(uuid, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_tracker_distances_batch(
    target_user_id uuid DEFAULT NULL,
    batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $_$
DECLARE total_updated INTEGER := 0;
batch_updated INTEGER;
user_filter TEXT := '';
has_more_records BOOLEAN := TRUE;
start_time TIMESTAMP := clock_timestamp();
max_execution_time INTERVAL := INTERVAL '5 minutes';
BEGIN -- Set shorter timeout for this function to prevent long-running operations
SET statement_timeout = '300s';
IF clock_timestamp() - start_time > max_execution_time THEN RAISE NOTICE 'Function execution time limit approaching, returning partial results';
RETURN total_updated;
END IF;
IF target_user_id IS NOT NULL THEN user_filter := ' AND t1.user_id = $1';
END IF;
RAISE NOTICE 'Starting optimized distance calculation for records without distances (batch size: %)',
batch_size;
WHILE has_more_records
AND (clock_timestamp() - start_time) < max_execution_time LOOP -- Process only records that don't have distance calculated yet
WITH distance_and_time_calculations AS (
    SELECT t1.user_id,
        t1.recorded_at,
        t1.location,
        CASE
            WHEN LAG(t1.location) OVER (
                PARTITION BY t1.user_id
                ORDER BY t1.recorded_at
            ) IS NULL THEN 0
            ELSE public.st_distancesphere(
                LAG(t1.location) OVER (
                    PARTITION BY t1.user_id
                    ORDER BY t1.recorded_at
                ),
                t1.location
            )
        END AS calculated_distance,
        CASE
            WHEN LAG(t1.recorded_at) OVER (
                PARTITION BY t1.user_id
                ORDER BY t1.recorded_at
            ) IS NULL THEN 0
            ELSE EXTRACT(
                EPOCH
                FROM (
                        t1.recorded_at - LAG(t1.recorded_at) OVER (PARTITION BY t1.recorded_at)
                    )
            )
        END AS calculated_time_spent
    FROM public.tracker_data t1
    WHERE t1.location IS NOT NULL
        AND (
            t1.distance IS NULL
            OR t1.distance = 0
        ) -- Only process records without distance
        AND (
            target_user_id IS NULL
            OR t1.user_id = target_user_id
        )
    ORDER BY t1.user_id,
        t1.recorded_at
    LIMIT batch_size
)
UPDATE public.tracker_data AS td
SET distance = LEAST(
        ROUND(dc.calculated_distance::numeric, 2),
        9999999999.99
    ),
    time_spent = LEAST(
        ROUND(dc.calculated_time_spent::numeric, 2),
        9999999999.99
    ),
    speed = LEAST(
        ROUND(
            (
                CASE
                    WHEN dc.calculated_time_spent > 0 THEN (
                        dc.calculated_distance / dc.calculated_time_spent
                    )
                    ELSE 0
                END
            )::numeric,
            2
        ),
        9999999999.99
    )
FROM distance_and_time_calculations dc
WHERE td.user_id = dc.user_id
    AND td.recorded_at = dc.recorded_at;
GET DIAGNOSTICS batch_updated = ROW_COUNT;
IF batch_updated = 0 THEN has_more_records := FALSE;
ELSE total_updated := total_updated + batch_updated;
RAISE NOTICE 'Processed batch: % records, total: %',
batch_updated,
total_updated;
IF (clock_timestamp() - start_time) >= max_execution_time THEN RAISE NOTICE 'Execution time limit reached, returning partial results: % records updated',
total_updated;
has_more_records := FALSE;
ELSE -- Small delay to prevent overwhelming the database
PERFORM pg_sleep(0.05);
END IF;
END IF;
END LOOP;
RAISE NOTICE 'Optimized distance calculation completed: % total records updated in %',
total_updated,
clock_timestamp() - start_time;
RETURN total_updated;
END;
$_$;

--
-- Name: update_tracker_distances_batch(uuid, integer); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION update_tracker_distances_batch(uuid, integer) IS 'Updates distance and time_spent columns in optimized batches for large datasets. Includes execution time limits and improved performance.';

--
-- Name: update_tracker_distances_enhanced(uuid); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_tracker_distances_enhanced(
    target_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $_$
DECLARE total_updated INTEGER;
user_filter TEXT := '';
batch_size INTEGER := 1000;
batch_updated INTEGER;
has_more_records BOOLEAN := TRUE;
BEGIN
SET LOCAL statement_timeout = '30min';
IF target_user_id IS NOT NULL THEN RAISE NOTICE 'Starting enhanced distance and speed calculation for user %...',
target_user_id;
user_filter := ' AND t1.user_id = $1';
ELSE RAISE NOTICE 'Starting enhanced distance and speed calculation for ALL users...';
END IF;
total_updated := 0;
WHILE has_more_records LOOP -- Use enhanced speed calculation with multi-point window
WITH distance_and_time_calculations AS (
    SELECT t1.user_id,
        t1.recorded_at,
        t1.location,
        CASE
            WHEN LAG(t1.location) OVER (
                PARTITION BY t1.user_id
                ORDER BY t1.recorded_at
            ) IS NULL THEN 0
            ELSE st_distancesphere(
                LAG(t1.location) OVER (
                    PARTITION BY t1.user_id
                    ORDER BY t1.recorded_at
                ),
                t1.location
            )
        END AS calculated_distance,
        CASE
            WHEN LAG(t1.recorded_at) OVER (
                PARTITION BY t1.user_id
                ORDER BY t1.recorded_at
            ) IS NULL THEN 0
            ELSE EXTRACT(
                EPOCH
                FROM (
                        t1.recorded_at - LAG(t1.recorded_at) OVER (
                            PARTITION BY t1.user_id
                            ORDER BY t1.recorded_at
                        )
                    )
            )
        END AS calculated_time_spent
    FROM tracker_data t1
    WHERE t1.location IS NOT NULL
        AND (
            t1.distance IS NULL
            OR t1.distance = 0
        )
        AND (
            target_user_id IS NULL
            OR t1.user_id = target_user_id
        )
    ORDER BY t1.user_id,
        t1.recorded_at
    LIMIT batch_size
)
UPDATE tracker_data AS td
SET distance = LEAST(
        ROUND(dc.calculated_distance::numeric, 2),
        9999999999.99
    ),
    time_spent = LEAST(
        ROUND(dc.calculated_time_spent::numeric, 2),
        9999999999.99
    ),
    -- Calculate simple speed (distance / time)
    speed = LEAST(
        ROUND(
            (
                CASE
                    WHEN dc.calculated_time_spent > 0 THEN (
                        dc.calculated_distance / dc.calculated_time_spent
                    ) * 3.6
                    ELSE 0
                END
            )::numeric,
            2
        ),
        9999999999.99
    ),
    updated_at = NOW()
FROM distance_and_time_calculations dc
WHERE td.user_id = dc.user_id
    AND td.recorded_at = dc.recorded_at;
GET DIAGNOSTICS batch_updated = ROW_COUNT;
IF batch_updated = 0 THEN has_more_records := FALSE;
ELSE total_updated := total_updated + batch_updated;
RAISE NOTICE 'Updated % records in batch. Total updated: %',
batch_updated,
total_updated;
END IF;
END LOOP;
IF target_user_id IS NOT NULL THEN RAISE NOTICE 'Enhanced distance and speed calculation complete for user %. Updated % records.',
target_user_id,
total_updated;
ELSE RAISE NOTICE 'Enhanced distance and speed calculation complete for ALL users. Updated % records.',
total_updated;
END IF;
RETURN total_updated;
END;
$_$;

--
-- Name: update_tracker_distances_enhanced(uuid); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION update_tracker_distances_enhanced(uuid) IS 'Enhanced version that uses stable speed calculation with multi-point windows';

--
-- Name: update_tracker_distances_small_batch(uuid, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_tracker_distances_small_batch(
    target_user_id uuid DEFAULT NULL,
    max_records integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE total_updated INTEGER := 0;
BEGIN -- Set very short timeout
SET statement_timeout = '30s';
WITH records_needing_update AS (
    -- Get records that need distance calculation
    SELECT user_id,
        recorded_at
    FROM tracker_data
    WHERE location IS NOT NULL
        AND (
            distance IS NULL
            OR distance = 0
        )
        AND (
            target_user_id IS NULL
            OR user_id = target_user_id
        )
    ORDER BY user_id,
        recorded_at
    LIMIT max_records
), distance_and_time_calculations AS (
    -- Calculate distances for those records, but query ALL records for the user
    -- to ensure LAG() has the data it needs
    SELECT t1.user_id,
        t1.recorded_at,
        CASE
            WHEN prev.location IS NULL THEN 0
            ELSE st_distancesphere(prev.location, t1.location)
        END AS calculated_distance,
        CASE
            WHEN prev.recorded_at IS NULL THEN 0
            ELSE EXTRACT(
                EPOCH
                FROM (t1.recorded_at - prev.recorded_at)
            )
        END AS calculated_time_spent
    FROM tracker_data t1 -- Self-join to get previous record for each user
        LEFT JOIN LATERAL (
            SELECT location,
                recorded_at
            FROM tracker_data
            WHERE user_id = t1.user_id
                AND recorded_at < t1.recorded_at
                AND location IS NOT NULL
            ORDER BY recorded_at DESC
            LIMIT 1
        ) prev ON true
    WHERE EXISTS (
            SELECT 1
            FROM records_needing_update rnu
            WHERE rnu.user_id = t1.user_id
                AND rnu.recorded_at = t1.recorded_at
        )
)
UPDATE tracker_data AS td
SET distance = LEAST(
        ROUND(dc.calculated_distance::numeric, 2),
        9999999999.99
    ),
    time_spent = LEAST(
        ROUND(dc.calculated_time_spent::numeric, 2),
        9999999999.99
    ),
    speed = LEAST(
        ROUND(
            (
                CASE
                    WHEN dc.calculated_time_spent > 0 THEN (
                        dc.calculated_distance / dc.calculated_time_spent
                    ) * 3.6
                    ELSE 0
                END
            )::numeric,
            2
        ),
        9999999999.99
    ),
    updated_at = NOW()
FROM distance_and_time_calculations dc
WHERE td.user_id = dc.user_id
    AND td.recorded_at = dc.recorded_at;
GET DIAGNOSTICS total_updated = ROW_COUNT;
RETURN total_updated;
END;
$$;

--
-- Name: update_tracker_distances_small_batch(uuid, integer); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION update_tracker_distances_small_batch(uuid, integer) IS 'Lightweight distance calculation function for small batches with very short timeout (30s). Uses LATERAL join to properly access previous records for LAG calculation.';

--
-- Name: update_user_profiles_updated_at(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$;

--
-- Name: update_want_to_visit_places_updated_at(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_want_to_visit_places_updated_at()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$ BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

--
-- Name: update_workers_updated_at(); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION update_workers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$;

--
-- Name: validate_tracking_query_limits(integer, integer); Type: FUNCTION; Schema: -; Owner: -
--

CREATE OR REPLACE FUNCTION validate_tracking_query_limits(
    p_limit integer,
    p_max_points_threshold integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$ BEGIN -- Enforce maximum limits to prevent DoS
    IF p_limit > 10000 THEN RAISE EXCEPTION 'Limit too high (maximum 10000), requested: %',
    p_limit;
END IF;
IF p_max_points_threshold > 10000 THEN RAISE EXCEPTION 'Max points threshold too high (maximum 10000), requested: %',
p_max_points_threshold;
END IF;
RETURN TRUE;
END;
$$;

--
-- Name: wayli_entry_blocks_for_entry(uuid); Type: FUNCTION; Schema: -; Owner: -
--

-- Derives the block structure for an entry from its legacy representation
-- (body markdown + trip_media rows). Used by the one-off entry-blocks
-- backfill; also usable to lazily derive blocks for rows written by legacy
-- clients. Rules:
--   * body is split on `![caption](wayli-media:<storage_path>)` tokens;
--   * runs of tokens separated only by whitespace become ONE photo block;
--   * token refs are resolved to trip_media.id via exact storage_path match;
--     unresolvable tokens are kept as literal text (no data loss);
--   * media rows not referenced inline are appended as a trailing photo
--     block, ordered by sort_order/created_at;
--   * returns NULL when there is no content at all (empty body, no media).
CREATE OR REPLACE FUNCTION wayli_entry_blocks_for_entry(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_body text;
    v_parts text[];
    v_el text;
    v_ref text;
    v_media_id uuid;
    v_remaining uuid[];
    v_blocks jsonb := '[]'::jsonb;
    v_text text := '';
    v_ids jsonb := '[]'::jsonb;
BEGIN
    SELECT e.body INTO v_body FROM trip_entries e WHERE e.id = p_entry_id;
    v_body := coalesce(v_body, '');

    SELECT coalesce(array_agg(m.id ORDER BY m.sort_order NULLS LAST, m.created_at), '{}'::uuid[])
      INTO v_remaining
      FROM trip_media m
     WHERE m.entry_id = p_entry_id;

    -- Postgres regexp_split_to_array drops the delimiter (capture groups are
    -- NOT included, unlike JS String.split), so wrap each token in chr(1)
    -- sentinels first and split on those: every token becomes its own element.
    v_parts := string_to_array(
        regexp_replace(
            v_body,
            '(!\[[^\]]*\]\(wayli-media:[^)\s]+\))',
            chr(1) || '\1' || chr(1),
            'g'
        ),
        chr(1)
    );

    FOR i IN 1 .. coalesce(array_length(v_parts, 1), 0) LOOP
        v_el := v_parts[i];
        CONTINUE WHEN v_el = '';
        IF v_el ~ '^!\[' THEN
            v_ref := (regexp_match(v_el, '\(wayli-media:([^)\s]+)\)'))[1];
            SELECT m.id INTO v_media_id
              FROM trip_media m
             WHERE m.entry_id = p_entry_id AND m.storage_path = v_ref
             LIMIT 1;
            IF v_media_id IS NULL THEN
                -- Unresolvable ref: keep the token as literal text.
                v_text := v_text || v_el;
            ELSE
                v_ids := v_ids || to_jsonb(v_media_id);
                v_remaining := array_remove(v_remaining, v_media_id);
            END IF;
        ELSIF btrim(v_el, E' \t\n\r') = '' THEN
            -- Whitespace-only run between tokens: keeps the photo group open.
            v_text := v_text || v_el;
        ELSE
            IF jsonb_array_length(v_ids) > 0 THEN
                v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('t', 'photos', 'ids', v_ids));
                v_ids := '[]'::jsonb;
            END IF;
            v_text := v_text || v_el;
            IF btrim(v_text, E' \t\n\r') <> '' THEN
                v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('t', 'text', 'md', btrim(v_text, E' \t\n\r')));
            END IF;
            v_text := '';
        END IF;
    END LOOP;

    IF jsonb_array_length(v_ids) > 0 THEN
        v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('t', 'photos', 'ids', v_ids));
    END IF;
    IF coalesce(array_length(v_remaining, 1), 0) > 0 THEN
        v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('t', 'photos', 'ids', to_jsonb(v_remaining)));
    END IF;

    IF jsonb_array_length(v_blocks) = 0 THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object('v', 1, 'blocks', v_blocks);
END;
$$;

COMMENT ON FUNCTION wayli_entry_blocks_for_entry(uuid) IS 'Derives {"v":1,"blocks":[…]} for an entry from legacy body + trip_media. See backfill-entry-blocks.sql.';



--
-- Name: validate_tracking_query_limits(integer, integer); Type: FUNCTION; Schema: -; Owner: -
--

COMMENT ON FUNCTION validate_tracking_query_limits(integer, integer) IS 'Validates query limits to prevent DoS attacks via unbounded queries';

--
-- Name: fitness_activities_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE fitness_activities
ADD CONSTRAINT fitness_activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: fitness_records_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE fitness_records
ADD CONSTRAINT fitness_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: place_visits_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE place_visits
ADD CONSTRAINT place_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: place_visits_state_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE place_visits_state
ADD CONSTRAINT place_visits_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: poi_embeddings_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE poi_embeddings
ADD CONSTRAINT poi_embeddings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: tracker_daily_activity_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE tracker_daily_activity
ADD CONSTRAINT tracker_daily_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: tracker_daily_activity_state_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE tracker_daily_activity_state
ADD CONSTRAINT tracker_daily_activity_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: tracker_data_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE tracker_data
ADD CONSTRAINT tracker_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: transport_mode_state_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE transport_mode_state
ADD CONSTRAINT transport_mode_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: trips_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE trips
ADD CONSTRAINT trips_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: trip_embeddings_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE trip_embeddings
ADD CONSTRAINT trip_embeddings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: user_data_sampling_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE user_data_sampling
ADD CONSTRAINT user_data_sampling_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: user_preference_vectors_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE user_preference_vectors
ADD CONSTRAINT user_preference_vectors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: user_preferences_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE user_preferences
ADD CONSTRAINT user_preferences_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: user_profiles_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE user_profiles
ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: want_to_visit_places_user_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE want_to_visit_places
ADD CONSTRAINT want_to_visit_places_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

--
-- Name: trip_comments_entry_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE trip_comments
ADD CONSTRAINT trip_comments_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES trip_entries (id) ON DELETE CASCADE;

--
-- Name: trip_entries_cover_media_id_fkey; Type: CONSTRAINT; Schema: -; Owner: -
--

ALTER TABLE trip_entries
ADD CONSTRAINT trip_entries_cover_media_id_fkey FOREIGN KEY (cover_media_id) REFERENCES trip_media (id) ON DELETE SET NULL;

--
-- Name: trip_collaborators_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_collaborators_delete ON trip_collaborators FOR DELETE TO PUBLIC USING (EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_collaborators.trip_id) AND (trips.user_id = auth.uid()))));

--
-- Name: trip_collaborators_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_collaborators_insert ON trip_collaborators FOR INSERT TO PUBLIC WITH CHECK (EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_collaborators.trip_id) AND (trips.user_id = auth.uid()))));

--
-- Name: trip_collaborators_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_collaborators_select ON trip_collaborators FOR SELECT TO PUBLIC USING ((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_collaborators.trip_id) AND (trips.user_id = auth.uid())))));

--
-- Name: trip_comments_delete_owner; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_comments_delete_owner ON trip_comments FOR DELETE TO authenticated USING (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_comments.entry_id) AND (t.user_id = auth.uid()))));

--
-- Name: trip_comments_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_comments_insert ON trip_comments FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()) AND (entry_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_comments.entry_id) AND can_comment(t.id)))));

--
-- Name: trip_comments_owner_read; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_comments_owner_read ON trip_comments FOR SELECT TO PUBLIC USING (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_comments.entry_id) AND (t.user_id = auth.uid()))));

--
-- Name: trip_comments_shared_read; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_comments_shared_read ON trip_comments FOR SELECT TO PUBLIC USING (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_comments.entry_id) AND ((t.user_id = auth.uid()) OR (t.visibility = 'public')))));

--
-- Name: trip_entries_owner_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_entries_owner_insert ON trip_entries FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_entries.trip_id) AND (trips.user_id = auth.uid())))));

--
-- Name: trip_entries_shared_read; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_entries_shared_read ON trip_entries FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_entries.trip_id) AND ((trips.user_id = auth.uid()) OR (trips.visibility = 'public') OR (EXISTS ( SELECT 1 FROM trip_shares WHERE ((trip_shares.trip_id = trips.id) AND (trip_shares.shared_with_user_id = auth.uid())))))))) AND ((user_id = auth.uid()) OR (status = 'published')));

--
-- Name: trip_gps_tracks_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_gps_tracks_select ON trip_gps_tracks FOR SELECT TO PUBLIC USING ((user_id = auth.uid()) OR can_see_gps(trip_id));

--
-- Name: trip_likes_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_likes_insert ON trip_likes FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()) AND (entry_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_likes.entry_id) AND (t.visibility = 'public')))));

--
-- Name: trip_likes_owner_read; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_likes_owner_read ON trip_likes FOR SELECT TO PUBLIC USING (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_likes.entry_id) AND (t.user_id = auth.uid()))));

--
-- Name: trip_likes_shared_read; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_likes_shared_read ON trip_likes FOR SELECT TO PUBLIC USING (EXISTS ( SELECT 1 FROM (trip_entries te JOIN trips t ON ((t.id = te.trip_id))) WHERE ((te.id = trip_likes.entry_id) AND ((t.user_id = auth.uid()) OR (t.visibility = 'public')))));

--
-- Name: trip_media_owner_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_media_owner_insert ON trip_media FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_media.trip_id) AND (trips.user_id = auth.uid())))));

--
-- Name: trip_media_shared_read; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_media_shared_read ON trip_media FOR SELECT TO PUBLIC USING (EXISTS ( SELECT 1 FROM trips WHERE ((trips.id = trip_media.trip_id) AND ((trips.user_id = auth.uid()) OR (trips.visibility = 'public') OR (EXISTS ( SELECT 1 FROM trip_shares WHERE ((trip_shares.trip_id = trips.id) AND (trip_shares.shared_with_user_id = auth.uid()))))))));

--
-- Name: trip_plan_items_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_plan_items_select ON trip_plan_items FOR SELECT TO PUBLIC USING ((user_id = auth.uid()) OR (can_see_trip(trip_id) AND can_see_plan(trip_id)));

--
-- Name: trip_shares_delete; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_shares_delete ON trip_shares FOR DELETE TO PUBLIC USING (is_trip_owner(trip_id));

--
-- Name: trip_shares_insert; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_shares_insert ON trip_shares FOR INSERT TO PUBLIC WITH CHECK (is_trip_owner(trip_id));

--
-- Name: trip_shares_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trip_shares_select ON trip_shares FOR SELECT TO PUBLIC USING ((shared_with_user_id = auth.uid()) OR is_trip_owner(trip_id));

--
-- Name: trips_select; Type: POLICY; Schema: -; Owner: -
--

CREATE POLICY trips_select ON trips FOR SELECT TO PUBLIC USING ((user_id = auth.uid()) OR (visibility = 'public') OR (EXISTS ( SELECT 1 FROM trip_shares WHERE ((trip_shares.trip_id = trips.id) AND (trip_shares.shared_with_user_id = auth.uid())))) OR ((visibility = 'friends'::text) AND (auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1 FROM user_connections uc WHERE ((uc.status = 'accepted'::text) AND (((uc.user_id = auth.uid()) AND (uc.friend_id = trips.user_id)) OR ((uc.friend_id = auth.uid()) AND (uc.user_id = trips.user_id))))))));

--
-- Name: user_profiles_select_admin; Type: POLICY; Schema: -; Owner: -
--

-- JWT-claim check is primary (only trigger_sync_user_role writes it, and only
-- from legitimate profile changes since the bootstrap clamp); the table check
-- remains for service-side callers whose JWTs predate a role change.
CREATE POLICY user_profiles_select_admin ON user_profiles FOR SELECT TO PUBLIC USING (is_current_user_admin() OR auth.jwt() ->> 'role' = 'admin');

--
-- Name: tracker_data_distance_trigger; Type: TRIGGER; Schema: -; Owner: -
--

CREATE OR REPLACE TRIGGER tracker_data_distance_trigger
    BEFORE INSERT OR UPDATE ON tracker_data
    FOR EACH ROW
    EXECUTE FUNCTION trigger_calculate_distance();

--
-- Name: trigger_mark_setup_complete; Type: TRIGGER; Schema: -; Owner: -
--

CREATE OR REPLACE TRIGGER trigger_mark_setup_complete
    AFTER INSERT ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION mark_setup_complete();

--
-- Name: trigger_mark_setup_complete; Type: TRIGGER; Schema: -; Owner: -
--

COMMENT ON TRIGGER trigger_mark_setup_complete ON user_profiles IS 'Marks setup as complete when first user profile is created';

--
-- Name: trigger_prevent_role_escalation; Type: TRIGGER; Schema: -; Owner: -
--

CREATE OR REPLACE TRIGGER trigger_prevent_role_escalation
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION prevent_role_escalation();

--
-- Name: trigger_sync_user_role; Type: TRIGGER; Schema: -; Owner: -
--

CREATE OR REPLACE TRIGGER trigger_sync_user_role
    AFTER INSERT OR UPDATE OF role ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_role_to_auth();

--
-- Name: trigger_sync_user_role; Type: TRIGGER; Schema: -; Owner: -
--

COMMENT ON TRIGGER trigger_sync_user_role ON user_profiles IS 'Syncs user role from user_profiles.role to auth.users.role for JWT claims';

--
-- Name: trigger_update_want_to_visit_places_updated_at; Type: TRIGGER; Schema: -; Owner: -
--

CREATE OR REPLACE TRIGGER trigger_update_want_to_visit_places_updated_at
    BEFORE INSERT OR UPDATE ON want_to_visit_places
    FOR EACH ROW
    EXECUTE FUNCTION update_want_to_visit_places_updated_at();

--
-- Name: update_user_profiles_updated_at; Type: TRIGGER; Schema: -; Owner: -
--

CREATE OR REPLACE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profiles_updated_at();

--
-- Name: my_place_visits; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW my_place_visits WITH (security_barrier=true) AS
 SELECT id,
    started_at,
    duration_minutes,
    st_x(location::public.geometry) AS longitude,
    st_y(location::public.geometry) AS latitude,
    poi_name,
    poi_layer,
    poi_amenity,
    poi_cuisine,
    poi_sport,
    poi_category,
    confidence_score,
    avg_distance_meters,
    poi_tags,
    city,
    country_code,
    gps_points_count,
    visit_hour,
    visit_time_of_day,
    day_of_week,
    is_weekend,
    duration_category,
    alt_poi_name,
    alt_poi_amenity,
    alt_poi_cuisine,
    alt_poi_sport,
    alt_poi_distance,
    alt_poi_tags,
    alt_poi_confidence,
    created_at
   FROM place_visits
  WHERE user_id = auth.uid();


COMMENT ON VIEW my_place_visits IS 'Secure view of place_visits filtered to current user. Includes alternative POI for GPS inaccuracy visibility.';

--
-- Name: my_poi_summary; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW my_poi_summary WITH (security_barrier=true) AS
 SELECT poi_name,
    poi_amenity,
    poi_category,
    city,
    country_code,
    count(*)::integer AS visit_count,
    min(started_at) AS first_visit,
    max(started_at) AS last_visit,
    round(avg(duration_minutes))::integer AS avg_duration_minutes,
    sum(duration_minutes)::integer AS total_duration_minutes,
    min(started_at) AS started_at,
    mode() WITHIN GROUP (ORDER BY place_visits.poi_cuisine) FILTER (WHERE poi_cuisine IS NOT NULL) AS poi_cuisine,
    mode() WITHIN GROUP (ORDER BY place_visits.poi_sport) FILTER (WHERE poi_sport IS NOT NULL) AS poi_sport,
    jsonb_build_object('outdoor_seating', bool_or(((poi_tags -> 'osm'::text) ->> 'outdoor_seating'::text) = 'yes'::text), 'wifi', bool_or((((poi_tags -> 'osm'::text) ->> 'internet_access'::text) = ANY (ARRAY['yes'::text, 'wlan'::text, 'wifi'::text])) OR ((poi_tags -> 'osm'::text) ->> 'wifi'::text) = 'yes'::text), 'wheelchair', bool_or(((poi_tags -> 'osm'::text) ->> 'wheelchair'::text) = ANY (ARRAY['yes'::text, 'limited'::text])), 'takeaway', bool_or(((poi_tags -> 'osm'::text) ->> 'takeaway'::text) = ANY (ARRAY['yes'::text, 'only'::text])), 'delivery', bool_or(((poi_tags -> 'osm'::text) ->> 'delivery'::text) = 'yes'::text), 'smoking', bool_or(((poi_tags -> 'osm'::text) ->> 'smoking'::text) = ANY (ARRAY['yes'::text, 'outside'::text, 'separated'::text])), 'air_conditioning', bool_or(((poi_tags -> 'osm'::text) ->> 'air_conditioning'::text) = 'yes'::text)) AS osm_amenities,
    jsonb_build_object('morning', count(*) FILTER (WHERE visit_hour >= 6 AND visit_hour <= 11), 'afternoon', count(*) FILTER (WHERE visit_hour >= 12 AND visit_hour <= 17), 'evening', count(*) FILTER (WHERE visit_hour >= 18 AND visit_hour <= 23), 'night', count(*) FILTER (WHERE visit_hour >= 0 AND visit_hour <= 5)) AS time_pattern,
    jsonb_build_object('weekend_visits', count(*) FILTER (WHERE is_weekend = true), 'weekday_visits', count(*) FILTER (WHERE is_weekend = false)) AS day_pattern
   FROM place_visits
  WHERE user_id = auth.uid()
  GROUP BY poi_name, poi_amenity, poi_category, city, country_code;


COMMENT ON VIEW my_poi_summary IS 'Aggregated POI visit statistics per user with semantic enrichment. Includes cuisine, amenities, and time patterns for embedding generation.';

--
-- Name: my_tracker_data; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW my_tracker_data WITH (security_barrier=true, security_invoker=true) AS
 SELECT recorded_at,
    st_x(location::public.geometry) AS longitude,
    st_y(location::public.geometry) AS latitude,
    country_code,
    geocode,
    accuracy,
    transport_mode,
    detection_reason,
    transport_mode_confidence,
    transport_mode_manual,
    created_at,
    recorded_at AS started_at
   FROM tracker_data
  WHERE user_id = auth.uid();


COMMENT ON VIEW my_tracker_data IS 'Secure view of tracker_data filtered to current user. Use this for LLM queries.';

--
-- Name: my_trip_entries; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW my_trip_entries AS
 SELECT te.id,
    te.trip_id,
    te.user_id,
    te.title,
    te.body,
    te.blocks,
    te.entry_date,
    te.end_date,
    te.created_at,
    te.updated_at,
    t.title AS trip_title,
    t.start_date AS trip_start,
    t.end_date AS trip_end,
    t.image_url AS trip_image_url
   FROM trip_entries te
     JOIN trips t ON t.id = te.trip_id
  WHERE te.user_id = auth.uid();

--
-- Name: my_trips; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW my_trips WITH (security_barrier=true, security_invoker=true) AS
 SELECT id,
    title,
    description,
    start_date,
    end_date,
    status,
    image_url,
    labels,
    metadata,
    (metadata ->> 'dataPoints'::text)::integer AS data_points,
    (metadata ->> 'tripDays'::text)::integer AS trip_days,
    metadata ->> 'primaryCity'::text AS primary_city,
    metadata ->> 'primaryCountryCode'::text AS primary_country_code,
    array_to_string(ARRAY( SELECT jsonb_array_elements_text(trips.metadata -> 'visitedCities'::text) AS jsonb_array_elements_text), ', '::text) AS visited_cities,
    array_to_string(ARRAY( SELECT jsonb_array_elements_text(trips.metadata -> 'visitedCountryCodes'::text) AS jsonb_array_elements_text), ', '::text) AS visited_country_codes,
    created_at,
    updated_at,
    start_date AS started_at
   FROM trips
  WHERE user_id = auth.uid() AND (status = ANY (ARRAY['active'::text, 'planned'::text, 'completed'::text]));


COMMENT ON VIEW my_trips IS 'Secure view of trips filtered to current user. Use this for LLM queries.';

-- ponytail: pending (auto-detected) trips are excluded from my_trips so that
-- trip counts/summaries don't include un-confirmed detections. This separate
-- view exposes them (same columns as my_trips) so the assistant can describe
-- and act on detected trip suggestions. Mirrors the UI's loadPendingTrips split.
CREATE OR REPLACE VIEW my_pending_trips WITH (security_barrier=true, security_invoker=true) AS
 SELECT id,
    title,
    description,
    start_date,
    end_date,
    status,
    image_url,
    labels,
    metadata,
    (metadata ->> 'dataPoints'::text)::integer AS data_points,
    (metadata ->> 'tripDays'::text)::integer AS trip_days,
    metadata ->> 'primaryCity'::text AS primary_city,
    metadata ->> 'primaryCountryCode'::text AS primary_country_code,
    array_to_string(ARRAY( SELECT jsonb_array_elements_text(trips.metadata -> 'visitedCities'::text) AS jsonb_array_elements_text), ', '::text) AS visited_cities,
    array_to_string(ARRAY( SELECT jsonb_array_elements_text(trips.metadata -> 'visitedCountryCodes'::text) AS jsonb_array_elements_text), ', '::text) AS visited_country_codes,
    created_at,
    updated_at,
    start_date AS started_at
   FROM trips
  WHERE user_id = auth.uid() AND status = 'pending'::text;


COMMENT ON VIEW my_pending_trips IS 'Secure view of the current user''s auto-detected (pending) trips. Use for surfacing trip suggestions to approve/reject.';

--
-- Name: public_profiles; Type: VIEW; Schema: -; Owner: -
--

-- ponytail: this view is security_definer (the default) so it bypasses the
-- underlying user_profiles RLS (which is owner-only). That's intentional —
-- public_profiles exists to let anyone (anon + authenticated) browse the
-- community directory. The WHERE filter excludes users who opted out
-- (discoverable = 'nobody'); the is_discoverable_to() function handles the
-- friends_of_friends nuance downstream in the travelers query.
CREATE OR REPLACE VIEW public_profiles AS
 SELECT id,
    username,
    first_name,
    full_name,
    avatar_url,
    cover_photo_url,
    cover_focal_x,
    cover_focal_y,
    discoverable
   FROM user_profiles
  WHERE username IS NOT NULL AND discoverable <> 'nobody';

--
-- Name: public_trip_entries; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW public_trip_entries AS
 SELECT e.id,
    e.trip_id,
    e.user_id AS trip_user_id,
    e.title,
    e.body,
    e.entry_date,
    e.end_date,
    t.title AS trip_title,
    t.description AS trip_description,
    t.image_url AS trip_image_url,
    t.user_id AS trip_owner_id,
    t.start_date AS trip_start,
    t.end_date AS trip_end,
    t.visibility AS trip_visibility,
    e.cover_media_id,
    e.blocks
   FROM trip_entries e
     JOIN trips t ON t.id = e.trip_id
  WHERE e.status = 'published'::text AND (t.user_id = auth.uid() OR t.visibility = 'public'::text OR (EXISTS ( SELECT 1
           FROM trip_shares
          WHERE trip_shares.trip_id = t.id AND trip_shares.shared_with_user_id = auth.uid())) OR (t.visibility = 'friends'::text AND auth.uid() IS NOT NULL AND EXISTS ( SELECT 1
           FROM user_connections uc
          WHERE uc.status = 'accepted'::text AND ((uc.user_id = auth.uid() AND uc.friend_id = t.user_id) OR (uc.friend_id = auth.uid() AND uc.user_id = t.user_id)))));

--
-- Name: public_trip_media; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW public_trip_media AS
 SELECT id,
    trip_id,
    user_id,
    storage_path,
    thumbnail_path,
    width,
    height,
    sort_order,
    created_at
   FROM trip_media m
  WHERE (EXISTS ( SELECT 1
           FROM trips t
          WHERE t.id = m.trip_id AND (t.user_id = auth.uid() OR t.visibility = 'public'::text OR (EXISTS ( SELECT 1
                   FROM trip_shares
                  WHERE trip_shares.trip_id = t.id AND trip_shares.shared_with_user_id = auth.uid())) OR (t.visibility = 'friends'::text AND auth.uid() IS NOT NULL AND EXISTS ( SELECT 1
                   FROM user_connections uc
                  WHERE uc.status = 'accepted'::text AND ((uc.user_id = auth.uid() AND uc.friend_id = t.user_id) OR (uc.friend_id = auth.uid() AND uc.user_id = t.user_id)))))));

--
-- Name: public_fitness_activities; Type: VIEW; Schema: -; Owner: -
--

-- Public-surface projection of shared fitness activities. Column allowlist:
-- excludes health metrics (avg/max heart rate, power, cadence) and device
-- identity (serial_number, source_file) — the public page shows summary,
-- track, and speed only. Access-gated by can_see_activity(); anon viewers
-- effectively see only effective-visibility 'public' rows.
CREATE OR REPLACE VIEW public_fitness_activities AS
 SELECT fa.id,
    fa.user_id,
    fa.title,
    fa.description,
    fa.sport,
    fa.sub_sport,
    fa.started_at,
    fa.ended_at,
    fa.total_distance_m,
    fa.elapsed_time_s,
    fa.moving_time_s,
    fa.calories,
    effective_activity_visibility(fa.id) AS effective_visibility
   FROM fitness_activities fa
  WHERE can_see_activity(fa.id);

--
-- Name: visible_plan_items; Type: VIEW; Schema: -; Owner: -
--

CREATE OR REPLACE VIEW visible_plan_items AS
 SELECT id,
    trip_id,
    user_id,
    day_number,
    sort_order,
    title,
    description,
    type,
    start_time,
    end_time,
    location_lat,
    location_lng,
    address,
    booking_url,
    booking_status,
    want_to_visit_id,
    notes,
    created_by,
    created_at,
    updated_at,
        CASE
            WHEN can_see_costs(trip_id) THEN cost_estimate
            ELSE NULL::numeric
        END AS cost_estimate,
        CASE
            WHEN can_see_costs(trip_id) THEN currency
            ELSE NULL::text
        END AS currency
   FROM trip_plan_items tpi
  WHERE can_see_trip(trip_id) AND can_see_plan(trip_id);

--
-- Name: MAX_PLAUSIBLE_SPEED_KMH(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION MAX_PLAUSIBLE_SPEED_KMH() TO service_role;

--
-- Name: MAX_PLAUSIBLE_SPEED_KMH(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION MAX_PLAUSIBLE_SPEED_KMH() TO tenant_migration_role;

--
-- Name: MAX_PLAUSIBLE_SPEED_KMH(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION MAX_PLAUSIBLE_SPEED_KMH() TO tenant_service;

--
-- Name: calculate_distances_batch_v2(p_user_id uuid, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_distances_batch_v2(p_user_id uuid, p_offset integer, p_limit integer) TO service_role;

--
-- Name: calculate_distances_batch_v2(p_user_id uuid, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_distances_batch_v2(p_user_id uuid, p_offset integer, p_limit integer) TO tenant_migration_role;

--
-- Name: calculate_distances_batch_v2(p_user_id uuid, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_distances_batch_v2(p_user_id uuid, p_offset integer, p_limit integer) TO tenant_service;

--
-- Name: calculate_mode_aware_speed(user_id_param uuid, recorded_at_param timestamp with time zone, transport_mode text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_mode_aware_speed(user_id_param uuid, recorded_at_param timestamp with time zone, transport_mode text) TO service_role;

--
-- Name: calculate_mode_aware_speed(user_id_param uuid, recorded_at_param timestamp with time zone, transport_mode text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_mode_aware_speed(user_id_param uuid, recorded_at_param timestamp with time zone, transport_mode text) TO tenant_migration_role;

--
-- Name: calculate_mode_aware_speed(user_id_param uuid, recorded_at_param timestamp with time zone, transport_mode text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_mode_aware_speed(user_id_param uuid, recorded_at_param timestamp with time zone, transport_mode text) TO tenant_service;

--
-- Name: calculate_stable_speed(user_id_param uuid, recorded_at_param timestamp with time zone, window_size integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_stable_speed(user_id_param uuid, recorded_at_param timestamp with time zone, window_size integer) TO service_role;

--
-- Name: calculate_stable_speed(user_id_param uuid, recorded_at_param timestamp with time zone, window_size integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_stable_speed(user_id_param uuid, recorded_at_param timestamp with time zone, window_size integer) TO tenant_migration_role;

--
-- Name: calculate_stable_speed(user_id_param uuid, recorded_at_param timestamp with time zone, window_size integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION calculate_stable_speed(user_id_param uuid, recorded_at_param timestamp with time zone, window_size integer) TO tenant_service;

--
-- Name: can_comment(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_comment(trip_uuid uuid) TO service_role;

--
-- Name: can_comment(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_comment(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: can_comment(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_comment(trip_uuid uuid) TO tenant_service;

--
-- Name: can_see_costs(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_costs(trip_uuid uuid) TO service_role;

--
-- Name: can_see_costs(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_costs(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: can_see_costs(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_costs(trip_uuid uuid) TO tenant_service;

--
-- Name: can_see_gps(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_gps(trip_uuid uuid) TO service_role;

--
-- Name: can_see_gps(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_gps(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: can_see_gps(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_gps(trip_uuid uuid) TO tenant_service;

--
-- Name: can_see_plan(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_plan(trip_uuid uuid) TO service_role;

--
-- Name: can_see_plan(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_plan(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: can_see_plan(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_plan(trip_uuid uuid) TO tenant_service;

--
-- Name: can_see_trip(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_trip(trip_uuid uuid) TO service_role;

--
-- Name: can_see_trip(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_trip(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: can_see_trip(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION can_see_trip(trip_uuid uuid) TO tenant_service;

--
-- Name: disable_tracker_data_trigger(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION disable_tracker_data_trigger() TO service_role;

--
-- Name: disable_tracker_data_trigger(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION disable_tracker_data_trigger() TO tenant_migration_role;

--
-- Name: disable_tracker_data_trigger(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION disable_tracker_data_trigger() TO tenant_service;

--
-- Name: enable_tracker_data_trigger(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION enable_tracker_data_trigger() TO service_role;

--
-- Name: enable_tracker_data_trigger(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION enable_tracker_data_trigger() TO tenant_migration_role;

--
-- Name: enable_tracker_data_trigger(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION enable_tracker_data_trigger() TO tenant_service;

--
-- Name: find_similar_users_by_preference(p_user_id uuid, p_preference_type text, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION find_similar_users_by_preference(p_user_id uuid, p_preference_type text, p_limit integer, p_min_similarity numeric) TO service_role;

--
-- Name: find_similar_users_by_preference(p_user_id uuid, p_preference_type text, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION find_similar_users_by_preference(p_user_id uuid, p_preference_type text, p_limit integer, p_min_similarity numeric) TO tenant_migration_role;

--
-- Name: find_similar_users_by_preference(p_user_id uuid, p_preference_type text, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION find_similar_users_by_preference(p_user_id uuid, p_preference_type text, p_limit integer, p_min_similarity numeric) TO tenant_service;

--
-- Name: full_country(country text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION full_country(country text) TO authenticated;

--
-- Name: full_country(country text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION full_country(country text) TO service_role;

--
-- Name: full_country(country text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION full_country(country text) TO tenant_migration_role;

--
-- Name: full_country(country text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION full_country(country text) TO tenant_service;

--
-- Name: get_embedding_stats(p_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--


--
-- Name: get_embedding_stats(p_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_embedding_stats(p_user_id uuid) TO service_role;

--
-- Name: get_embedding_stats(p_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_embedding_stats(p_user_id uuid) TO tenant_migration_role;

--
-- Name: get_embedding_stats(p_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_embedding_stats(p_user_id uuid) TO tenant_service;

--
-- Name: get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid) TO authenticated;

--
-- Name: get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid) TO service_role;

--
-- Name: get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid) TO tenant_migration_role;

--
-- Name: get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_points_within_radius(center_lat double precision, center_lon double precision, radius_meters double precision, user_uuid uuid) TO tenant_service;

--
-- Name: get_public_trip_track(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_trip_track(trip_uuid uuid) TO anon;

--
-- Name: get_public_activity_track(activity_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_activity_track(activity_uuid uuid) TO anon;

--
-- Name: get_public_activity_track(activity_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_activity_track(activity_uuid uuid) TO authenticated;

--
-- Name: get_public_activity_track(activity_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_activity_track(activity_uuid uuid) TO service_role;

--
-- Name: get_public_activity_track(activity_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_activity_track(activity_uuid uuid) TO tenant_migration_role;

--
-- Name: get_public_activity_track(activity_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_activity_track(activity_uuid uuid) TO tenant_service;

--
-- Name: get_public_trip_track(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_trip_track(trip_uuid uuid) TO authenticated;

--
-- Name: get_public_trip_track(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_trip_track(trip_uuid uuid) TO service_role;

--
-- Name: get_public_trip_track(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_trip_track(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: get_public_trip_track(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_public_trip_track(trip_uuid uuid) TO tenant_service;

--
-- Name: get_shared_trip(p_token text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_shared_trip(p_token text) TO anon;

--
-- Name: get_shared_trip(p_token text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_shared_trip(p_token text) TO authenticated;

--
-- Name: get_shared_trip(p_token text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_shared_trip(p_token text) TO service_role;

--
-- Name: get_shared_trip(p_token text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_shared_trip(p_token text) TO tenant_migration_role;

--
-- Name: get_shared_trip(p_token text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_shared_trip(p_token text) TO tenant_service;

--
-- Name: get_user_preferences(p_user_id uuid, p_preference_type text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_preferences(p_user_id uuid, p_preference_type text) TO authenticated;

--
-- Name: get_user_preferences(p_user_id uuid, p_preference_type text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_preferences(p_user_id uuid, p_preference_type text) TO service_role;

--
-- Name: get_user_preferences(p_user_id uuid, p_preference_type text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_preferences(p_user_id uuid, p_preference_type text) TO tenant_migration_role;

--
-- Name: get_user_preferences(p_user_id uuid, p_preference_type text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_preferences(p_user_id uuid, p_preference_type text) TO tenant_service;

--
-- Name: get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer) TO authenticated;

--
-- Name: get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer) TO service_role;

--
-- Name: get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer) TO tenant_migration_role;

--
-- Name: get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION get_user_tracking_data(user_uuid uuid, start_date timestamp with time zone, end_date timestamp with time zone, limit_count integer) TO tenant_service;

--
-- Name: handle_new_user(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION handle_new_user() TO service_role;

--
-- Name: handle_new_user(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION handle_new_user() TO tenant_migration_role;

--
-- Name: handle_new_user(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION handle_new_user() TO tenant_service;

--
-- Name: is_current_user_admin(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_current_user_admin() TO service_role;

--
-- Name: is_current_user_admin(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_current_user_admin() TO tenant_migration_role;

--
-- Name: is_current_user_admin(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_current_user_admin() TO tenant_service;

--
-- Name: is_trip_owner(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_trip_owner(trip_uuid uuid) TO service_role;

--
-- Name: is_trip_owner(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_trip_owner(trip_uuid uuid) TO tenant_migration_role;

--
-- Name: is_trip_owner(trip_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_trip_owner(trip_uuid uuid) TO tenant_service;

--
-- Name: is_user_admin(user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_user_admin(user_uuid uuid) TO authenticated;

--
-- Name: is_user_admin(user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_user_admin(user_uuid uuid) TO service_role;

--
-- Name: is_user_admin(user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_user_admin(user_uuid uuid) TO tenant_migration_role;

--
-- Name: is_user_admin(user_uuid uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION is_user_admin(user_uuid uuid) TO tenant_service;

--
-- Name: mark_setup_complete(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION mark_setup_complete() TO service_role;

--
-- Name: mark_setup_complete(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION mark_setup_complete() TO tenant_migration_role;

--
-- Name: mark_setup_complete(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION mark_setup_complete() TO tenant_service;

--
-- Name: perform_bulk_import_with_distance_calculation(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION perform_bulk_import_with_distance_calculation(target_user_id uuid) TO service_role;

--
-- Name: perform_bulk_import_with_distance_calculation(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION perform_bulk_import_with_distance_calculation(target_user_id uuid) TO tenant_migration_role;

--
-- Name: perform_bulk_import_with_distance_calculation(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION perform_bulk_import_with_distance_calculation(target_user_id uuid) TO tenant_service;

--
-- Name: prevent_role_escalation(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION prevent_role_escalation() TO service_role;

--
-- Name: prevent_role_escalation(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION prevent_role_escalation() TO tenant_migration_role;

--
-- Name: prevent_role_escalation(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION prevent_role_escalation() TO tenant_service;

--
-- Name: refresh_place_visits(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION refresh_place_visits() TO authenticated;

--
-- Name: refresh_place_visits(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION refresh_place_visits() TO service_role;

--
-- Name: refresh_place_visits(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION refresh_place_visits() TO tenant_migration_role;

--
-- Name: refresh_place_visits(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION refresh_place_visits() TO tenant_service;

--
-- Name: remove_duplicate_tracking_points(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION remove_duplicate_tracking_points(target_user_id uuid) TO service_role;

--
-- Name: remove_duplicate_tracking_points(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION remove_duplicate_tracking_points(target_user_id uuid) TO tenant_migration_role;

--
-- Name: remove_duplicate_tracking_points(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION remove_duplicate_tracking_points(target_user_id uuid) TO tenant_service;

--
-- Name: resolve_country_code(input text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION resolve_country_code(input text) TO authenticated;

--
-- Name: resolve_country_code(input text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION resolve_country_code(input text) TO service_role;

--
-- Name: resolve_country_code(input text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION resolve_country_code(input text) TO tenant_migration_role;

--
-- Name: resolve_country_code(input text); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION resolve_country_code(input text) TO tenant_service;

--
-- Name: sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--


--
-- Name: sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer) TO service_role;

--
-- Name: sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer) TO tenant_migration_role;

--
-- Name: sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION sample_tracker_data_if_needed(p_target_user_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_max_points_threshold integer, p_min_distance_meters numeric, p_min_time_minutes numeric, p_max_points_per_hour integer, p_offset integer, p_limit integer) TO tenant_service;

--
-- Name: search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--


--
-- Name: search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric) TO service_role;

--
-- Name: search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric) TO tenant_migration_role;

--
-- Name: search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION search_similar_pois(query_embedding public.vector, p_user_id uuid, p_limit integer, p_poi_category text, p_poi_cuisine text, p_city text, p_country_code character varying, p_min_similarity numeric) TO tenant_service;

--
-- Name: search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--


--
-- Name: search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric) TO service_role;

--
-- Name: search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric) TO tenant_migration_role;

--
-- Name: search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION search_similar_trips(query_embedding public.vector, p_user_id uuid, p_limit integer, p_min_similarity numeric) TO tenant_service;

--
-- Name: set_first_user_admin(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION set_first_user_admin() TO service_role;

--
-- Name: set_first_user_admin(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION set_first_user_admin() TO tenant_migration_role;

--
-- Name: set_first_user_admin(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION set_first_user_admin() TO tenant_service;

--
-- Name: st_distancesphere(geog1 public.geography, geog2 public.geography); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geog1 public.geography, geog2 public.geography) TO authenticated;

--
-- Name: st_distancesphere(geog1 public.geography, geog2 public.geography); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geog1 public.geography, geog2 public.geography) TO service_role;

--
-- Name: st_distancesphere(geog1 public.geography, geog2 public.geography); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geog1 public.geography, geog2 public.geography) TO tenant_migration_role;

--
-- Name: st_distancesphere(geog1 public.geography, geog2 public.geography); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geog1 public.geography, geog2 public.geography) TO tenant_service;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry) TO authenticated;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry) TO service_role;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry) TO tenant_migration_role;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry) TO tenant_service;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry, radius double precision); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry, radius double precision) TO service_role;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry, radius double precision); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry, radius double precision) TO tenant_migration_role;

--
-- Name: st_distancesphere(geom1 public.geometry, geom2 public.geometry, radius double precision); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION st_distancesphere(geom1 public.geometry, geom2 public.geometry, radius double precision) TO tenant_service;

--
-- Name: sync_user_role_to_auth(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION sync_user_role_to_auth() TO service_role;

--
-- Name: sync_user_role_to_auth(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION sync_user_role_to_auth() TO tenant_migration_role;

--
-- Name: sync_user_role_to_auth(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION sync_user_role_to_auth() TO tenant_service;

--
-- Name: trigger_calculate_distance(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION trigger_calculate_distance() TO service_role;

--
-- Name: trigger_calculate_distance(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION trigger_calculate_distance() TO tenant_migration_role;

--
-- Name: trigger_calculate_distance(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION trigger_calculate_distance() TO tenant_service;

--
-- Name: trigger_calculate_distance_enhanced(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION trigger_calculate_distance_enhanced() TO service_role;

--
-- Name: trigger_calculate_distance_enhanced(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION trigger_calculate_distance_enhanced() TO tenant_migration_role;

--
-- Name: trigger_calculate_distance_enhanced(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION trigger_calculate_distance_enhanced() TO tenant_service;

--
-- Name: update_tracker_distances(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances(target_user_id uuid) TO service_role;

--
-- Name: update_tracker_distances(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances(target_user_id uuid) TO tenant_migration_role;

--
-- Name: update_tracker_distances(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances(target_user_id uuid) TO tenant_service;

--
-- Name: update_tracker_distances_batch(target_user_id uuid, batch_size integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_batch(target_user_id uuid, batch_size integer) TO service_role;

--
-- Name: update_tracker_distances_batch(target_user_id uuid, batch_size integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_batch(target_user_id uuid, batch_size integer) TO tenant_migration_role;

--
-- Name: update_tracker_distances_batch(target_user_id uuid, batch_size integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_batch(target_user_id uuid, batch_size integer) TO tenant_service;

--
-- Name: update_tracker_distances_enhanced(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_enhanced(target_user_id uuid) TO service_role;

--
-- Name: update_tracker_distances_enhanced(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_enhanced(target_user_id uuid) TO tenant_migration_role;

--
-- Name: update_tracker_distances_enhanced(target_user_id uuid); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_enhanced(target_user_id uuid) TO tenant_service;

--
-- Name: update_tracker_distances_small_batch(target_user_id uuid, max_records integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_small_batch(target_user_id uuid, max_records integer) TO service_role;

--
-- Name: update_tracker_distances_small_batch(target_user_id uuid, max_records integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_small_batch(target_user_id uuid, max_records integer) TO tenant_migration_role;

--
-- Name: update_tracker_distances_small_batch(target_user_id uuid, max_records integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_tracker_distances_small_batch(target_user_id uuid, max_records integer) TO tenant_service;

--
-- Name: update_user_profiles_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_user_profiles_updated_at() TO service_role;

--
-- Name: update_user_profiles_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_user_profiles_updated_at() TO tenant_migration_role;

--
-- Name: update_user_profiles_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_user_profiles_updated_at() TO tenant_service;

--
-- Name: update_want_to_visit_places_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_want_to_visit_places_updated_at() TO service_role;

--
-- Name: update_want_to_visit_places_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_want_to_visit_places_updated_at() TO tenant_migration_role;

--
-- Name: update_want_to_visit_places_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_want_to_visit_places_updated_at() TO tenant_service;

--
-- Name: update_workers_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_workers_updated_at() TO service_role;

--
-- Name: update_workers_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_workers_updated_at() TO tenant_migration_role;

--
-- Name: update_workers_updated_at(); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION update_workers_updated_at() TO tenant_service;

--
-- Name: validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer) TO authenticated;

--
-- Name: validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer) TO service_role;

--
-- Name: validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer) TO tenant_migration_role;

--
-- Name: validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer); Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT EXECUTE ON FUNCTION validate_tracking_query_limits(p_limit integer, p_max_points_threshold integer) TO tenant_service;

--
-- Name: country_name_aliases; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE country_name_aliases TO authenticated;

--
-- Name: fitness_activities; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE fitness_activities TO authenticated;

--
-- Name: fitness_records; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE fitness_records TO authenticated;

--
-- Name: place_visits; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE place_visits TO authenticated;

--
-- Name: place_visits; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE place_visits TO tenant_service;

--
-- Name: place_visits_state; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE place_visits_state TO authenticated;

--
-- Name: poi_embeddings; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE poi_embeddings TO authenticated;

--
-- Name: notifications; Type: PRIVILEGE; Schema: privileges; Owner: -
--

-- notifications: owner-private, no anon access (fed by the client job-store).
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE notifications TO authenticated;

--
-- Name: tracker_daily_activity; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT INSERT, SELECT, UPDATE ON TABLE tracker_daily_activity TO authenticated;

--
-- Name: tracker_daily_activity_state; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT INSERT, SELECT, UPDATE ON TABLE tracker_daily_activity_state TO authenticated;

--
-- Name: tracker_data; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE tracker_data TO authenticated;

--
-- Name: transport_mode_state; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE transport_mode_state TO authenticated;

--
-- Name: trip_collaborators; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trip_collaborators TO anon;

--
-- Name: trip_collaborators; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_collaborators TO authenticated;

--
-- Name: trip_comments; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trip_comments TO anon;

--
-- Name: trip_comments; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_comments TO authenticated;

--
-- Name: trip_embeddings; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_embeddings TO authenticated;

--
-- Name: trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trip_entries TO anon;

--
-- Name: trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_entries TO authenticated;

--
-- Name: trip_gps_tracks; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT ON TABLE trip_gps_tracks TO authenticated;

--
-- Name: trip_likes; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trip_likes TO anon;

--
-- Name: trip_likes; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_likes TO authenticated;

--
-- Name: trip_media; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trip_media TO anon;

--
-- Name: trip_media; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_media TO authenticated;

--
-- Name: trip_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trip_plan_items TO anon;

--
-- Name: trip_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_plan_items TO authenticated;

--
-- Name: trip_shares; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trip_shares TO authenticated;

--
-- Name: trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE trips TO anon;

--
-- Name: trip_shares; Type: PRIVILEGE; Schema: privileges; Owner: -
--
-- Readable by anon so the trips_select policy's trip_shares subquery is
-- evaluable for anonymous visitors (RLS still hides every row from them).
GRANT SELECT ON TABLE trip_shares TO anon;

--
-- Name: user_connections; Type: PRIVILEGE; Schema: privileges; Owner: -
--
-- Readable by anon for the same reason (friends checks inside trips_select;
-- RLS hides every row from anonymous callers).
GRANT SELECT ON TABLE user_connections TO anon;

--
-- Name: trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE trips TO authenticated;

--
-- Name: user_connections; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE user_connections TO authenticated;

--
-- Name: user_data_sampling; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE user_data_sampling TO authenticated;

--
-- Name: user_preference_vectors; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE user_preference_vectors TO authenticated;

--
-- Name: user_preferences; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE user_preferences TO authenticated;

--
-- Name: user_profiles; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE user_profiles TO authenticated;

--
-- Name: want_to_visit_places; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE want_to_visit_places TO authenticated;

--
-- Name: my_place_visits; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE my_place_visits TO authenticated;

--
-- Name: my_place_visits; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_place_visits TO service_role;

--
-- Name: my_place_visits; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_place_visits TO tenant_migration_role;

--
-- Name: my_place_visits; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE my_place_visits TO tenant_service;

--
-- Name: my_poi_summary; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE my_poi_summary TO authenticated;

--
-- Name: my_poi_summary; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_poi_summary TO service_role;

--
-- Name: my_poi_summary; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_poi_summary TO tenant_migration_role;

--
-- Name: my_poi_summary; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE my_poi_summary TO tenant_service;

--
-- Name: my_tracker_data; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE my_tracker_data TO authenticated;

--
-- Name: my_tracker_data; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_tracker_data TO service_role;

--
-- Name: my_tracker_data; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_tracker_data TO tenant_migration_role;

--
-- Name: my_tracker_data; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE my_tracker_data TO tenant_service;

--
-- Name: my_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE my_trip_entries TO authenticated;

--
-- Name: my_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_trip_entries TO service_role;

--
-- Name: my_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_trip_entries TO tenant_migration_role;

--
-- Name: my_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE my_trip_entries TO tenant_service;

--
-- Name: my_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE my_trips TO authenticated;

--
-- Name: my_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_trips TO service_role;

--
-- Name: my_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_trips TO tenant_migration_role;

--
-- Name: my_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE my_trips TO tenant_service;

--
-- Name: my_pending_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE my_pending_trips TO authenticated;

--
-- Name: my_pending_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE my_pending_trips TO service_role;

--
-- Name: my_pending_trips; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE my_pending_trips TO tenant_service;

--
-- Name: public_profiles; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE public_profiles TO anon;

--
-- Name: public_fitness_activities; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE public_fitness_activities TO anon;

--
-- Name: public_fitness_activities; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE public_fitness_activities TO authenticated;

--
-- Name: public_profiles; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE public_profiles TO authenticated;

--
-- Name: public_profiles; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public_profiles TO service_role;

--
-- Name: public_fitness_activities; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE public_fitness_activities TO service_role;

--
-- Name: public_profiles; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public_profiles TO tenant_migration_role;

--
-- Name: public_profiles; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public_profiles TO tenant_service;

--
-- Name: public_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public_trip_entries TO service_role;

--
-- Name: public_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public_trip_entries TO tenant_migration_role;

--
-- Name: public_trip_entries; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public_trip_entries TO tenant_service;

--
-- Name: public_trip_media; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public_trip_media TO service_role;

--
-- Name: public_trip_media; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public_trip_media TO tenant_migration_role;

--
-- Name: public_trip_media; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public_trip_media TO tenant_service;

--
-- Name: visible_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE visible_plan_items TO anon;

--
-- Name: visible_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT SELECT ON TABLE visible_plan_items TO authenticated;

--
-- Name: visible_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE visible_plan_items TO service_role;

--
-- Name: visible_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE visible_plan_items TO tenant_migration_role;

--
-- Name: visible_plan_items; Type: PRIVILEGE; Schema: privileges; Owner: -
--

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE visible_plan_items TO tenant_service;




--
-- Name: device_tokens; Type: TABLE; Schema: public
--

CREATE TABLE IF NOT EXISTS device_tokens (
    id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    label text NOT NULL DEFAULT 'Android',
    token_hash text NOT NULL,
    scopes text[] DEFAULT ARRAY['gps:write']::text[],
    last_used_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT device_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);


COMMENT ON TABLE device_tokens IS 'Scoped device tokens for GPS tracker authentication. The Wayli app authenticates point submissions with wayli_dt_ tokens (SHA-256 hash stored, plaintext shown once at creation).';

COMMENT ON COLUMN device_tokens.token_hash IS 'SHA-256 hex digest of the wayli_dt_ token. The plaintext is never stored server-side.';

COMMENT ON COLUMN device_tokens.scopes IS 'Token permission scopes. gps:write allows posting location points only.';


--
-- Name: idx_device_tokens_user_id; Type: INDEX
--

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens (user_id);


--
-- Name: idx_device_tokens_token_hash; Type: INDEX
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_token_hash ON device_tokens (token_hash);


--
-- Row Level Security for device_tokens
--

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Admin users full access to device_tokens" ON device_tokens TO authenticated USING ((auth.jwt() ->> 'role') = 'admin') WITH CHECK ((auth.jwt() ->> 'role') = 'admin');


CREATE POLICY "Service role full access to device_tokens" ON device_tokens TO service_role USING (true) WITH CHECK (true);


CREATE POLICY "Tenant service full access to device_tokens" ON device_tokens TO tenant_service USING (true) WITH CHECK (true);


CREATE POLICY "Users can view own device_tokens" ON device_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);


CREATE POLICY "Users can create own device_tokens" ON device_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);


CREATE POLICY "Users can update own device_tokens" ON device_tokens FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


--
-- Privileges for device_tokens
--


GRANT SELECT ON TABLE device_tokens TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE device_tokens TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE device_tokens TO tenant_migration_role;

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE device_tokens TO tenant_service;

--
-- Function ACL hardening
--
-- PostgreSQL grants EXECUTE to PUBLIC by default. The Fluxbase RPC API does
-- not call schema functions directly (registered procedures run their own
-- SQL with RLS context), but we revoke PUBLIC and grant explicitly so a
-- future RPC wrapper or direct DB role cannot reach sensitive helpers by
-- accident. RLS-policy helpers are granted to every client role because
-- policies execute them with the calling user's privileges.

-- RLS policy helpers: callable by all client roles (policies invoke them),
-- no longer by an accidental PUBLIC grant.
REVOKE EXECUTE ON FUNCTION
    can_comment(uuid), can_see_costs(uuid), can_see_gps(uuid),
    can_see_plan(uuid), can_see_trip(uuid), is_trip_owner(uuid),
    is_current_user_admin()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    can_comment(uuid), can_see_costs(uuid), can_see_gps(uuid),
    can_see_plan(uuid), can_see_trip(uuid), is_trip_owner(uuid),
    is_current_user_admin()
TO anon, authenticated, service_role, tenant_service;

-- Raw home-address zones: only service-side jobs may read them.
REVOKE EXECUTE ON FUNCTION privacy_zones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_zones(uuid) TO service_role, tenant_service;

-- Deprecated cross-user surfaces (superseded by the Fluxbase knowledge
-- base / per-user scoping; no in-repo callers). sample_tracker_data_if_needed,
-- search_similar_pois, search_similar_trips and get_embedding_stats lost
-- their authenticated grants above; they remain service-only until the
-- destructive-drop pass removes them entirely (needs --allow-destructive).

-- get_shared_trip references the removed trips.share_token column and is
-- broken; revoke until the destructive-drop pass deletes it.
REVOKE EXECUTE ON FUNCTION get_shared_trip(text) FROM PUBLIC, anon, authenticated;

-- Dead table: nothing writes trip_gps_tracks, and its SELECT policy serves
-- unclipped raw points to friends (unlike the clipping enforced by
-- get_public_trip_track). Close the read path until the table is dropped.
REVOKE SELECT ON trip_gps_tracks FROM anon, authenticated;

-- Documented visibility semantic: the trip-level budget columns are visible
-- to anyone who can see the trip row (per trips_select), regardless of
-- costs_visible_to — only per-item costs in visible_plan_items are masked.
COMMENT ON COLUMN trips.budget_total IS 'Visible to everyone who can see the trip row (trips_select); costs_visible_to masks only per-item plan costs.';

-- Idempotent trip creation: prevents auto-ongoing/scheduled generators from
-- duplicating the same trip (application-level date matching alone raced).
-- Columns verified against the trips CREATE TABLE above: start_date/end_date
-- are NOT NULL date columns; the status values below are all members of the
-- trips_status_check constraint.
CREATE UNIQUE INDEX IF NOT EXISTS trips_user_dates_active_unique
    ON trips (user_id, start_date, end_date)
    WHERE status IN ('pending', 'completed', 'active');
