export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_reports: {
        Row: {
          ai_status: string
          audit_type: string
          created_at: string
          file_path: string | null
          findings: Json | null
          id: string
          proposal_id: string
          score: number | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_status?: string
          audit_type?: string
          created_at?: string
          file_path?: string | null
          findings?: Json | null
          id?: string
          proposal_id: string
          score?: number | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_status?: string
          audit_type?: string
          created_at?: string
          file_path?: string | null
          findings?: Json | null
          id?: string
          proposal_id?: string
          score?: number | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_reports_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "bid_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_analyses: {
        Row: {
          ai_status: string
          bid_deadline: string | null
          bid_location: string | null
          business_keywords: Json | null
          created_at: string
          custom_prompt: string | null
          deposit_amount: string | null
          disqualification_items: Json | null
          document_id: string | null
          file_path: string | null
          id: string
          personnel_requirements: Json | null
          project_name: string | null
          requires_presentation: boolean | null
          responsibility_keywords: Json | null
          risk_score: number | null
          scoring_table: Json | null
          summary: string | null
          technical_keywords: Json | null
          trap_items: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_status?: string
          bid_deadline?: string | null
          bid_location?: string | null
          business_keywords?: Json | null
          created_at?: string
          custom_prompt?: string | null
          deposit_amount?: string | null
          disqualification_items?: Json | null
          document_id?: string | null
          file_path?: string | null
          id?: string
          personnel_requirements?: Json | null
          project_name?: string | null
          requires_presentation?: boolean | null
          responsibility_keywords?: Json | null
          risk_score?: number | null
          scoring_table?: Json | null
          summary?: string | null
          technical_keywords?: Json | null
          trap_items?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_status?: string
          bid_deadline?: string | null
          bid_location?: string | null
          business_keywords?: Json | null
          created_at?: string
          custom_prompt?: string | null
          deposit_amount?: string | null
          disqualification_items?: Json | null
          document_id?: string | null
          file_path?: string | null
          id?: string
          personnel_requirements?: Json | null
          project_name?: string | null
          requires_presentation?: boolean | null
          responsibility_keywords?: Json | null
          risk_score?: number | null
          scoring_table?: Json | null
          summary?: string | null
          technical_keywords?: Json | null
          trap_items?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_analyses_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_proposals: {
        Row: {
          ai_status: string
          bid_analysis_id: string | null
          created_at: string
          custom_prompt: string | null
          id: string
          outline_content: string | null
          project_name: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_status?: string
          bid_analysis_id?: string | null
          created_at?: string
          custom_prompt?: string | null
          id?: string
          outline_content?: string | null
          project_name?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_status?: string
          bid_analysis_id?: string | null
          created_at?: string
          custom_prompt?: string | null
          id?: string
          outline_content?: string | null
          project_name?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_proposals_bid_analysis_id_fkey"
            columns: ["bid_analysis_id"]
            isOneToOne: false
            referencedRelation: "bid_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_metadata: Json | null
          ai_status: string
          ai_summary: string | null
          amount_range: string | null
          created_at: string
          doc_category: string | null
          doc_year: number | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string | null
          id: string
          industry: string | null
          owner_name: string | null
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_metadata?: Json | null
          ai_status?: string
          ai_summary?: string | null
          amount_range?: string | null
          created_at?: string
          doc_category?: string | null
          doc_year?: number | null
          file_name: string
          file_path: string
          file_size?: number
          file_type?: string | null
          id?: string
          industry?: string | null
          owner_name?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_metadata?: Json | null
          ai_status?: string
          ai_summary?: string | null
          amount_range?: string | null
          created_at?: string
          doc_category?: string | null
          doc_year?: number | null
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string | null
          id?: string
          industry?: string | null
          owner_name?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          birth_year: number | null
          certifications: string[] | null
          created_at: string
          current_company: string | null
          current_position: string | null
          education: string | null
          gender: string | null
          id: string
          major: string | null
          name: string
          notes: string | null
          skills: string[] | null
          updated_at: string
          user_id: string
          years_of_experience: number | null
        }
        Insert: {
          birth_year?: number | null
          certifications?: string[] | null
          created_at?: string
          current_company?: string | null
          current_position?: string | null
          education?: string | null
          gender?: string | null
          id?: string
          major?: string | null
          name: string
          notes?: string | null
          skills?: string[] | null
          updated_at?: string
          user_id: string
          years_of_experience?: number | null
        }
        Update: {
          birth_year?: number | null
          certifications?: string[] | null
          created_at?: string
          current_company?: string | null
          current_position?: string | null
          education?: string | null
          gender?: string | null
          id?: string
          major?: string | null
          name?: string
          notes?: string | null
          skills?: string[] | null
          updated_at?: string
          user_id?: string
          years_of_experience?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          department: string | null
          full_name: string | null
          id: string
          is_approved: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          department?: string | null
          full_name?: string | null
          id?: string
          is_approved?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          department?: string | null
          full_name?: string | null
          id?: string
          is_approved?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proposal_materials: {
        Row: {
          created_at: string
          id: string
          matched_document_id: string | null
          matched_file_path: string | null
          material_name: string | null
          notes: string | null
          proposal_id: string
          requirement_text: string
          requirement_type: string
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          matched_document_id?: string | null
          matched_file_path?: string | null
          material_name?: string | null
          notes?: string | null
          proposal_id: string
          requirement_text: string
          requirement_type?: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          matched_document_id?: string | null
          matched_file_path?: string | null
          material_name?: string | null
          notes?: string | null
          proposal_id?: string
          requirement_text?: string
          requirement_type?: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_materials_matched_document_id_fkey"
            columns: ["matched_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_materials_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "bid_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_sections: {
        Row: {
          content: string | null
          created_at: string
          id: string
          parent_id: string | null
          proposal_id: string
          section_number: string | null
          sort_order: number
          source_id: string | null
          source_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          parent_id?: string | null
          proposal_id: string
          section_number?: string | null
          sort_order?: number
          source_id?: string | null
          source_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          parent_id?: string | null
          proposal_id?: string
          section_number?: string | null
          sort_order?: number
          source_id?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_sections_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "proposal_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_sections_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "bid_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_versions: {
        Row: {
          ai_status: string
          content: string | null
          created_at: string
          education_history: Json | null
          employee_id: string
          file_path: string | null
          id: string
          match_details: Json | null
          match_score: number | null
          polished_content: string | null
          project_experiences: Json | null
          target_industry: string | null
          target_role: string | null
          timeline_issues: Json | null
          updated_at: string
          user_id: string
          version_name: string
          work_experiences: Json | null
        }
        Insert: {
          ai_status?: string
          content?: string | null
          created_at?: string
          education_history?: Json | null
          employee_id: string
          file_path?: string | null
          id?: string
          match_details?: Json | null
          match_score?: number | null
          polished_content?: string | null
          project_experiences?: Json | null
          target_industry?: string | null
          target_role?: string | null
          timeline_issues?: Json | null
          updated_at?: string
          user_id: string
          version_name?: string
          work_experiences?: Json | null
        }
        Update: {
          ai_status?: string
          content?: string | null
          created_at?: string
          education_history?: Json | null
          employee_id?: string
          file_path?: string | null
          id?: string
          match_details?: Json | null
          match_score?: number | null
          polished_content?: string | null
          project_experiences?: Json | null
          target_industry?: string | null
          target_role?: string | null
          timeline_issues?: Json | null
          updated_at?: string
          user_id?: string
          version_name?: string
          work_experiences?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "resume_versions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
