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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      // These four table shapes are supplied by the unapplied, additive client/payment setup in docs/proposed-migrations/.
      client_accounts: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          id: string
          phone: string | null
          status: string
          tax_identifier: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          created_by: string
          display_name: string
          email?: string | null
          id?: string
          phone?: string | null
          status?: string
          tax_identifier?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          email?: string | null
          id?: string
          phone?: string | null
          status?: string
          tax_identifier?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      client_project_milestones: {
        Row: {
          created_at: string
          created_by: string
          due_date: string | null
          expected_amount: number
          id: string
          milestone_name: string
          project_id: string
          sequence: number
          status: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          due_date?: string | null
          expected_amount: number
          id?: string
          milestone_name: string
          project_id: string
          sequence?: number
          status?: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          due_date?: string | null
          expected_amount?: number
          id?: string
          milestone_name?: string
          project_id?: string
          sequence?: number
          status?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "client_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_project_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          milestone_id: string | null
          note: string | null
          paid_on: string
          payment_method: string
          project_id: string
          recorded_by: string
          reference: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          milestone_id?: string | null
          note?: string | null
          paid_on: string
          payment_method: string
          project_id: string
          recorded_by: string
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          milestone_id?: string | null
          note?: string | null
          paid_on?: string
          payment_method?: string
          project_id?: string
          recorded_by?: string
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_project_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "client_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_project_payments_milestone_project_fkey"
            columns: ["milestone_id", "project_id"]
            isOneToOne: false
            referencedRelation: "client_project_milestones"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      client_projects: {
        Row: {
          client_id: string
          contract_amount: number
          created_at: string
          created_by: string
          currency_code: string
          id: string
          notes: string | null
          project_code: string | null
          project_name: string
          start_date: string | null
          status: string
          target_date: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          client_id: string
          contract_amount: number
          created_at?: string
          created_by: string
          currency_code?: string
          id?: string
          notes?: string | null
          project_code?: string | null
          project_name: string
          start_date?: string | null
          status?: string
          target_date?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          client_id?: string
          contract_amount?: number
          created_at?: string
          created_by?: string
          currency_code?: string
          id?: string
          notes?: string | null
          project_code?: string | null
          project_name?: string
          start_date?: string | null
          status?: string
          target_date?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_correction_requests: {
        Row: {
          admin_note: string | null
          correction_type: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          reason: string
          requested_check_in: string | null
          requested_check_out: string | null
          status: string
          user_id: string
          work_date: string
        }
        Insert: {
          admin_note?: string | null
          correction_type: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          reason: string
          requested_check_in?: string | null
          requested_check_out?: string | null
          status?: string
          user_id: string
          work_date: string
        }
        Update: {
          admin_note?: string | null
          correction_type?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          reason?: string
          requested_check_in?: string | null
          requested_check_out?: string | null
          status?: string
          user_id?: string
          work_date?: string
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          check_in: string | null
          check_out: string | null
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
          work_date: string
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          work_date?: string
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          work_date?: string
        }
        Relationships: []
      }
      company_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          client_name: string
          content: Json
          created_at: string
          created_by: string
          document_number: string | null
          id: string
          module: string
          status: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          client_name?: string
          content?: Json
          created_at?: string
          created_by: string
          document_number?: string | null
          id?: string
          module: string
          status?: string
          title?: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          client_name?: string
          content?: Json
          created_at?: string
          created_by?: string
          document_number?: string | null
          id?: string
          module?: string
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      employee_admin_audit: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      employee_pay_settings: {
        Row: {
          advance_repayment_this_month: number
          monthly_additional_pay: number
          monthly_fixed_deduction: number
          monthly_salary: number
          overtime_hourly_rate: number
          salary_advance_balance: number
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          advance_repayment_this_month?: number
          monthly_additional_pay?: number
          monthly_fixed_deduction?: number
          monthly_salary?: number
          overtime_hourly_rate?: number
          salary_advance_balance?: number
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          advance_repayment_this_month?: number
          monthly_additional_pay?: number
          monthly_fixed_deduction?: number
          monthly_salary?: number
          overtime_hourly_rate?: number
          salary_advance_balance?: number
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      expense_records: {
        Row: {
          amount: number
          approval_status: string
          category: string
          created_at: string
          description: string
          expense_date: string
          expense_module: string
          id: string
          payment_method: string | null
          payment_status: string
          receipt_path: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          submitted_by: string
          updated_at: string
        }
        Insert: {
          amount: number
          approval_status?: string
          category: string
          created_at?: string
          description: string
          expense_date?: string
          expense_module: string
          id?: string
          payment_method?: string | null
          payment_status?: string
          receipt_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          submitted_by: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approval_status?: string
          category?: string
          created_at?: string
          description?: string
          expense_date?: string
          expense_module?: string
          id?: string
          payment_method?: string | null
          payment_status?: string
          receipt_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          submitted_by?: string
          updated_at?: string
        }
        Relationships: []
      }
      leave_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          leave_type: string
          reason: string
          start_date: string
          status: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          end_date: string
          id?: string
          leave_type: string
          reason: string
          start_date: string
          status?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string
          start_date?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      payroll_daily: {
        Row: {
          attendance_status: string
          daily_deduction: number
          day_type: string
          id: string
          note: string | null
          overtime_hours: number
          payable_fraction: number
          payroll_month_id: string
          user_id: string
          work_date: string
        }
        Insert: {
          attendance_status: string
          daily_deduction?: number
          day_type: string
          id?: string
          note?: string | null
          overtime_hours?: number
          payable_fraction?: number
          payroll_month_id: string
          user_id: string
          work_date: string
        }
        Update: {
          attendance_status?: string
          daily_deduction?: number
          day_type?: string
          id?: string
          note?: string | null
          overtime_hours?: number
          payable_fraction?: number
          payroll_month_id?: string
          user_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_daily_payroll_month_id_fkey"
            columns: ["payroll_month_id"]
            isOneToOne: false
            referencedRelation: "payroll_months"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_months: {
        Row: {
          absence_deduction: number
          additional_pay: number
          advance_repayment: number
          finalized_at: string | null
          finalized_by: string | null
          fixed_deduction: number
          generated_at: string
          gross_pay: number
          id: string
          monthly_salary: number
          net_pay: number
          overtime_hours: number
          overtime_pay: number
          payable_days: number
          payroll_month: string
          pending_attendance_days: number
          status: string
          user_id: string
          working_days: number
        }
        Insert: {
          absence_deduction: number
          additional_pay: number
          advance_repayment: number
          finalized_at?: string | null
          finalized_by?: string | null
          fixed_deduction: number
          generated_at?: string
          gross_pay: number
          id?: string
          monthly_salary: number
          net_pay: number
          overtime_hours: number
          overtime_pay: number
          payable_days: number
          payroll_month: string
          pending_attendance_days?: number
          status?: string
          user_id: string
          working_days: number
        }
        Update: {
          absence_deduction?: number
          additional_pay?: number
          advance_repayment?: number
          finalized_at?: string | null
          finalized_by?: string | null
          fixed_deduction?: number
          generated_at?: string
          gross_pay?: number
          id?: string
          monthly_salary?: number
          net_pay?: number
          overtime_hours?: number
          overtime_pay?: number
          payable_days?: number
          payroll_month?: string
          pending_attendance_days?: number
          status?: string
          user_id?: string
          working_days?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          can_edit_attendance: boolean
          can_edit_client_project_payments: boolean
          can_edit_flat_expense: boolean
          can_edit_holidays: boolean
          can_edit_invoices: boolean
          can_edit_leave: boolean
          can_edit_office_expense: boolean
          can_edit_payroll: boolean
          can_edit_payslip: boolean
          can_edit_surveys: boolean
          can_view_attendance: boolean
          can_view_client_project_payments: boolean
          can_view_flat_expense: boolean
          can_view_holidays: boolean
          can_view_invoices: boolean
          can_view_leave: boolean
          can_view_office_expense: boolean
          can_view_payroll: boolean
          can_view_payslip: boolean
          can_view_surveys: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          nav_attendance: boolean
          nav_client_project_payments: boolean
          nav_dashboard: boolean
          nav_flat_expense: boolean
          nav_holidays: boolean
          nav_leave: boolean
          nav_office_expense: boolean
          nav_payroll: boolean
          nav_payslip: boolean
          role: string
          updated_at: string
        }
        Insert: {
          can_edit_attendance?: boolean
          can_edit_client_project_payments?: boolean
          can_edit_flat_expense?: boolean
          can_edit_holidays?: boolean
          can_edit_invoices?: boolean
          can_edit_leave?: boolean
          can_edit_office_expense?: boolean
          can_edit_payroll?: boolean
          can_edit_payslip?: boolean
          can_edit_surveys?: boolean
          can_view_attendance?: boolean
          can_view_client_project_payments?: boolean
          can_view_flat_expense?: boolean
          can_view_holidays?: boolean
          can_view_invoices?: boolean
          can_view_leave?: boolean
          can_view_office_expense?: boolean
          can_view_payroll?: boolean
          can_view_payslip?: boolean
          can_view_surveys?: boolean
          created_at?: string
          email: string
          full_name?: string
          id: string
          is_active?: boolean
          nav_attendance?: boolean
          nav_client_project_payments?: boolean
          nav_dashboard?: boolean
          nav_flat_expense?: boolean
          nav_holidays?: boolean
          nav_leave?: boolean
          nav_office_expense?: boolean
          nav_payroll?: boolean
          nav_payslip?: boolean
          role?: string
          updated_at?: string
        }
        Update: {
          can_edit_attendance?: boolean
          can_edit_client_project_payments?: boolean
          can_edit_flat_expense?: boolean
          can_edit_holidays?: boolean
          can_edit_invoices?: boolean
          can_edit_leave?: boolean
          can_edit_office_expense?: boolean
          can_edit_payroll?: boolean
          can_edit_payslip?: boolean
          can_edit_surveys?: boolean
          can_view_attendance?: boolean
          can_view_client_project_payments?: boolean
          can_view_flat_expense?: boolean
          can_view_holidays?: boolean
          can_view_invoices?: boolean
          can_view_leave?: boolean
          can_view_office_expense?: boolean
          can_view_payroll?: boolean
          can_view_payslip?: boolean
          can_view_surveys?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          nav_attendance?: boolean
          nav_client_project_payments?: boolean
          nav_dashboard?: boolean
          nav_flat_expense?: boolean
          nav_holidays?: boolean
          nav_leave?: boolean
          nav_office_expense?: boolean
          nav_payroll?: boolean
          nav_payslip?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_initial_admin: { Args: never; Returns: undefined }
      sagt_attendance_check_in: { Args: never; Returns: Json }
      sagt_attendance_check_out: { Args: never; Returns: Json }
      sagt_can_access_module: {
        Args: { p_edit?: boolean; p_module: string }
        Returns: boolean
      }
      sagt_can_navigate_module: { Args: { p_module: string }; Returns: boolean }
      sagt_decide_employee_request: {
        Args: {
          p_admin_note?: string
          p_decision: string
          p_request_id: string
          p_table: string
        }
        Returns: undefined
      }
      sagt_finalize_monthly_payroll: {
        Args: { p_month: string }
        Returns: Json
      }
      sagt_generate_monthly_payroll: {
        Args: { p_month?: string }
        Returns: Json
      }
      sagt_is_admin: { Args: never; Returns: boolean }
      sagt_save_employee_pay_settings: {
        Args: {
          p_advance_repayment_this_month?: number
          p_monthly_additional_pay?: number
          p_monthly_fixed_deduction?: number
          p_monthly_salary: number
          p_overtime_hourly_rate?: number
          p_user_id: string
        }
        Returns: undefined
      }
      sagt_void_client_project_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
