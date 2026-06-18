export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      organizations: {
        Row: {
          created_at: string | null;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string | null;
          display_name: string | null;
          id: string;
          organization_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          display_name?: string | null;
          id: string;
          organization_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          display_name?: string | null;
          id?: string;
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          architect: string | null;
          contractor: string | null;
          created_at: string | null;
          created_by: string | null;
          data: Json | null;
          id: string;
          job_address: string | null;
          job_address2: string | null;
          job_name: string;
          job_number: string;
          organization_id: string | null;
          owner: string | null;
          updated_at: string | null;
        };
        Insert: {
          architect?: string | null;
          contractor?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          data?: Json | null;
          id?: string;
          job_address?: string | null;
          job_address2?: string | null;
          job_name?: string;
          job_number: string;
          organization_id?: string | null;
          owner?: string | null;
          updated_at?: string | null;
        };
        Update: {
          architect?: string | null;
          contractor?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          data?: Json | null;
          id?: string;
          job_address?: string | null;
          job_address2?: string | null;
          job_name?: string;
          job_number?: string;
          organization_id?: string | null;
          owner?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      rfis: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          data: Json | null;
          id: string;
          project_id: string | null;
          question: string | null;
          rfi_number: string | null;
          status: string | null;
          subject: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          data?: Json | null;
          id?: string;
          project_id?: string | null;
          question?: string | null;
          rfi_number?: string | null;
          status?: string | null;
          subject?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          data?: Json | null;
          id?: string;
          project_id?: string | null;
          question?: string | null;
          rfi_number?: string | null;
          status?: string | null;
          subject?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rfis_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      submittals: {
        Row: {
          id: string;
          project_id: string;
          line_number: string;
          description: string;
          spec_section: string;
          submittal_type: string;
          scope: string;
          status: string;
          result_code: string;
          data: Json | null;
          created_by: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          line_number?: string;
          description?: string;
          spec_section?: string;
          submittal_type?: string;
          scope?: string;
          status?: string;
          result_code?: string;
          data?: Json | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          line_number?: string;
          description?: string;
          spec_section?: string;
          submittal_type?: string;
          scope?: string;
          status?: string;
          result_code?: string;
          data?: Json | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "submittals_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
