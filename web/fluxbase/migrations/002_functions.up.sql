SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
COMMENT ON SCHEMA "public" IS 'Wayli public schema';
CREATE OR REPLACE FUNCTION "public"."calculate_distances_batch_v2"(
        "p_user_id" "uuid",
        "p_offset" integer,
        "p_limit" integer DEFAULT 1000
    ) RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
DECLARE updated_count INTEGER := 0;
BEGIN -- Set timeout for batch processing
SET statement_timeout = '30s';
WITH batch AS (
    SELECT user_id,
        recorded_at,
        location
    FROM public.tracker_data
    WHERE user_id = p_user_id
        AND location IS NOT NULL
    ORDER BY recorded_at OFFSET p_offset
    LIMIT p_limit
), -- Calculate distances using LATERAL join to get previous record
calculations AS (
    SELECT b.user_id,
        b.recorded_at,
        COALESCE(
            public.st_distancesphere(prev.location, b.location),
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
COMMENT ON FUNCTION "public"."calculate_distances_batch_v2"(
    "p_user_id" "uuid",
    "p_offset" integer,
    "p_limit" integer
) IS 'V2 distance calculation using chronological batch processing with offset. Processes records in order to ensure each record can find its previous record. Returns number of records updated.';
CREATE OR REPLACE FUNCTION "public"."calculate_mode_aware_speed"(
        "user_id_param" "uuid",
        "recorded_at_param" timestamp with time zone,
        "transport_mode" "text" DEFAULT NULL::"text"
    ) RETURNS numeric LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
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
        public.st_distancesphere(
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
COMMENT ON FUNCTION "public"."calculate_mode_aware_speed"(
    "user_id_param" "uuid",
    "recorded_at_param" timestamp with time zone,
    "transport_mode" "text"
) IS 'Calculates speed with transport mode awareness and appropriate window sizes';
CREATE OR REPLACE FUNCTION "public"."calculate_stable_speed"(
        "user_id_param" "uuid",
        "recorded_at_param" timestamp with time zone,
        "window_size" integer DEFAULT 5
    ) RETURNS numeric LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
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
        public.st_distancesphere(
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
COMMENT ON FUNCTION "public"."calculate_stable_speed"(
    "user_id_param" "uuid",
    "recorded_at_param" timestamp with time zone,
    "window_size" integer
) IS 'Calculates stable speed using multiple points and outlier filtering for noise reduction';
CREATE OR REPLACE FUNCTION "public"."cleanup_expired_exports"() RETURNS integer LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE deleted_count INTEGER := 0;
expired_job RECORD;
BEGIN -- Find expired export jobs
FOR expired_job IN
SELECT id,
    (data->>'file_path') as file_path
FROM public.jobs
WHERE type = 'data_export'
    AND (data->>'expires_at')::timestamp with time zone < NOW()
    AND data->>'file_path' IS NOT NULL LOOP -- Delete the file from storage
DELETE FROM storage.objects
WHERE name = expired_job.file_path
    AND bucket_id = 'exports';
DELETE FROM public.jobs
WHERE id = expired_job.id;
deleted_count := deleted_count + 1;
END LOOP;
RETURN deleted_count;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."create_distance_calculation_job"(
        "target_user_id" "uuid",
        "job_reason" "text" DEFAULT 'import_fallback'::"text"
    ) RETURNS "uuid" LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE job_id UUID;
BEGIN -- Insert the job using the correct column name (created_by instead of user_id)
INSERT INTO public.jobs (
        type,
        status,
        priority,
        data,
        created_by
    )
VALUES (
        'distance_calculation',
        'queued',
        'low',
        jsonb_build_object(
            'type',
            'distance_calculation',
            'target_user_id',
            target_user_id,
            'reason',
            job_reason,
            'created_at',
            now()
        ),
        target_user_id
    )
RETURNING id INTO job_id;
RETURN job_id;
END;
$$;
COMMENT ON FUNCTION "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text") IS 'Safely creates a distance calculation job using the correct column names.';
CREATE OR REPLACE FUNCTION "public"."disable_tracker_data_trigger"() RETURNS "void" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$ BEGIN
ALTER TABLE public.tracker_data DISABLE TRIGGER tracker_data_distance_trigger;
RAISE NOTICE 'Disabled tracker_data_distance_trigger for bulk operations';
END;
$$;
COMMENT ON FUNCTION "public"."disable_tracker_data_trigger"() IS 'Temporarily disables distance calculation trigger for bulk operations';
CREATE OR REPLACE FUNCTION "public"."enable_tracker_data_trigger"() RETURNS "void" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$ BEGIN
ALTER TABLE public.tracker_data ENABLE TRIGGER tracker_data_distance_trigger;
RAISE NOTICE 'Enabled tracker_data_distance_trigger';
END;
$$;
COMMENT ON FUNCTION "public"."enable_tracker_data_trigger"() IS 'Re-enables distance calculation trigger after bulk operations';
CREATE OR REPLACE FUNCTION "public"."full_country"("country" "text") RETURNS "text" LANGUAGE "plpgsql" IMMUTABLE
SET "search_path" TO '' AS $$ BEGIN RETURN (
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
COMMENT ON FUNCTION "public"."full_country"("country" "text") IS 'Maps ISO 3166-1 alpha-2 country codes to full country names';
CREATE OR REPLACE FUNCTION "public"."get_points_within_radius"(
        "center_lat" double precision,
        "center_lon" double precision,
        "radius_meters" double precision,
        "user_uuid" "uuid"
    ) RETURNS TABLE(
        "user_id" "uuid",
        "recorded_at" timestamp with time zone,
        "lat" double precision,
        "lon" double precision,
        "distance_meters" double precision
    ) LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$ BEGIN IF auth.uid() != user_uuid
    AND NOT EXISTS (
        SELECT 1
        FROM public.user_profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    ) THEN RAISE EXCEPTION 'Unauthorized: You can only access your own tracking points';
END IF;
RETURN QUERY
SELECT td.user_id,
    td.recorded_at,
    public.ST_Y(td.location::public.geometry) as lat,
    public.ST_X(td.location::public.geometry) as lon,
    public.st_distancesphere(
        td.location,
        public.ST_SetSRID(
            public.ST_MakePoint(center_lon, center_lat),
            4326
        )
    ) as distance_meters
FROM public.tracker_data td
WHERE td.user_id = user_uuid
    AND public.ST_DWithin(
        td.location::public.geography,
        public.ST_SetSRID(
            public.ST_MakePoint(center_lon, center_lat),
            4326
        )::public.geography,
        radius_meters
    )
ORDER BY td.recorded_at;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."get_user_tracking_data"(
        "user_uuid" "uuid",
        "start_date" timestamp with time zone DEFAULT NULL::timestamp with time zone,
        "end_date" timestamp with time zone DEFAULT NULL::timestamp with time zone,
        "limit_count" integer DEFAULT 1000
    ) RETURNS TABLE(
        "user_id" "uuid",
        "recorded_at" timestamp with time zone,
        "lat" double precision,
        "lon" double precision,
        "altitude" numeric,
        "accuracy" numeric,
        "speed" numeric,
        "activity_type" "text",
        "geocode" "jsonb",
        "distance" numeric,
        "time_spent" numeric
    ) LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$ BEGIN IF auth.uid() != user_uuid
    AND NOT EXISTS (
        SELECT 1
        FROM public.user_profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    ) THEN RAISE EXCEPTION 'Unauthorized: You can only access your own tracking data';
END IF;
RETURN QUERY
SELECT td.user_id,
    td.recorded_at,
    public.ST_Y(td.location::public.geometry) as lat,
    public.ST_X(td.location::public.geometry) as lon,
    td.altitude,
    td.accuracy,
    td.speed,
    td.activity_type,
    td.geocode,
    td.distance,
    td.time_spent
FROM public.tracker_data td
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
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger" LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE user_role TEXT;
first_name TEXT;
last_name TEXT;
full_name TEXT;
BEGIN -- Extract name information from user metadata
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
INSERT INTO public.user_profiles (
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
        -- Atomic check: First user becomes admin, prevents race condition
        CASE
            WHEN NOT EXISTS (
                SELECT 1
                FROM public.user_profiles
                LIMIT 1 FOR
                UPDATE
            ) THEN 'admin'
            ELSE 'user'
        END,
        NOW(),
        NOW()
    );
INSERT INTO public.user_preferences (
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
COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Trigger function to create user_profiles and user_preferences entries for new users.
    First user is automatically assigned admin role using atomic row-level locking to prevent race conditions.
    Uses empty search_path for security (SECURITY DEFINER function).';
CREATE OR REPLACE FUNCTION "public"."is_user_admin"("user_uuid" "uuid") RETURNS boolean LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE user_role TEXT;
BEGIN
SELECT role INTO user_role
FROM public.user_profiles
WHERE id = user_uuid;
RETURN user_role = 'admin';
END;
$$;
CREATE OR REPLACE FUNCTION "public"."perform_bulk_import_with_distance_calculation"("target_user_id" "uuid") RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
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
COMMENT ON FUNCTION "public"."perform_bulk_import_with_distance_calculation"("target_user_id" "uuid") IS 'Optimized bulk import helper that disables triggers, calculates distances, and re-enables triggers';
CREATE OR REPLACE FUNCTION "public"."remove_duplicate_tracking_points"("target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
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
    FROM public.tracker_data
    WHERE (
            target_user_id IS NULL
            OR user_id = target_user_id
        )
)
DELETE FROM public.tracker_data
WHERE ctid IN (
        SELECT ctid
        FROM duplicates
        WHERE rn > 1
    );
GET DIAGNOSTICS deleted_count = ROW_COUNT;
RETURN deleted_count;
END;
$$;
COMMENT ON FUNCTION "public"."remove_duplicate_tracking_points"("target_user_id" "uuid") IS 'Removes duplicate tracking points, keeping the most recent record for each unique (user_id, recorded_at) combination';
-- Improve time-based sampling to reduce point density during car travel
-- Priority: Time-based sampling over distance-based sampling
CREATE OR REPLACE FUNCTION "public"."sample_tracker_data_if_needed"(
        "p_target_user_id" "uuid",
        "p_start_date" timestamp with time zone DEFAULT NULL::timestamp with time zone,
        "p_end_date" timestamp with time zone DEFAULT NULL::timestamp with time zone,
        "p_max_points_threshold" integer DEFAULT 1000,
        "p_min_distance_meters" numeric DEFAULT 500,
        "p_min_time_minutes" numeric DEFAULT 5,
        "p_max_points_per_hour" integer DEFAULT 30,
        "p_offset" integer DEFAULT 0,
        "p_limit" integer DEFAULT 1000
    ) RETURNS TABLE(
        "result_user_id" "uuid",
        "result_tracker_type" "text",
        "result_device_id" "text",
        "result_recorded_at" timestamp with time zone,
        "result_location" "public"."geometry",
        "result_country_code" character varying,
        "result_altitude" numeric,
        "result_accuracy" numeric,
        "result_speed" numeric,
        "result_distance" numeric,
        "result_time_spent" numeric,
        "result_heading" numeric,
        "result_battery_level" integer,
        "result_is_charging" boolean,
        "result_activity_type" "text",
        "result_geocode" "jsonb",
        "result_tz_diff" numeric,
        "result_created_at" timestamp with time zone,
        "result_updated_at" timestamp with time zone,
        "result_is_sampled" boolean,
        "result_total_count" bigint
    ) LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE total_point_count BIGINT;
min_distance_degrees DECIMAL;
min_time_interval INTERVAL;
BEGIN -- Convert meters to degrees (approximate: 1 degree ≈ 111,000 meters)
min_distance_degrees := p_min_distance_meters / 111000.0;
min_time_interval := (p_min_time_minutes || ' minutes')::INTERVAL;
SELECT COUNT(*) INTO total_point_count
FROM public.tracker_data
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
FROM public.tracker_data td
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
            ELSE public.st_distancesphere(
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
    FROM public.tracker_data td
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
COMMENT ON FUNCTION "public"."sample_tracker_data_if_needed"(
    "p_target_user_id" "uuid",
    "p_start_date" timestamp with time zone,
    "p_end_date" timestamp with time zone,
    "p_max_points_threshold" integer,
    "p_min_distance_meters" numeric,
    "p_min_time_minutes" numeric,
    "p_max_points_per_hour" integer,
    "p_offset" integer,
    "p_limit" integer
) IS 'Intelligently samples tracker data when point count exceeds threshold. Uses dynamic spatial-temporal sampling with configurable parameters that become more aggressive for larger datasets.';
CREATE OR REPLACE FUNCTION "public"."st_distancesphere"(
        "geog1" "public"."geography",
        "geog2" "public"."geography"
    ) RETURNS double precision LANGUAGE "sql" IMMUTABLE STRICT
SET "search_path" TO '' AS $$
SELECT public.ST_Distance(geog1, geog2);
$$;
CREATE OR REPLACE FUNCTION "public"."st_distancesphere"(
        "geom1" "public"."geometry",
        "geom2" "public"."geometry"
    ) RETURNS double precision LANGUAGE "sql" IMMUTABLE STRICT
SET "search_path" TO '' AS $$
SELECT public.ST_Distance(geom1::public.geography, geom2::public.geography);
$$;
CREATE OR REPLACE FUNCTION "public"."trigger_calculate_distance"() RETURNS "trigger" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
DECLARE prev_point RECORD;
calculated_distance DECIMAL;
calculated_time_spent DECIMAL;
stable_speed DECIMAL;
BEGIN -- Only calculate if location is provided
IF NEW.location IS NOT NULL THEN -- Find the previous point for this user based on recorded_at
SELECT location,
    recorded_at INTO prev_point
FROM public.tracker_data
WHERE user_id = NEW.user_id
    AND recorded_at < NEW.recorded_at
    AND location IS NOT NULL
ORDER BY recorded_at DESC
LIMIT 1;
IF prev_point IS NOT NULL THEN -- Calculate distance from previous point
calculated_distance := public.st_distancesphere(prev_point.location, NEW.location);
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
NEW.updated_at := NOW();
END IF;
RETURN NEW;
END;
$$;
COMMENT ON FUNCTION "public"."trigger_calculate_distance"() IS 'Trigger function to automatically calculate distance and time_spent for new tracker_data records';
CREATE OR REPLACE FUNCTION "public"."trigger_calculate_distance_enhanced"() RETURNS "trigger" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
DECLARE prev_point RECORD;
calculated_distance DECIMAL;
calculated_time_spent DECIMAL;
stable_speed DECIMAL;
BEGIN -- Only calculate if location is provided
IF NEW.location IS NOT NULL THEN -- Find the previous point for this user based on recorded_at
SELECT location,
    recorded_at INTO prev_point
FROM public.tracker_data
WHERE user_id = NEW.user_id
    AND recorded_at < NEW.recorded_at
    AND location IS NOT NULL
ORDER BY recorded_at DESC
LIMIT 1;
IF prev_point IS NOT NULL THEN -- Calculate distance from previous point
calculated_distance := public.st_distancesphere(prev_point.location, NEW.location);
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
COMMENT ON FUNCTION "public"."trigger_calculate_distance_enhanced"() IS 'Enhanced trigger that uses stable speed calculation for new records';
CREATE OR REPLACE FUNCTION "public"."update_tracker_distances"("target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $_$
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
                        t1.recorded_at - LAG(t1.recorded_at) OVER (
                            PARTITION BY t1.user_id
                            ORDER BY t1.recorded_at
                        )
                    )
            )
        END AS calculated_time_spent
    FROM public.tracker_data t1
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
UPDATE public.tracker_data AS td
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
COMMENT ON FUNCTION "public"."update_tracker_distances"("target_user_id" "uuid") IS 'Enhanced version that uses stable speed calculation with multi-point windows for better accuracy';
CREATE OR REPLACE FUNCTION "public"."update_tracker_distances_batch"(
        "target_user_id" "uuid" DEFAULT NULL::"uuid",
        "batch_size" integer DEFAULT 1000
    ) RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $_$
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
COMMENT ON FUNCTION "public"."update_tracker_distances_batch"("target_user_id" "uuid", "batch_size" integer) IS 'Updates distance and time_spent columns in optimized batches for large datasets. Includes execution time limits and improved performance.';
CREATE OR REPLACE FUNCTION "public"."update_tracker_distances_enhanced"("target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $_$
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
                        t1.recorded_at - LAG(t1.recorded_at) OVER (
                            PARTITION BY t1.user_id
                            ORDER BY t1.recorded_at
                        )
                    )
            )
        END AS calculated_time_spent
    FROM public.tracker_data t1
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
UPDATE public.tracker_data AS td
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
COMMENT ON FUNCTION "public"."update_tracker_distances_enhanced"("target_user_id" "uuid") IS 'Enhanced version that uses stable speed calculation with multi-point windows';
CREATE OR REPLACE FUNCTION "public"."update_tracker_distances_small_batch"(
        "target_user_id" "uuid" DEFAULT NULL::"uuid",
        "max_records" integer DEFAULT 100
    ) RETURNS integer LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$
DECLARE total_updated INTEGER := 0;
BEGIN -- Set very short timeout
SET statement_timeout = '30s';
WITH records_needing_update AS (
    -- Get records that need distance calculation
    SELECT user_id,
        recorded_at
    FROM public.tracker_data
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
            ELSE public.st_distancesphere(prev.location, t1.location)
        END AS calculated_distance,
        CASE
            WHEN prev.recorded_at IS NULL THEN 0
            ELSE EXTRACT(
                EPOCH
                FROM (t1.recorded_at - prev.recorded_at)
            )
        END AS calculated_time_spent
    FROM public.tracker_data t1 -- Self-join to get previous record for each user
        LEFT JOIN LATERAL (
            SELECT location,
                recorded_at
            FROM public.tracker_data
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
COMMENT ON FUNCTION "public"."update_tracker_distances_small_batch"("target_user_id" "uuid", "max_records" integer) IS 'Lightweight distance calculation function for small batches with very short timeout (30s). Uses LATERAL join to properly access previous records for LAG calculation.';
CREATE OR REPLACE FUNCTION "public"."update_user_profiles_updated_at"() RETURNS "trigger" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_want_to_visit_places_updated_at"() RETURNS "trigger" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$ BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."update_workers_updated_at"() RETURNS "trigger" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION "public"."validate_tracking_query_limits"(
        "p_limit" integer,
        "p_max_points_threshold" integer
    ) RETURNS boolean LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$ BEGIN -- Enforce maximum limits to prevent DoS
    IF p_limit > 10000 THEN RAISE EXCEPTION 'Limit too high (maximum 10000), requested: %',
    p_limit;
END IF;
IF p_max_points_threshold > 10000 THEN RAISE EXCEPTION 'Max points threshold too high (maximum 10000), requested: %',
p_max_points_threshold;
END IF;
RETURN TRUE;
END;
$$;
COMMENT ON FUNCTION "public"."validate_tracking_query_limits"(
    "p_limit" integer,
    "p_max_points_threshold" integer
) IS 'Validates query limits to prevent DoS attacks via unbounded queries';
