export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_local_model_metadata: {
        Row: {
          context_limit: number | null;
          created_at: string;
          display_name: string | null;
          id: string;
          is_visible: boolean;
          model_id: string;
          output_limit: number | null;
          supports_thinking: boolean;
          supports_tools: boolean;
          supports_vision: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          context_limit?: number | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          is_visible?: boolean;
          model_id: string;
          output_limit?: number | null;
          supports_thinking?: boolean;
          supports_tools?: boolean;
          supports_vision?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          context_limit?: number | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          is_visible?: boolean;
          model_id?: string;
          output_limit?: number | null;
          supports_thinking?: boolean;
          supports_tools?: boolean;
          supports_vision?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ai_provider_models: {
        Row: {
          context_limit: number | null;
          created_at: string;
          description: string | null;
          display_name: string;
          id: string;
          is_visible: boolean;
          model_id: string;
          output_limit: number | null;
          provider_id: string;
          supports_thinking: boolean;
          supports_tools: boolean;
          supports_vision: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          context_limit?: number | null;
          created_at?: string;
          description?: string | null;
          display_name: string;
          id?: string;
          is_visible?: boolean;
          model_id: string;
          output_limit?: number | null;
          provider_id: string;
          supports_thinking?: boolean;
          supports_tools?: boolean;
          supports_vision?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          context_limit?: number | null;
          created_at?: string;
          description?: string | null;
          display_name?: string;
          id?: string;
          is_visible?: boolean;
          model_id?: string;
          output_limit?: number | null;
          provider_id?: string;
          supports_thinking?: boolean;
          supports_tools?: boolean;
          supports_vision?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_provider_models_provider_id_fkey';
            columns: ['provider_id'];
            isOneToOne: false;
            referencedRelation: 'ai_providers';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_providers: {
        Row: {
          base_url: string;
          created_at: string;
          credential_ciphertext: string | null;
          credential_iv: string | null;
          credential_tag: string | null;
          driver: string;
          enabled: boolean;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          base_url: string;
          created_at?: string;
          credential_ciphertext?: string | null;
          credential_iv?: string | null;
          credential_tag?: string | null;
          driver: string;
          enabled?: boolean;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          base_url?: string;
          created_at?: string;
          credential_ciphertext?: string | null;
          credential_iv?: string | null;
          credential_tag?: string | null;
          driver?: string;
          enabled?: boolean;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          created_at: string | null;
          current_message_leaf_id: string | null;
          id: string;
          privacy: Database['public']['Enums']['privacy_type'];
          settings: Json;
          title: string;
          type: Database['public']['Enums']['conversation-type'];
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          current_message_leaf_id?: string | null;
          id?: string;
          privacy?: Database['public']['Enums']['privacy_type'];
          settings?: Json;
          title: string;
          type?: Database['public']['Enums']['conversation-type'];
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          current_message_leaf_id?: string | null;
          id?: string;
          privacy?: Database['public']['Enums']['privacy_type'];
          settings?: Json;
          title?: string;
          type?: Database['public']['Enums']['conversation-type'];
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      generation_runs: {
        Row: {
          actual_model_id: string | null;
          completed_at: string | null;
          conversation_id: string;
          created_at: string;
          detail: string | null;
          error_code: string | null;
          error_message: string | null;
          execution_mode: string | null;
          id: string;
          kind: string;
          phase: string;
          request_message_id: string;
          requested_model_id: string;
          response_message_id: string | null;
          sequence: number;
          started_at: string | null;
          status: string;
          transport_kind: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          actual_model_id?: string | null;
          completed_at?: string | null;
          conversation_id: string;
          created_at?: string;
          detail?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          execution_mode?: string | null;
          id?: string;
          kind: string;
          phase?: string;
          request_message_id: string;
          requested_model_id: string;
          response_message_id?: string | null;
          sequence?: number;
          started_at?: string | null;
          status?: string;
          transport_kind?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          actual_model_id?: string | null;
          completed_at?: string | null;
          conversation_id?: string;
          created_at?: string;
          detail?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          execution_mode?: string | null;
          id?: string;
          kind?: string;
          phase?: string;
          request_message_id?: string;
          requested_model_id?: string;
          response_message_id?: string | null;
          sequence?: number;
          started_at?: string | null;
          status?: string;
          transport_kind?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'generation_runs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      images: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          image_generation_call_id: string | null;
          prompt: Json;
          status: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id?: string;
          image_generation_call_id?: string | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          image_generation_call_id?: string | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'images_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      instance_settings: {
        Row: {
          community_label: string;
          community_url: string | null;
          contact_email: string | null;
          created_at: string;
          discord_url: string | null;
          id: number;
          legal_pages_enabled: boolean;
          operator_name: string | null;
          privacy_url: string | null;
          show_community_link: boolean;
          terms_url: string | null;
          updated_at: string;
        };
        Insert: {
          community_label?: string;
          community_url?: string | null;
          contact_email?: string | null;
          created_at?: string;
          discord_url?: string | null;
          id?: number;
          legal_pages_enabled?: boolean;
          operator_name?: string | null;
          privacy_url?: string | null;
          show_community_link?: boolean;
          terms_url?: string | null;
          updated_at?: string;
        };
        Update: {
          community_label?: string;
          community_url?: string | null;
          contact_email?: string | null;
          created_at?: string;
          discord_url?: string | null;
          id?: number;
          legal_pages_enabled?: boolean;
          operator_name?: string | null;
          privacy_url?: string | null;
          show_community_link?: boolean;
          terms_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      meshes: {
        Row: {
          conversation_id: string;
          created_at: string;
          file_type: Database['public']['Enums']['mesh_file_type'];
          id: string;
          images: string[] | null;
          prompt: Json;
          status: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          file_type?: Database['public']['Enums']['mesh_file_type'];
          id?: string;
          images?: string[] | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          file_type?: Database['public']['Enums']['mesh_file_type'];
          id?: string;
          images?: string[] | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meshes_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          content: Json | null;
          conversation_id: string;
          created_at: string;
          id: string;
          metadata: Json;
          parent_message_id: string | null;
          parts: Json;
          rating: number;
          role: string;
        };
        Insert: {
          content?: Json | null;
          conversation_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          parent_message_id?: string | null;
          parts?: Json;
          rating?: number;
          role: string;
        };
        Update: {
          content?: Json | null;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          parent_message_id?: string | null;
          parts?: Json;
          rating?: number;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      previews: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          mesh_id: string;
          status: Database['public']['Enums']['generation-status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id?: string;
          mesh_id: string;
          status?: Database['public']['Enums']['generation-status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          mesh_id?: string;
          status?: Database['public']['Enums']['generation-status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'previews_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'previews_mesh_id_fkey';
            columns: ['mesh_id'];
            isOneToOne: false;
            referencedRelation: 'meshes';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          avatar_preset: string | null;
          created_at: string;
          full_name: string;
          id: string;
          notifications_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_path?: string | null;
          avatar_preset?: string | null;
          created_at?: string;
          full_name: string;
          id?: string;
          notifications_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_path?: string | null;
          avatar_preset?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          notifications_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      prompt_profiles: {
        Row: {
          archived: boolean;
          base_revision: string | null;
          created_at: string;
          description: string | null;
          id: string;
          mode: string;
          name: string;
          prompt_template: string;
          scope: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived?: boolean;
          base_revision?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          mode?: string;
          name: string;
          prompt_template: string;
          scope?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived?: boolean;
          base_revision?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          mode?: string;
          name?: string;
          prompt_template?: string;
          scope?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      prompts: {
        Row: {
          created_at: string;
          id: number;
          type: Database['public']['Enums']['prompt_type'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          type?: Database['public']['Enums']['prompt_type'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          type?: Database['public']['Enums']['prompt_type'];
          user_id?: string;
        };
        Relationships: [];
      };
      registration_settings: {
        Row: {
          allow_registration: boolean;
          allowed_social_providers: string[];
          created_at: string;
          id: number;
          identity_policy: string;
          require_admin_approval: boolean;
          updated_at: string;
        };
        Insert: {
          allow_registration?: boolean;
          allowed_social_providers?: string[];
          created_at?: string;
          id?: number;
          identity_policy?: string;
          require_admin_approval?: boolean;
          updated_at?: string;
        };
        Update: {
          allow_registration?: boolean;
          allowed_social_providers?: string[];
          created_at?: string;
          id?: number;
          identity_policy?: string;
          require_admin_approval?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_accounts: {
        Row: {
          contact_email: string | null;
          created_at: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
          username: string | null;
        };
        Insert: {
          contact_email?: string | null;
          created_at?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          username?: string | null;
        };
        Update: {
          contact_email?: string | null;
          created_at?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      user_ai_preferences: {
        Row: {
          created_at: string;
          default_creative_model_id: string | null;
          default_creative_prompt_profile_id: string | null;
          default_instruction_profile_id: string;
          default_parametric_model_id: string | null;
          default_prompt_profile_id: string | null;
          enabled_opencode_model_ids: string[];
          hidden_model_ids: string[];
          instruction_profile_defaults: Json;
          model_routing: Json;
          runtime_overrides: Json;
          updated_at: string;
          user_id: string;
          vision_deep_model_id: string | null;
          vision_fast_model_id: string | null;
        };
        Insert: {
          created_at?: string;
          default_creative_model_id?: string | null;
          default_creative_prompt_profile_id?: string | null;
          default_instruction_profile_id?: string;
          default_parametric_model_id?: string | null;
          default_prompt_profile_id?: string | null;
          enabled_opencode_model_ids?: string[];
          hidden_model_ids?: string[];
          instruction_profile_defaults?: Json;
          model_routing?: Json;
          runtime_overrides?: Json;
          updated_at?: string;
          user_id: string;
          vision_deep_model_id?: string | null;
          vision_fast_model_id?: string | null;
        };
        Update: {
          created_at?: string;
          default_creative_model_id?: string | null;
          default_creative_prompt_profile_id?: string | null;
          default_instruction_profile_id?: string;
          default_parametric_model_id?: string | null;
          default_prompt_profile_id?: string | null;
          enabled_opencode_model_ids?: string[];
          hidden_model_ids?: string[];
          instruction_profile_defaults?: Json;
          model_routing?: Json;
          runtime_overrides?: Json;
          updated_at?: string;
          user_id?: string;
          vision_deep_model_id?: string | null;
          vision_fast_model_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      persist_brep_ai_revision: {
        Args: {
          p_conversation_id: string;
          p_expected_leaf_id: string;
          p_message_id: string;
          p_metadata?: Json;
          p_parts: Json;
        };
        Returns: Json;
      };
      set_conversation_suggestions: {
        Args: { p_conversation_id: string; p_suggestions: Json };
        Returns: undefined;
      };
    };
    Enums: {
      'conversation-type': 'parametric' | 'creative';
      'generation-status': 'pending' | 'success' | 'failure';
      mesh_file_type: 'glb' | 'stl' | 'obj' | 'fbx';
      mesh_model_type: 'quality' | 'fast';
      privacy_type: 'public' | 'private';
      prompt_type: 'mesh' | 'image' | 'chat';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      'conversation-type': ['parametric', 'creative'],
      'generation-status': ['pending', 'success', 'failure'],
      mesh_file_type: ['glb', 'stl', 'obj', 'fbx'],
      mesh_model_type: ['quality', 'fast'],
      privacy_type: ['public', 'private'],
      prompt_type: ['mesh', 'image', 'chat'],
    },
  },
} as const;
