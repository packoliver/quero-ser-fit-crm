import { z } from 'zod'

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'E-mail é obrigatório')
    .email('Informe um endereço de e-mail válido'),
  password: z
    .string()
    .min(1, 'Senha é obrigatória')
    .min(6, 'A senha deve ter pelo menos 6 caracteres'),
})

export const recoverPasswordSchema = z.object({
  email: z
    .string()
    .min(1, 'E-mail é obrigatório')
    .email('Informe um endereço de e-mail válido'),
})

export const contactSchema = z.object({
  name: z
    .string()
    .min(1, 'Nome do cliente é obrigatório')
    .min(2, 'O nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z
    .string()
    .min(8, 'Telefone deve ter ao menos 8 dígitos')
    .optional()
    .or(z.literal('')),
  notes: z.string().optional(),
})

export const transferConversationSchema = z.object({
  conversationId: z.string().uuid('ID de conversa inválido'),
  targetAttendantId: z.string().uuid('ID de atendente inválido'),
  reason: z.string().optional(),
})

export const taskSchema = z.object({
  title: z.string().min(3, 'O título da tarefa deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  assignedToId: z.string().uuid().optional().or(z.literal('')),
  contactId: z.string().uuid().optional().or(z.literal('')),
})

export const memberCreateSchema = z.object({
  email: z.string().email('E-mail inválido'),
  fullName: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  role: z.enum(['admin', 'manager', 'attendant']),
  password: z
    .string()
    .min(8, 'A senha temporária deve ter pelo menos 8 caracteres')
    .max(72, 'A senha temporária deve ter no máximo 72 caracteres'),
})

export const createConnectionSchema = z.discriminatedUnion('connectionMethod', [
  z.object({
    connectionMethod: z.literal('cloud_api'),
    provider: z.enum(['whatsapp_meta', 'instagram_meta']),
    label: z.string().min(2, 'Dê um nome pra essa conexão (ex: Loja Centro)').max(60),
    externalIdentifier: z
      .string()
      .min(3, 'Informe o Phone Number ID (WhatsApp) ou Page ID (Instagram)'),
    accessToken: z.string().min(20, 'Token de acesso inválido ou incompleto'),
  }),
  z.object({
    connectionMethod: z.literal('qr_code'),
    provider: z.literal('whatsapp_meta'),
    label: z.string().min(2, 'Dê um nome pra essa conexão (ex: Loja Centro)').max(60),
  }),
])

export const changePasswordSchema = z.object({
  password: z
    .string()
    .min(8, 'A nova senha deve ter pelo menos 8 caracteres')
    .max(72, 'A nova senha deve ter no máximo 72 caracteres'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RecoverPasswordInput = z.infer<typeof recoverPasswordSchema>
export type ContactInput = z.infer<typeof contactSchema>
export type TransferConversationInput = z.infer<typeof transferConversationSchema>
export type TaskInput = z.infer<typeof taskSchema>
export type MemberCreateInput = z.infer<typeof memberCreateSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
