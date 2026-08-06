export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'manager' | 'attendant'
export type ChannelType = 'whatsapp' | 'instagram'
export type ConversationStatus = 'open' | 'assigned' | 'closed' | 'archived'
export type AssignmentStatus = 'active' | 'transferred' | 'released'
export type SenderType = 'contact' | 'user' | 'system'
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type IntegrationProvider = 'whatsapp_meta' | 'instagram_meta'
export type IntegrationStatus = 'active' | 'inactive' | 'error'

export interface CustomPermissions {
  // Inbox / Atendimento
  view_all_conversations?: boolean
  assume_conversations?: boolean
  transfer_conversations?: boolean
  close_conversations?: boolean
  delete_messages?: boolean

  // Clientes
  create_clients?: boolean
  edit_clients?: boolean
  delete_clients?: boolean
  export_clients?: boolean
  view_client_notes?: boolean

  // Tarefas
  create_tasks?: boolean
  assign_tasks_to_others?: boolean
  delete_tasks?: boolean

  // Relatórios
  view_reports?: boolean
  export_reports?: boolean

  // Equipe & Configurações
  manage_attendants?: boolean
  manage_integrations?: boolean
}

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          email: string
          avatar_url: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          email: string
          avatar_url?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          avatar_url?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: UserRole
          permissions: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role: UserRole
          permissions?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: UserRole
          permissions?: Json
          created_at?: string
          updated_at?: string
        }
      }
      contacts: {
        Row: {
          id: string
          organization_id: string
          name: string
          email: string | null
          phone: string | null
          avatar_url: string | null
          status: 'active' | 'archived' | 'blocked'
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          email?: string | null
          phone?: string | null
          avatar_url?: string | null
          status?: 'active' | 'archived' | 'blocked'
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          email?: string | null
          phone?: string | null
          avatar_url?: string | null
          status?: 'active' | 'archived' | 'blocked'
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      contact_channels: {
        Row: {
          id: string
          organization_id: string
          contact_id: string
          channel_type: ChannelType
          external_id: string
          identifier: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          contact_id: string
          channel_type: ChannelType
          external_id: string
          identifier: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          contact_id?: string
          channel_type?: ChannelType
          external_id?: string
          identifier?: string
          created_at?: string
          updated_at?: string
        }
      }
      conversations: {
        Row: {
          id: string
          organization_id: string
          contact_id: string
          channel_type: ChannelType
          status: ConversationStatus
          current_assignee_id: string | null
          last_message_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          contact_id: string
          channel_type: ChannelType
          status?: ConversationStatus
          current_assignee_id?: string | null
          last_message_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          contact_id?: string
          channel_type?: ChannelType
          status?: ConversationStatus
          current_assignee_id?: string | null
          last_message_at?: string
          created_at?: string
          updated_at?: string
        }
      }
      conversation_assignments: {
        Row: {
          id: string
          organization_id: string
          conversation_id: string
          assigned_to_id: string
          assigned_by_id: string
          status: AssignmentStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          conversation_id: string
          assigned_to_id: string
          assigned_by_id: string
          status?: AssignmentStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          conversation_id?: string
          assigned_to_id?: string
          assigned_by_id?: string
          status?: AssignmentStatus
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          organization_id: string
          conversation_id: string
          sender_type: SenderType
          sender_id: string | null
          content: string
          media_url: string | null
          status: MessageStatus
          external_id: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          conversation_id: string
          sender_type: SenderType
          sender_id?: string | null
          content: string
          media_url?: string | null
          status?: MessageStatus
          external_id?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          conversation_id?: string
          sender_type?: SenderType
          sender_id?: string | null
          content?: string
          media_url?: string | null
          status?: MessageStatus
          external_id?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
      }
      tags: {
        Row: {
          id: string
          organization_id: string
          name: string
          color: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          color?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          color?: string
          created_at?: string
          updated_at?: string
        }
      }
      contact_tags: {
        Row: {
          id: string
          organization_id: string
          contact_id: string
          tag_id: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          contact_id: string
          tag_id: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          contact_id?: string
          tag_id?: string
          created_at?: string
        }
      }
      internal_notes: {
        Row: {
          id: string
          organization_id: string
          conversation_id: string
          author_id: string
          content: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          conversation_id: string
          author_id: string
          content: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          conversation_id?: string
          author_id?: string
          content?: string
          created_at?: string
          updated_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          organization_id: string
          title: string
          description: string | null
          due_date: string | null
          status: TaskStatus
          assigned_to_id: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          title: string
          description?: string | null
          due_date?: string | null
          status?: TaskStatus
          assigned_to_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          title?: string
          description?: string | null
          due_date?: string | null
          status?: TaskStatus
          assigned_to_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      audit_logs: {
        Row: {
          id: string
          organization_id: string
          actor_id: string | null
          action: string
          target_type: string
          target_id: string | null
          details: Json
          ip_address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          actor_id?: string | null
          action: string
          target_type: string
          target_id?: string | null
          details?: Json
          ip_address?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          actor_id?: string | null
          action?: string
          target_type?: string
          target_id?: string | null
          details?: Json
          ip_address?: string | null
          created_at?: string
        }
      }
      integration_connections: {
        Row: {
          id: string
          organization_id: string
          provider: IntegrationProvider
          status: IntegrationStatus
          encrypted_credentials: string | null
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          provider: IntegrationProvider
          status?: IntegrationStatus
          encrypted_credentials?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          provider?: IntegrationProvider
          status?: IntegrationStatus
          encrypted_credentials?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
      }
      webhook_events: {
        Row: {
          id: string
          provider: string
          external_event_id: string
          event_type: string
          payload: Json
          processed: boolean
          processed_at: string | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          provider: string
          external_event_id: string
          event_type: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          provider?: string
          external_event_id?: string
          event_type?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          error_message?: string | null
          created_at?: string
        }
      }
    }
  }
}
