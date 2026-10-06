-- Brepia 2.0 database baseline.
-- Current product schema for a new installation.

CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";

CREATE TYPE "public"."conversation-type" AS ENUM (
    'parametric',
    'creative'
);

CREATE TYPE "public"."generation-status" AS ENUM (
    'pending',
    'success',
    'failure'
);

CREATE TYPE "public"."mesh_model_type" AS ENUM (
    'quality',
    'fast'
);

CREATE TYPE "public"."mesh_file_type" AS ENUM (
    'glb',
    'stl',
    'obj',
    'fbx'
);

CREATE TYPE "public"."privacy_type" AS ENUM (
    'public',
    'private'
);

CREATE TYPE "public"."prompt_type" AS ENUM (
    'mesh',
    'image',
    'chat'
);

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "notifications_enabled" boolean DEFAULT false NOT NULL,
    "avatar_path" "text" DEFAULT NULL,
    "avatar_preset" "text" DEFAULT NULL
);

COMMENT ON COLUMN "public"."profiles"."avatar_preset" IS
    'Optional Brepia avatar preset id. When set it takes precedence over provider/uploaded profile images in the application UI.';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_pkey ON "public"."profiles" USING btree (id);

ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY USING INDEX "profiles_pkey";

ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."profiles" VALIDATE CONSTRAINT "profiles_user_id_fkey";

CREATE POLICY "Users can manage their own profile" ON "public"."profiles" USING ( (SELECT "auth"."uid"()) = "user_id" );

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."profiles" TO anon;
GRANT ALL ON TABLE "public"."profiles" TO authenticated;
GRANT ALL ON TABLE "public"."profiles" TO service_role;


CREATE TABLE IF NOT EXISTS "public"."user_accounts" (
    "user_id" "uuid" NOT NULL,
    "username" "text" DEFAULT NULL,
    "contact_email" "text" DEFAULT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_accounts_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'user'::"text"]))),
    CONSTRAINT "user_accounts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'disabled'::"text"]))),
    CONSTRAINT "user_accounts_username_check" CHECK (("username" IS NULL) OR ("username" ~ '^[a-z0-9][a-z0-9._-]{2,31}$'::"text"))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_pkey ON "public"."user_accounts" USING btree (user_id);
ALTER TABLE "public"."user_accounts" ADD CONSTRAINT "user_accounts_pkey" PRIMARY KEY USING INDEX "user_accounts_pkey";

CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_username_lower_key
    ON "public"."user_accounts" USING btree (lower(username))
    WHERE username IS NOT NULL;

ALTER TABLE "public"."user_accounts"
    ADD CONSTRAINT "user_accounts_user_id_fkey"
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON UPDATE CASCADE ON DELETE CASCADE not valid;
ALTER TABLE "public"."user_accounts" VALIDATE CONSTRAINT "user_accounts_user_id_fkey";

CREATE POLICY "Users can view their own account access"
    ON "public"."user_accounts"
    FOR SELECT
    USING ((SELECT "auth"."uid"()) = "user_id");

ALTER TABLE "public"."user_accounts" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."user_accounts" TO "service_role";

CREATE TABLE IF NOT EXISTS "public"."registration_settings" (
    "id" smallint DEFAULT 1 NOT NULL,
    "allow_registration" boolean DEFAULT false NOT NULL,
    "require_admin_approval" boolean DEFAULT true NOT NULL,
    "identity_policy" "text" DEFAULT 'email'::"text" NOT NULL,
    "allowed_social_providers" "text"[] DEFAULT ARRAY['google'::"text"] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "registration_settings_singleton_check" CHECK (("id" = 1)),
    CONSTRAINT "registration_settings_identity_policy_check" CHECK (("identity_policy" = ANY (ARRAY['email'::"text", 'social'::"text", 'email_or_social'::"text"])))
);

CREATE UNIQUE INDEX IF NOT EXISTS registration_settings_pkey ON "public"."registration_settings" USING btree (id);
ALTER TABLE "public"."registration_settings" ADD CONSTRAINT "registration_settings_pkey" PRIMARY KEY USING INDEX "registration_settings_pkey";

ALTER TABLE "public"."registration_settings" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."registration_settings" TO "service_role";

CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "type" "public"."conversation-type" DEFAULT 'parametric'::"public"."conversation-type" NOT NULL,
    "privacy" "public"."privacy_type" DEFAULT 'private'::"public"."privacy_type" NOT NULL,
    "current_message_leaf_id" "uuid",
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_pkey ON "public"."conversations" USING btree (id);
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_pkey" PRIMARY KEY USING INDEX "conversations_pkey";
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;
ALTER TABLE "public"."conversations" VALIDATE CONSTRAINT "conversations_user_id_fkey";

CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON "public"."conversations" USING btree (created_at);
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON "public"."conversations" USING btree (updated_at);
CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON "public"."conversations" USING btree (user_id);

CREATE POLICY "Anyone can view a public conversation" ON "public"."conversations" FOR SELECT TO "authenticated", "anon" USING (("privacy" = 'public'::"public"."privacy_type"));
CREATE POLICY "Users can manage their own conversations" ON "public"."conversations" USING ( (SELECT "auth"."uid"()) = "user_id" );
ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."conversations" TO anon;
GRANT ALL ON TABLE "public"."conversations" TO authenticated;
GRANT ALL ON TABLE "public"."conversations" TO service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_suggestions(
  p_conversation_id uuid,
  p_suggestions jsonb
) RETURNS void LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
  UPDATE public.conversations
  SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{suggestions}',
    p_suggestions,
    true
  )
  WHERE id = p_conversation_id;
$$;
CREATE OR REPLACE FUNCTION public.patch_conversation_metadata(
  p_conversation_id uuid,
  p_title text DEFAULT NULL,
  p_privacy public.privacy_type DEFAULT NULL,
  p_settings_patch jsonb DEFAULT '{}'::jsonb
) RETURNS SETOF public.conversations
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.conversations
  SET
    title = COALESCE(p_title, title),
    privacy = COALESCE(p_privacy, privacy),
    settings = COALESCE(settings, '{}'::jsonb) ||
      COALESCE(p_settings_patch, '{}'::jsonb)
  WHERE id = p_conversation_id
  RETURNING *;
$$;

CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "parts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content" "jsonb",
    "rating" smallint DEFAULT 0::smallint NOT NULL,
    "parent_message_id" "uuid"
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_pkey ON "public"."messages" USING btree (id);
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_pkey" PRIMARY KEY USING INDEX "messages_pkey";

ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_role_check"
    CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"]))) NOT VALID;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_payload_present"
    CHECK ((jsonb_array_length("parts") > 0) OR ("content" IS NOT NULL)) NOT VALID;

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON "public"."messages" USING btree (conversation_id);

CREATE POLICY "Public conversations messages" ON "public"."messages" FOR SELECT TO "anon", "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND ("conversations"."privacy" = 'public'::"public"."privacy_type")))));

CREATE POLICY "Users can manage messages in their conversations" ON "public"."messages" USING (((SELECT "auth"."uid"()) IN ( SELECT "conversations"."user_id"
   FROM "public"."conversations"
  WHERE ("conversations"."id" = "messages"."conversation_id"))));

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."messages" TO anon;
GRANT ALL ON TABLE "public"."messages" TO authenticated;
GRANT ALL ON TABLE "public"."messages" TO service_role;
GRANT ALL ON TABLE "public"."messages" TO postgres;

CREATE TABLE IF NOT EXISTS "public"."prompts" (
    "id" bigint generated by default as identity not null,
    "created_at" timestamp with time zone not null default now(),
    "user_id" "uuid" NOT NULL,
    "type" "public"."prompt_type" DEFAULT 'chat'::"public"."prompt_type" NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS prompts_pkey ON "public"."prompts" USING btree (id);

ALTER TABLE "public"."prompts" ADD CONSTRAINT "prompts_pkey" PRIMARY KEY USING INDEX "prompts_pkey";

ALTER TABLE "public"."prompts" ADD CONSTRAINT "prompts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."prompts" VALIDATE CONSTRAINT "prompts_user_id_fkey";

CREATE POLICY "Users can view their own prompts" ON "public"."prompts" FOR SELECT USING ((SELECT "auth"."uid"()) = "user_id");

ALTER TABLE "public"."prompts" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."prompts" TO anon;
GRANT ALL ON TABLE "public"."prompts" TO authenticated;
GRANT ALL ON TABLE "public"."prompts" TO service_role;


CREATE TABLE IF NOT EXISTS "public"."ai_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "driver" "text" NOT NULL,
    "base_url" "text" NOT NULL,
    "credential_ciphertext" "text" NULL,
    "credential_iv" "text" NULL,
    "credential_tag" "text" NULL,
    "enabled" boolean NOT NULL DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_pkey" ON "public"."ai_providers" USING btree ("id");
ALTER TABLE "public"."ai_providers" ADD CONSTRAINT "ai_providers_pkey" PRIMARY KEY USING INDEX "ai_providers_pkey";
ALTER TABLE "public"."ai_providers" ADD CONSTRAINT "ai_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_user_slug_unique" ON "public"."ai_providers" USING btree ("user_id", "slug");
CREATE INDEX IF NOT EXISTS "ai_providers_user_enabled_idx" ON "public"."ai_providers" USING btree ("user_id", "enabled");

ALTER TABLE "public"."ai_providers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_providers_select" ON "public"."ai_providers"
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ai_providers_insert" ON "public"."ai_providers"
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_providers_update" ON "public"."ai_providers"
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_providers_delete" ON "public"."ai_providers"
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON TABLE "public"."ai_providers" TO anon;
GRANT ALL ON TABLE "public"."ai_providers" TO authenticated;
GRANT ALL ON TABLE "public"."ai_providers" TO service_role;
GRANT ALL ON TABLE "public"."ai_providers" TO postgres;


CREATE TABLE IF NOT EXISTS "public"."ai_provider_models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "model_id" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text" NULL,
    "supports_tools" boolean NOT NULL DEFAULT false,
    "supports_thinking" boolean NOT NULL DEFAULT false,
    "supports_vision" boolean NOT NULL DEFAULT false,
    "context_limit" integer NULL,
    "output_limit" integer NULL,
    "is_visible" boolean NOT NULL DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_provider_models_updated_at_trigger" CHECK (true)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_models_pkey" ON "public"."ai_provider_models" USING btree ("id");
ALTER TABLE "public"."ai_provider_models" ADD CONSTRAINT "ai_provider_models_pkey" PRIMARY KEY USING INDEX "ai_provider_models_pkey";

ALTER TABLE "public"."ai_provider_models" ADD CONSTRAINT "ai_provider_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE CASCADE;
ALTER TABLE "public"."ai_provider_models" ADD CONSTRAINT "ai_provider_models_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_models_provider_model_unique" ON "public"."ai_provider_models" USING btree ("provider_id", "model_id");
CREATE INDEX IF NOT EXISTS "ai_provider_models_provider_id_idx" ON "public"."ai_provider_models" USING btree ("provider_id");

ALTER TABLE "public"."ai_provider_models" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_provider_models_select" ON "public"."ai_provider_models"
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ai_provider_models_insert" ON "public"."ai_provider_models"
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_provider_models_update" ON "public"."ai_provider_models"
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_provider_models_delete" ON "public"."ai_provider_models"
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON TABLE "public"."ai_provider_models" TO anon;
GRANT ALL ON TABLE "public"."ai_provider_models" TO authenticated;
GRANT ALL ON TABLE "public"."ai_provider_models" TO service_role;
GRANT ALL ON TABLE "public"."ai_provider_models" TO postgres;


CREATE TABLE IF NOT EXISTS "public"."user_ai_preferences" (
    "user_id" "uuid" NOT NULL,
    "hidden_model_ids" "text"[] NOT NULL DEFAULT '{}',
    "enabled_opencode_model_ids" "text"[] NOT NULL DEFAULT '{}',
    "default_prompt_profile_id" "uuid" NULL,
    "default_parametric_model_id" "text" NULL,
    "default_creative_model_id" "text" NULL,
    "vision_fast_model_id" "text" NULL,
    "vision_deep_model_id" "text" NULL,
    "model_routing" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    "default_creative_prompt_profile_id" "uuid" NULL,
    "instruction_profile_defaults" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    "runtime_overrides" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    "default_instruction_profile_id" "text" NOT NULL DEFAULT 'standard',
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

COMMENT ON COLUMN "public"."user_ai_preferences"."enabled_opencode_model_ids" IS
    'Explicit allowlist for dynamically discovered agent/opencode models. Newly discovered OpenCode models remain disabled until the user enables them.';
COMMENT ON COLUMN "public"."user_ai_preferences"."default_parametric_model_id" IS
    'Model catalog id preselected for new Parametric conversations.';
COMMENT ON COLUMN "public"."user_ai_preferences"."default_creative_model_id" IS
    'Creative mesh backend id preselected for new Creative conversations.';
COMMENT ON COLUMN "public"."user_ai_preferences"."vision_fast_model_id" IS
    'Model catalog id used for normal Brepia vision fallback analysis.';
COMMENT ON COLUMN "public"."user_ai_preferences"."vision_deep_model_id" IS
    'Model catalog id used for difficult/render inspection Brepia vision fallback analysis.';
COMMENT ON COLUMN "public"."user_ai_preferences"."model_routing" IS
    'User-configurable low-level runtime model IDs and provider routing. Runtime code must not inject hidden model defaults.';
COMMENT ON COLUMN "public"."user_ai_preferences"."default_instruction_profile_id" IS
    'Repository-backed Brepia AI instruction profile package ID, such as standard or cadam.';

CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_preferences_pkey" ON "public"."user_ai_preferences" USING btree ("user_id");
ALTER TABLE "public"."user_ai_preferences" ADD CONSTRAINT "user_ai_preferences_pkey" PRIMARY KEY USING INDEX "user_ai_preferences_pkey";
ALTER TABLE "public"."user_ai_preferences" ADD CONSTRAINT "user_ai_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."user_ai_preferences"
    ADD CONSTRAINT "user_ai_preferences_instruction_profile_defaults_object"
    CHECK (jsonb_typeof("instruction_profile_defaults") = 'object');
ALTER TABLE "public"."user_ai_preferences"
    ADD CONSTRAINT "user_ai_preferences_runtime_overrides_object"
    CHECK (jsonb_typeof("runtime_overrides") = 'object');

ALTER TABLE "public"."user_ai_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_ai_preferences_select" ON "public"."user_ai_preferences"
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_ai_preferences_insert" ON "public"."user_ai_preferences"
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_ai_preferences_update" ON "public"."user_ai_preferences"
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_ai_preferences_delete" ON "public"."user_ai_preferences"
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON TABLE "public"."user_ai_preferences" TO anon;
GRANT ALL ON TABLE "public"."user_ai_preferences" TO authenticated;
GRANT ALL ON TABLE "public"."user_ai_preferences" TO service_role;
GRANT ALL ON TABLE "public"."user_ai_preferences" TO postgres;


CREATE TABLE IF NOT EXISTS "public"."prompt_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NULL,
    "prompt_template" "text" NOT NULL,
    "mode" text NOT NULL DEFAULT 'overlay' CHECK ("mode" IN ('overlay', 'fork')),
    "base_revision" "text" NULL,
    "archived" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scope" text NOT NULL DEFAULT 'parametric'
);

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_profiles_pkey" ON "public"."prompt_profiles" USING btree ("id");
ALTER TABLE "public"."prompt_profiles" ADD CONSTRAINT "prompt_profiles_pkey" PRIMARY KEY USING INDEX "prompt_profiles_pkey";
ALTER TABLE "public"."prompt_profiles" ADD CONSTRAINT "prompt_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."prompt_profiles" ADD CONSTRAINT "prompt_profiles_scope_check"
    CHECK ("scope" ~ '^[a-z0-9][a-z0-9_.-]{0,127}$');

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_profiles_user_scope_name_unique"
    ON "public"."prompt_profiles" USING btree ("user_id", "scope", lower("name"))
    WHERE archived = false;
CREATE INDEX IF NOT EXISTS "prompt_profiles_user_archived_idx" ON "public"."prompt_profiles" USING btree ("user_id", "archived");

ALTER TABLE "public"."prompt_profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_profiles_select" ON "public"."prompt_profiles"
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "prompt_profiles_insert" ON "public"."prompt_profiles"
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prompt_profiles_update" ON "public"."prompt_profiles"
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prompt_profiles_delete" ON "public"."prompt_profiles"
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON TABLE "public"."prompt_profiles" TO anon;
GRANT ALL ON TABLE "public"."prompt_profiles" TO authenticated;
GRANT ALL ON TABLE "public"."prompt_profiles" TO service_role;
GRANT ALL ON TABLE "public"."prompt_profiles" TO postgres;


CREATE TABLE IF NOT EXISTS "public"."ai_local_model_metadata" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "model_id" text NOT NULL,
    "display_name" text NULL,
    "supports_tools" boolean NOT NULL DEFAULT true,
    "supports_thinking" boolean NOT NULL DEFAULT false,
    "supports_vision" boolean NOT NULL DEFAULT false,
    "context_limit" integer NULL,
    "output_limit" integer NULL,
    "is_visible" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ai_local_model_metadata_model_id_length" CHECK (char_length(model_id) BETWEEN 1 AND 512),
    CONSTRAINT "ai_local_model_metadata_context_limit_positive" CHECK (context_limit IS NULL OR context_limit > 0),
    CONSTRAINT "ai_local_model_metadata_output_limit_positive" CHECK (output_limit IS NULL OR output_limit > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_local_model_metadata_pkey" ON "public"."ai_local_model_metadata" USING btree ("id");
ALTER TABLE "public"."ai_local_model_metadata" ADD CONSTRAINT "ai_local_model_metadata_pkey" PRIMARY KEY USING INDEX "ai_local_model_metadata_pkey";
ALTER TABLE "public"."ai_local_model_metadata" ADD CONSTRAINT "ai_local_model_metadata_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_local_model_metadata_user_model_unique" ON "public"."ai_local_model_metadata" USING btree ("user_id", "model_id");
CREATE INDEX IF NOT EXISTS "ai_local_model_metadata_user_id_idx" ON "public"."ai_local_model_metadata" USING btree ("user_id");

ALTER TABLE "public"."ai_local_model_metadata" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_local_model_metadata_select" ON "public"."ai_local_model_metadata"
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ai_local_model_metadata_insert" ON "public"."ai_local_model_metadata"
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_local_model_metadata_update" ON "public"."ai_local_model_metadata"
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_local_model_metadata_delete" ON "public"."ai_local_model_metadata"
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON TABLE "public"."ai_local_model_metadata" TO authenticated;
GRANT ALL ON TABLE "public"."ai_local_model_metadata" TO service_role;
GRANT ALL ON TABLE "public"."ai_local_model_metadata" TO postgres;


CREATE TABLE IF NOT EXISTS "public"."instance_settings" (
    "id" smallint DEFAULT 1 NOT NULL,
    "operator_name" text DEFAULT NULL,
    "contact_email" text DEFAULT NULL,
    "community_url" text DEFAULT NULL,
    "community_label" text DEFAULT 'Community'::text NOT NULL,
    "show_community_link" boolean DEFAULT false NOT NULL,
    "discord_url" text DEFAULT NULL,
    "legal_pages_enabled" boolean DEFAULT false NOT NULL,
    "terms_url" text DEFAULT NULL,
    "privacy_url" text DEFAULT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "instance_settings_singleton_check" CHECK (("id" = 1)),
    CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."instance_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."instance_settings" FROM "anon";
REVOKE ALL ON TABLE "public"."instance_settings" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."instance_settings" TO "service_role";

CREATE TABLE IF NOT EXISTS "public"."meshes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."generation-status" DEFAULT 'pending'::"public"."generation-status" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "images" "uuid"[],
    "conversation_id" "uuid" NOT NULL,
    "prompt" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "file_type" "public"."mesh_file_type" DEFAULT 'glb'::"public"."mesh_file_type" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS meshes_pkey ON "public"."meshes" USING btree (id);

ALTER TABLE "public"."meshes" ADD CONSTRAINT "meshes_pkey" PRIMARY KEY USING INDEX "meshes_pkey";

ALTER TABLE "public"."meshes" ADD CONSTRAINT "meshes_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."meshes" VALIDATE CONSTRAINT "meshes_conversation_id_fkey";

ALTER TABLE "public"."meshes" ADD CONSTRAINT "meshes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."meshes" VALIDATE CONSTRAINT "meshes_user_id_fkey";


CREATE POLICY "Everyone can view meshes associated with public conversations" ON "public"."meshes" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "meshes"."conversation_id") AND ("conversations"."privacy" = 'public'::"public"."privacy_type")))));

CREATE POLICY "Users can manage their meshes" ON "public"."meshes" USING ( (SELECT "auth"."uid"()) = "user_id" );

ALTER TABLE "public"."meshes" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."meshes" TO anon;
GRANT ALL ON TABLE "public"."meshes" TO authenticated;
GRANT ALL ON TABLE "public"."meshes" TO service_role;

CREATE TABLE IF NOT EXISTS "public"."images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."generation-status" DEFAULT 'pending'::"public"."generation-status" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "image_generation_call_id" "text",
    "prompt" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS images_pkey ON "public"."images" USING btree (id);

ALTER TABLE "public"."images" ADD CONSTRAINT "images_pkey" PRIMARY KEY USING INDEX "images_pkey";

ALTER TABLE "public"."images" ADD CONSTRAINT "images_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."images" VALIDATE CONSTRAINT "images_conversation_id_fkey";

ALTER TABLE "public"."images" ADD CONSTRAINT "images_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."images" VALIDATE CONSTRAINT "images_user_id_fkey";


CREATE INDEX IF NOT EXISTS idx_images_image_generation_call_id ON "public"."images" USING "btree" ("image_generation_call_id");


CREATE POLICY "Public conversations images" ON "public"."images" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "images"."conversation_id") AND ("conversations"."privacy" = 'public'::"public"."privacy_type")))));

CREATE POLICY "User can manage their data" ON "public"."images" TO "authenticated" USING ((( SELECT "auth"."uid"()) = "user_id")) WITH CHECK ((( SELECT "auth"."uid"()) = "user_id"));

ALTER TABLE "public"."images" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."images" TO anon;
GRANT ALL ON TABLE "public"."images" TO authenticated;
GRANT ALL ON TABLE "public"."images" TO service_role;

CREATE TABLE IF NOT EXISTS "public"."previews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."generation-status" DEFAULT 'pending'::"public"."generation-status" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "mesh_id" "uuid" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS previews_pkey ON "public"."previews" USING btree (id);

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_pkey" PRIMARY KEY USING INDEX "previews_pkey";

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."previews" VALIDATE CONSTRAINT "previews_user_id_fkey";

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."previews" VALIDATE CONSTRAINT "previews_conversation_id_fkey";

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_mesh_id_fkey" FOREIGN KEY (mesh_id) REFERENCES meshes(id) ON DELETE CASCADE not valid;

ALTER TABLE "public"."previews" VALIDATE CONSTRAINT "previews_mesh_id_fkey";


ALTER TABLE "public"."previews" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own previews" ON "public"."previews" USING ( (SELECT "auth"."uid"()) = "user_id" );

GRANT ALL ON TABLE "public"."previews" TO anon;
GRANT ALL ON TABLE "public"."previews" TO authenticated;
GRANT ALL ON TABLE "public"."previews" TO service_role;


CREATE TABLE IF NOT EXISTS "public"."generation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "request_message_id" "uuid" NOT NULL,
    "response_message_id" "uuid" NULL,
    "kind" "text" NOT NULL,
    "requested_model_id" "text" NOT NULL,
    "actual_model_id" "text" NULL,
    "transport_kind" "text" NULL,
    "execution_mode" "text" NULL,
    "status" "text" NOT NULL DEFAULT 'queued',
    "phase" "text" NOT NULL DEFAULT 'request_saved',
    "detail" "text" NULL,
    "sequence" bigint NOT NULL DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone NULL,
    "error_code" "text" NULL,
    "error_message" "text" NULL
);

COMMENT ON TABLE "public"."generation_runs" IS
    'Durable server-owned generation progress. sequence is a monotonic state version, never a percentage.';
COMMENT ON COLUMN "public"."generation_runs"."detail" IS
    'Bounded UI-safe progress detail. Raw provider/agent output and secrets must never be stored here.';
COMMENT ON COLUMN "public"."generation_runs"."status" IS
    'queued, running, waiting_for_preview, completed, failed, or cancelled.';
COMMENT ON COLUMN "public"."generation_runs"."phase" IS
    'Truthful current server phase from the shared GenerationRunPhase contract.';

CREATE UNIQUE INDEX IF NOT EXISTS "generation_runs_pkey"
    ON "public"."generation_runs" USING btree ("id");
CREATE INDEX IF NOT EXISTS "generation_runs_conversation_created_idx"
    ON "public"."generation_runs" USING btree ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "generation_runs_user_updated_idx"
    ON "public"."generation_runs" USING btree ("user_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "generation_runs_request_message_id_idx"
    ON "public"."generation_runs" USING btree ("request_message_id");

ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_pkey"
    PRIMARY KEY USING INDEX "generation_runs_pkey";
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;

ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_kind_check"
    CHECK ("kind" IN ('parametric', 'brep', 'creative'));
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_transport_kind_check"
    CHECK (
        "transport_kind" IS NULL OR
        "transport_kind" IN ('direct', 'opencode', 'codex', 'cli-agent')
    );
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_execution_mode_check"
    CHECK (
        "execution_mode" IS NULL OR
        "execution_mode" IN ('cli', 'streaming')
    );
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_opencode_execution_mode_check"
    CHECK (
        "execution_mode" IS NULL OR "transport_kind" = 'opencode'
    );
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_status_check"
    CHECK (
        "status" IN (
            'queued',
            'running',
            'waiting_for_preview',
            'completed',
            'failed',
            'cancelled'
        )
    );
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_phase_check"
    CHECK (
        "phase" IN (
            'request_saved',
            'model_dispatched',
            'generating',
            'response_received',
            'validating_artifact',
            'saving_revision',
            'revision_saved',
            'evaluation_requested',
            'evaluating_native',
            'preparing_viewer',
            'preview_ready'
        )
    );
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_sequence_check"
    CHECK ("sequence" > 0 AND "sequence" <= 9007199254740991);
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_detail_length_check"
    CHECK ("detail" IS NULL OR char_length("detail") <= 240);
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_error_code_length_check"
    CHECK ("error_code" IS NULL OR char_length("error_code") <= 80);
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_error_message_length_check"
    CHECK ("error_message" IS NULL OR char_length("error_message") <= 500);
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_terminal_timestamp_check"
    CHECK (
        ("status" IN ('completed', 'failed', 'cancelled') AND "completed_at" IS NOT NULL)
        OR
        ("status" NOT IN ('completed', 'failed', 'cancelled') AND "completed_at" IS NULL)
    );
ALTER TABLE "public"."generation_runs"
    ADD CONSTRAINT "generation_runs_failed_error_code_check"
    CHECK (
        "status" <> 'failed'
        OR ("error_code" IS NOT NULL AND char_length(btrim("error_code")) > 0)
    );

ALTER TABLE "public"."generation_runs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generation_runs_select_own"
    ON "public"."generation_runs"
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = "user_id"
        AND EXISTS (
            SELECT 1
            FROM "public"."conversations"
            WHERE "conversations"."id" = "generation_runs"."conversation_id"
              AND "conversations"."user_id" = auth.uid()
        )
    );
REVOKE ALL ON TABLE "public"."generation_runs" FROM anon;
REVOKE ALL ON TABLE "public"."generation_runs" FROM authenticated;
GRANT SELECT ON TABLE "public"."generation_runs" TO authenticated;
GRANT ALL ON TABLE "public"."generation_runs" TO service_role;
GRANT ALL ON TABLE "public"."generation_runs" TO postgres;


CREATE TABLE IF NOT EXISTS "public"."generation_run_events" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "generation_run_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "sequence" bigint NOT NULL,
    "kind" text NOT NULL,
    "invocation_number" bigint NULL,
    "candidate_number" bigint NULL,
    "build_attempt_number" bigint NULL,
    "model_step_number" bigint NULL,
    "repair_count" bigint NULL,
    "error_code" text NULL,
    "error_message" text NULL,
    "context_used_tokens" bigint NULL,
    "context_limit_tokens" bigint NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE "public"."generation_run_events" IS
    'Bounded server-owned telemetry for one durable generation run. Retains only the newest 128 events per run.';
COMMENT ON COLUMN "public"."generation_run_events"."sequence" IS
    'Monotonic per-run event order. It may exceed 128 because retention trims old rows without renumbering.';
COMMENT ON COLUMN "public"."generation_run_events"."error_message" IS
    'Bounded UI-safe diagnostic only; never raw provider output, prompts, hidden reasoning or canonical project payloads.';

CREATE UNIQUE INDEX IF NOT EXISTS "generation_run_events_pkey"
    ON "public"."generation_run_events" USING btree ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "generation_run_events_run_sequence_key"
    ON "public"."generation_run_events" USING btree ("generation_run_id", "sequence");
CREATE INDEX IF NOT EXISTS "generation_run_events_user_run_sequence_idx"
    ON "public"."generation_run_events" USING btree ("user_id", "generation_run_id", "sequence");

ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_pkey"
    PRIMARY KEY USING INDEX "generation_run_events_pkey";
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_generation_run_id_fkey"
    FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE CASCADE;
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_sequence_check"
    CHECK ("sequence" > 0 AND "sequence" <= 9007199254740991);
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_kind_check"
    CHECK (
        "kind" IN (
            'external_agent_invoked',
            'canonical_candidate_received',
            'canonical_candidate_rejected',
            'canonical_candidate_accepted',
            'build_attempt_started',
            'build_rejected',
            'build_accepted',
            'model_step',
            'transport_repair',
            'context_usage'
        )
    );
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_counter_range_check"
    CHECK (
        ("invocation_number" IS NULL OR ("invocation_number" > 0 AND "invocation_number" <= 9007199254740991))
        AND ("candidate_number" IS NULL OR ("candidate_number" > 0 AND "candidate_number" <= 9007199254740991))
        AND ("build_attempt_number" IS NULL OR ("build_attempt_number" > 0 AND "build_attempt_number" <= 9007199254740991))
        AND ("model_step_number" IS NULL OR ("model_step_number" > 0 AND "model_step_number" <= 9007199254740991))
        AND ("repair_count" IS NULL OR ("repair_count" > 0 AND "repair_count" <= 9007199254740991))
        AND ("context_used_tokens" IS NULL OR ("context_used_tokens" >= 0 AND "context_used_tokens" <= 9007199254740991))
        AND ("context_limit_tokens" IS NULL OR ("context_limit_tokens" > 0 AND "context_limit_tokens" <= 9007199254740991))
    );
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_required_counter_check"
    CHECK (
        ("kind" <> 'external_agent_invoked' OR "invocation_number" IS NOT NULL)
        AND ("kind" NOT IN ('canonical_candidate_received', 'canonical_candidate_rejected', 'canonical_candidate_accepted') OR "candidate_number" IS NOT NULL)
        AND ("kind" NOT IN ('build_attempt_started', 'build_rejected', 'build_accepted') OR "build_attempt_number" IS NOT NULL)
        AND ("kind" <> 'model_step' OR "model_step_number" IS NOT NULL)
        AND ("kind" <> 'transport_repair' OR "repair_count" IS NOT NULL)
        AND ("kind" <> 'context_usage' OR "context_used_tokens" IS NOT NULL)
    );
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_error_code_length_check"
    CHECK (
        "error_code" IS NULL
        OR (char_length(btrim("error_code")) > 0 AND char_length("error_code") <= 80)
    );
ALTER TABLE "public"."generation_run_events"
    ADD CONSTRAINT "generation_run_events_error_message_length_check"
    CHECK (
        "error_message" IS NULL
        OR (char_length(btrim("error_message")) > 0 AND char_length("error_message") <= 500)
    );

ALTER TABLE "public"."generation_run_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generation_run_events_select_own"
    ON "public"."generation_run_events"
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = "user_id"
        AND EXISTS (
            SELECT 1
            FROM "public"."generation_runs"
            WHERE "generation_runs"."id" = "generation_run_events"."generation_run_id"
              AND "generation_runs"."user_id" = auth.uid()
        )
    );

REVOKE ALL ON TABLE "public"."generation_run_events" FROM anon;
REVOKE ALL ON TABLE "public"."generation_run_events" FROM authenticated;
GRANT SELECT ON TABLE "public"."generation_run_events" TO authenticated;
GRANT ALL ON TABLE "public"."generation_run_events" TO service_role;
GRANT ALL ON TABLE "public"."generation_run_events" TO postgres;

CREATE OR REPLACE FUNCTION "public"."append_generation_run_event"(
    "p_generation_run_id" uuid,
    "p_user_id" uuid,
    "p_kind" text,
    "p_invocation_number" bigint DEFAULT NULL,
    "p_candidate_number" bigint DEFAULT NULL,
    "p_build_attempt_number" bigint DEFAULT NULL,
    "p_model_step_number" bigint DEFAULT NULL,
    "p_repair_count" bigint DEFAULT NULL,
    "p_error_code" text DEFAULT NULL,
    "p_error_message" text DEFAULT NULL,
    "p_context_used_tokens" bigint DEFAULT NULL,
    "p_context_limit_tokens" bigint DEFAULT NULL
)
RETURNS SETOF "public"."generation_run_events"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_sequence bigint;
    v_event "public"."generation_run_events"%ROWTYPE;
BEGIN
    PERFORM 1
    FROM "public"."generation_runs"
    WHERE "id" = p_generation_run_id
      AND "user_id" = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'generation run % is not owned by user %', p_generation_run_id, p_user_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(MAX("sequence"), 0) + 1
    INTO v_sequence
    FROM "public"."generation_run_events"
    WHERE "generation_run_id" = p_generation_run_id;

    INSERT INTO "public"."generation_run_events" (
        "generation_run_id",
        "user_id",
        "sequence",
        "kind",
        "invocation_number",
        "candidate_number",
        "build_attempt_number",
        "model_step_number",
        "repair_count",
        "error_code",
        "error_message",
        "context_used_tokens",
        "context_limit_tokens"
    ) VALUES (
        p_generation_run_id,
        p_user_id,
        v_sequence,
        p_kind,
        p_invocation_number,
        p_candidate_number,
        p_build_attempt_number,
        p_model_step_number,
        p_repair_count,
        p_error_code,
        p_error_message,
        p_context_used_tokens,
        p_context_limit_tokens
    )
    RETURNING * INTO v_event;
    DELETE FROM "public"."generation_run_events"
    WHERE "id" IN (
        SELECT "id"
        FROM "public"."generation_run_events"
        WHERE "generation_run_id" = p_generation_run_id
        ORDER BY "sequence" DESC
        OFFSET 128
    );

    RETURN NEXT v_event;
    RETURN;
END;
$$;

COMMENT ON FUNCTION "public"."append_generation_run_event"(
    uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, text, text, bigint, bigint
) IS
    'Service-role telemetry append boundary. Assigns monotonic per-run sequence and retains the newest 128 events.';

REVOKE ALL ON FUNCTION "public"."append_generation_run_event"(
    uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, text, text, bigint, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."append_generation_run_event"(
    uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, text, text, bigint, bigint
) FROM anon;
REVOKE ALL ON FUNCTION "public"."append_generation_run_event"(
    uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, text, text, bigint, bigint
) FROM authenticated;
GRANT EXECUTE ON FUNCTION "public"."append_generation_run_event"(
    uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, text, text, bigint, bigint
) TO service_role;
GRANT EXECUTE ON FUNCTION "public"."append_generation_run_event"(
    uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, text, text, bigint, bigint
) TO postgres;

CREATE OR REPLACE FUNCTION "public"."update_conversation_leaf"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update conversations set
    current_message_leaf_id = new.id,
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

CREATE OR REPLACE TRIGGER "update_leaf_trigger" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_conversation_leaf"();
CREATE OR REPLACE FUNCTION public.pin_conversation_instruction_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  selected_profile text;
begin
  if coalesce(new.settings, '{}'::jsonb) ? 'instructionProfileId' then
    return new;
  end if;

  select default_instruction_profile_id
  into selected_profile
  from public.user_ai_preferences
  where user_id = new.user_id;

  new.settings := coalesce(new.settings, '{}'::jsonb) ||
    jsonb_build_object(
      'instructionProfileId',
      coalesce(selected_profile, 'standard')
    );
  return new;
end;
$$;

DROP TRIGGER IF EXISTS conversations_pin_instruction_profile
  ON public.conversations;

CREATE TRIGGER conversations_pin_instruction_profile
BEFORE INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.pin_conversation_instruction_profile();
CREATE OR REPLACE FUNCTION public.pin_creative_profile_on_conversation_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  selected_profile_id text;
BEGIN
  IF NEW.type <> 'creative'::public."conversation-type" THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(
    btrim(preferences.model_routing ->> 'defaultLocalCreativeProfileId'),
    ''
  )
  INTO selected_profile_id
  FROM public.user_ai_preferences AS preferences
  WHERE preferences.user_id = NEW.user_id;
  NEW.settings := COALESCE(NEW.settings, '{}'::jsonb)
    || jsonb_build_object('localCreativeProfileId', selected_profile_id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER pin_creative_profile_on_conversation_insert
BEFORE INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.pin_creative_profile_on_conversation_insert();

COMMENT ON FUNCTION public.pin_creative_profile_on_conversation_insert() IS
  'Pins defaultLocalCreativeProfileId into new Creative conversation settings; missing key remains reserved for legacy conversations.';
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_previews_updated_at
    BEFORE UPDATE ON "public"."previews"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_user_ai_preferences_updated_at
    BEFORE UPDATE ON "public"."user_ai_preferences"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_prompt_profiles_updated_at
    BEFORE UPDATE ON "public"."prompt_profiles"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_ai_providers_updated_at
    BEFORE UPDATE ON "public"."ai_providers"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_ai_provider_models_updated_at
    BEFORE UPDATE ON "public"."ai_provider_models"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_user_accounts_updated_at
    BEFORE UPDATE ON "public"."user_accounts"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_registration_settings_updated_at
    BEFORE UPDATE ON "public"."registration_settings"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_instance_settings_updated_at
    BEFORE UPDATE ON "public"."instance_settings"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  registration_enabled boolean := false;
  approval_required boolean := true;
  configured_identity_policy text := 'email';
  configured_social_providers text[] := ARRAY['google']::text[];
  auth_provider text := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  provider_allowed boolean := false;
  initial_status text := 'pending';
  local_username text := NULL;
BEGIN
  SELECT
    allow_registration,
    require_admin_approval,
    identity_policy,
    allowed_social_providers
  INTO
    registration_enabled,
    approval_required,
    configured_identity_policy,
    configured_social_providers
  FROM public.registration_settings
  WHERE id = 1;

  IF NOT FOUND THEN
    registration_enabled := false;
    approval_required := true;
    configured_identity_policy := 'email';
    configured_social_providers := ARRAY['google']::text[];
  END IF;

  provider_allowed := CASE configured_identity_policy
    WHEN 'email' THEN auth_provider = 'email'
    WHEN 'social' THEN auth_provider <> 'email' AND auth_provider = ANY(configured_social_providers)
    WHEN 'email_or_social' THEN auth_provider = 'email' OR auth_provider = ANY(configured_social_providers)
    ELSE false
  END;

  IF registration_enabled AND provider_allowed AND NOT approval_required THEN
    initial_status := 'active';
  END IF;

  IF NEW.email LIKE '%@brepia.invalid' THEN
    local_username := split_part(NEW.email, '@', 1);
  END IF;

  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    )
  );

  INSERT INTO public.user_accounts (
    user_id,
    username,
    contact_email,
    role,
    status
  )
  VALUES (
    NEW.id,
    local_username,
    CASE
      WHEN NEW.email LIKE '%@brepia.invalid' THEN NULL
      ELSE NEW.email
    END,
    'user',
    initial_status
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
CREATE OR REPLACE FUNCTION public.enforce_first_admin_bootstrap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  final_app_metadata jsonb;
  auth_provider text := 'email';
  bootstrap_requested boolean := false;
  is_first_user boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('brepia:first-admin'));

  SELECT raw_app_meta_data
  INTO final_app_metadata
  FROM auth.users
  WHERE id = NEW.id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  auth_provider := COALESCE(final_app_metadata->>'provider', 'email');
  bootstrap_requested :=
    COALESCE(final_app_metadata->>'brepia_bootstrap', 'false') = 'true';

  SELECT count(*) = 1
  INTO is_first_user
  FROM auth.users;

  IF is_first_user AND
     (auth_provider <> 'email' OR NOT bootstrap_requested) THEN
    RAISE EXCEPTION 'brepia_first_account_requires_bootstrap';
  END IF;

  IF bootstrap_requested AND NOT is_first_user THEN
    RAISE EXCEPTION 'brepia_bootstrap_unavailable';
  END IF;

  IF is_first_user THEN
    UPDATE public.user_accounts
    SET role = 'admin', status = 'active'
    WHERE user_id = NEW.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'brepia_bootstrap_account_state_missing';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_first_admin_bootstrap_on_auth_user_created ON auth.users;

CREATE CONSTRAINT TRIGGER enforce_first_admin_bootstrap_on_auth_user_created
  AFTER INSERT ON auth.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_admin_bootstrap();

CREATE OR REPLACE FUNCTION public.persist_brep_ai_revision(
  p_conversation_id uuid,
  p_expected_leaf_id uuid,
  p_message_id uuid,
  p_parts jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_leaf_id uuid;
BEGIN
  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'BRep AI revision parts must be a non-empty JSON array';
  END IF;
  IF jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'BRep AI revision metadata must be a JSON object';
  END IF;

  SELECT current_message_leaf_id
  INTO v_current_leaf_id
  FROM public.conversations
  WHERE id = p_conversation_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'conversation_not_found'
    );
  END IF;

  IF v_current_leaf_id IS DISTINCT FROM p_expected_leaf_id THEN
    RETURN jsonb_build_object(
      'accepted', false,
      'reason', 'stale',
      'currentLeafId', v_current_leaf_id
    );
  END IF;

  INSERT INTO public.messages (
    id,
    conversation_id,
    role,
    parts,
    metadata,
    parent_message_id,
    rating
  ) VALUES (
    p_message_id,
    p_conversation_id,
    'assistant',
    p_parts,
    COALESCE(p_metadata, '{}'::jsonb),
    p_expected_leaf_id,
    0
  );
  RETURN jsonb_build_object(
    'accepted', true,
    'messageId', p_message_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_brep_ai_revision(
  uuid, uuid, uuid, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_brep_ai_revision(
  uuid, uuid, uuid, jsonb, jsonb
) TO authenticated;

CREATE POLICY "Give users access to own folder images_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'images' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder images_insert" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'images' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder images_update" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'images' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder images_delete" ON storage.objects FOR DELETE TO public USING (bucket_id = 'images' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder meshes_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'meshes' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder meshes_insert" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'meshes' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder meshes_update" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'meshes' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder meshes_delete" ON storage.objects FOR DELETE TO public USING (bucket_id = 'meshes' AND (select auth.uid()::text) = (storage.foldername(name))[1]);
CREATE POLICY "Public conversations allow anyone to view images_select" ON storage.objects FOR SELECT TO anon, authenticated USING (((bucket_id = 'images'::text) AND (EXISTS ( SELECT 1 FROM conversations WHERE ((conversations.privacy = 'public') AND ((conversations.id)::text = (storage.foldername(objects.name))[2]))))));

CREATE POLICY "Public conversations allow anyone to view meshes_select" ON storage.objects FOR SELECT TO anon, authenticated USING (((bucket_id = 'meshes'::text) AND (EXISTS ( SELECT 1 FROM conversations WHERE ((conversations.privacy = 'public') AND ((conversations.id)::text = (storage.foldername(objects.name))[2]))))));
CREATE POLICY "Give users access to own folder previews_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'previews' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder previews_insert" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'previews' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder previews_update" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'previews' AND (select auth.uid()::text) = (storage.foldername(name))[1]);

CREATE POLICY "Give users access to own folder previews_delete" ON storage.objects FOR DELETE TO public USING (bucket_id = 'previews' AND (select auth.uid()::text) = (storage.foldername(name))[1]);
CREATE POLICY "Allow service role to upload temp multiview images"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'temp-multiview');
CREATE POLICY "Allow public read access to temp multiview images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'temp-multiview');
CREATE POLICY "Allow service role to delete temp multiview images"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'temp-multiview');
