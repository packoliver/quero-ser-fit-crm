import { ChannelType, ConversationStatus, DealStage, TaskStatus, UserRole } from '@/types/database'

export interface DemoMessage {
  id: string
  senderType: 'contact' | 'user' | 'system'
  senderName: string
  content: string
  time: string
}

export interface DemoConversation {
  id: string
  contactId?: string
  contactName: string
  contactPhone: string
  contactAvatarUrl?: string
  channel: ChannelType
  lastMessage: string
  lastMessageTime: string
  status: ConversationStatus
  currentAssigneeId: string | null
  currentAssigneeName: string | null
  tags: string[]
  notes: Array<{ id: string; author: string; text: string; date: string }>
  messages: DemoMessage[]
  isDemo: true
}

export interface DemoContact {
  id: string
  name: string
  email: string
  phone: string
  channels: ChannelType[]
  tags: string[]
  status: 'active' | 'archived'
  notes: string
  createdAt: string
  isDemo: true
}

export interface DemoTask {
  id: string
  title: string
  description: string
  dueDate: string
  status: TaskStatus
  assigneeId: string
  assigneeName: string
  clientName: string
  contactId?: string
  priority: 'alta' | 'media' | 'baixa'
  isDemo: true
}

export interface DemoDeal {
  id: string
  title: string
  contactId: string
  contactName: string
  value: number | null
  stage: DealStage
  notes: string
  createdAt: string
  isDemo: true
}

export interface DemoTeamMember {
  id: string
  fullName: string
  email: string
  role: UserRole
  status: 'active' | 'invited' | 'inactive'
  joinedAt: string
  avatarUrl?: string
  isDemo: true
}

export interface DemoIntegrationCard {
  id: string
  name: string
  provider: 'whatsapp_meta' | 'instagram_meta' | 'pontuamax'
  status: 'not_configured' | 'active'
  description: string
  releasePhase: string
  isDemo: true
}

export const demoAttendants: DemoTeamMember[] = [
  {
    id: 'att-1',
    fullName: 'Patricia Silva (Você)',
    email: 'admin@queroserfit.com.br',
    role: 'admin',
    status: 'active',
    joinedAt: '01/01/2026',
    isDemo: true,
  },
  {
    id: 'att-2',
    fullName: 'Carlos Atendimento',
    email: 'carlos@queroserfit.com.br',
    role: 'attendant',
    status: 'active',
    joinedAt: '10/02/2026',
    isDemo: true,
  },
  {
    id: 'att-3',
    fullName: 'Fernanda Vendas',
    email: 'fernanda@queroserfit.com.br',
    role: 'attendant',
    status: 'invited',
    joinedAt: '01/08/2026',
    isDemo: true,
  },
]

export const demoConversations: DemoConversation[] = [
  {
    id: 'conv-1',
    contactName: 'Mariana Medeiros',
    contactPhone: '+55 11 98877-6655',
    channel: 'whatsapp',
    lastMessage: 'Olá! Qual o valor do kit marmitas fit semanal?',
    lastMessageTime: '10:42',
    status: 'open',
    currentAssigneeId: null,
    currentAssigneeName: null,
    tags: ['Novo Cliente', 'Marmita Fit'],
    notes: [
      { id: 'n-1', author: 'Patricia Silva', text: 'Cliente interessada em planos mensais de refeição.', date: '10:43' },
    ],
    messages: [
      { id: 'm-1', senderType: 'contact', senderName: 'Mariana Medeiros', content: 'Bom dia! Gostaria de saber os sabores disponíveis essa semana.', time: '10:40' },
      { id: 'm-2', senderType: 'contact', senderName: 'Mariana Medeiros', content: 'Olá! Qual o valor do kit marmitas fit semanal?', time: '10:42' },
    ],
    isDemo: true,
  },
  {
    id: 'conv-2',
    contactName: 'Lucas Andrade (@lucas.fit)',
    contactPhone: '+55 21 97654-3210',
    channel: 'instagram',
    lastMessage: 'Vocês fazem entrega na região da Barra?',
    lastMessageTime: '09:15',
    status: 'assigned',
    currentAssigneeId: 'att-2',
    currentAssigneeName: 'Carlos Atendimento',
    tags: ['Instagram Direct', 'Dúvida Entrega'],
    notes: [],
    messages: [
      { id: 'm-3', senderType: 'contact', senderName: 'Lucas Andrade', content: 'Vocês fazem entrega na região da Barra?', time: '09:15' },
      { id: 'm-4', senderType: 'user', senderName: 'Carlos Atendimento', content: 'Olá Lucas! Entregamos sim, via motoboy expresso.', time: '09:18' },
    ],
    isDemo: true,
  },
  {
    id: 'conv-3',
    contactName: 'Juliana Paes',
    contactPhone: '+55 31 99123-4567',
    channel: 'whatsapp',
    lastMessage: 'Perfeito, pagamento efetuado via PIX!',
    lastMessageTime: 'Ontem',
    status: 'closed',
    currentAssigneeId: 'att-1',
    currentAssigneeName: 'Patricia Silva (Você)',
    tags: ['Venda Concluída', 'PIX'],
    notes: [
      { id: 'n-2', author: 'Patricia Silva', text: 'Pedido #4928 aprovado e enviado para a cozinha.', date: 'Ontem 16:30' },
    ],
    messages: [
      { id: 'm-5', senderType: 'contact', senderName: 'Juliana Paes', content: 'Perfeito, pagamento efetuado via PIX!', time: 'Ontem 16:25' },
      { id: 'm-6', senderType: 'user', senderName: 'Patricia Silva', content: 'Excelente Juliana! Seu pedido já está agendado.', time: 'Ontem 16:28' },
    ],
    isDemo: true,
  },
]

export const demoContacts: DemoContact[] = [
  {
    id: 'c-1',
    name: 'Mariana Medeiros',
    email: 'mariana.medeiros@gmail.com',
    phone: '+55 11 98877-6655',
    channels: ['whatsapp'],
    tags: ['Novo Cliente', 'Marmita Fit'],
    status: 'active',
    notes: 'Interessada em assinaturas semanais com entrega na zona sul.',
    createdAt: '01/08/2026',
    isDemo: true,
  },
  {
    id: 'c-2',
    name: 'Lucas Andrade',
    email: 'lucas.andrade@outlook.com',
    phone: '+55 21 97654-3210',
    channels: ['instagram'],
    tags: ['Instagram Direct', 'Dúvida Entrega'],
    status: 'active',
    notes: 'Solicitou cardápio Low Carb para treinos de alta intensidade.',
    createdAt: '03/08/2026',
    isDemo: true,
  },
  {
    id: 'c-3',
    name: 'Juliana Paes',
    email: 'juliana.paes@fitcorp.com.br',
    phone: '+55 31 99123-4567',
    channels: ['whatsapp', 'instagram'],
    tags: ['Venda Concluída', 'PIX', 'Frequente'],
    status: 'active',
    notes: 'Cliente fiel. Prefere marmitas sem pimentão.',
    createdAt: '15/07/2026',
    isDemo: true,
  },
]

export const demoTasks: DemoTask[] = [
  {
    id: 't-1',
    title: 'Enviar orçamento de kit mensal',
    description: 'Cotar 20 refeições congeladas fit para entrega na segunda-feira.',
    dueDate: 'Hoje, 15:00',
    status: 'pending',
    assigneeId: 'att-1',
    assigneeName: 'Patricia Silva',
    clientName: 'Mariana Medeiros',
    priority: 'alta',
    isDemo: true,
  },
  {
    id: 't-2',
    title: 'Confirmar endereço de entrega Instagram Direct',
    description: 'Verificar taxa de motoboy para bairro da Barra.',
    dueDate: 'Hoje, 17:30',
    status: 'in_progress',
    assigneeId: 'att-2',
    assigneeName: 'Carlos Atendimento',
    clientName: 'Lucas Andrade',
    priority: 'media',
    isDemo: true,
  },
  {
    id: 't-3',
    title: 'Confirmar recebimento do PIX',
    description: 'Checar comprovante enviado pelo cliente Juliana Paes.',
    dueDate: 'Ontem',
    status: 'completed',
    assigneeId: 'att-1',
    assigneeName: 'Patricia Silva',
    clientName: 'Juliana Paes',
    priority: 'baixa',
    isDemo: true,
  },
]

export const demoDeals: DemoDeal[] = [
  {
    id: 'd-1',
    title: 'Kit marmitas fit semanal',
    contactId: 'c-1',
    contactName: 'Mariana Medeiros',
    value: 189.9,
    stage: 'negociando',
    notes: 'Aguardando confirmação dos sabores da semana.',
    createdAt: '01/08/2026',
    isDemo: true,
  },
  {
    id: 'd-2',
    title: 'Assinatura mensal Low Carb',
    contactId: 'c-2',
    contactName: 'Lucas Andrade',
    value: 640,
    stage: 'entrega',
    notes: 'Confirmar taxa de motoboy para bairro da Barra.',
    createdAt: '03/08/2026',
    isDemo: true,
  },
  {
    id: 'd-3',
    title: 'Pedido #4928 — Plano Trimestral',
    contactId: 'c-3',
    contactName: 'Juliana Paes',
    value: 1290,
    stage: 'posvenda',
    notes: 'Cliente fiel, prefere marmitas sem pimentão.',
    createdAt: '15/07/2026',
    isDemo: true,
  },
]

export const demoReportMetrics = {
  totalConversations: 148,
  averageResponseTime: '3 min 45s',
  whatsappCount: 112,
  instagramCount: 36,
  attendantPerformance: [
    { id: '1', name: 'Patricia Silva', role: 'admin', completed: 82, avgTime: '2 min 10s', rating: '4.9 ★' },
    { id: '2', name: 'Carlos Atendimento', role: 'attendant', completed: 44, avgTime: '4 min 30s', rating: '4.8 ★' },
    { id: '3', name: 'Fernanda Vendas', role: 'attendant', completed: 22, avgTime: '3 min 50s', rating: '4.7 ★' },
  ],
  isDemo: true,
}

export const demoIntegrations: DemoIntegrationCard[] = [
  {
    id: 'integ-1',
    name: 'WhatsApp Business Platform',
    provider: 'whatsapp_meta',
    status: 'not_configured',
    description: 'Conector Oficial Cloud API (Coexistência habilitada com WhatsApp Business App).',
    releasePhase: 'Disponível na última fase',
    isDemo: true,
  },
  {
    id: 'integ-2',
    name: 'Instagram Direct Graph API',
    provider: 'instagram_meta',
    status: 'not_configured',
    description: 'Conector Oficial de Mensagens Direct da Meta.',
    releasePhase: 'Disponível na última fase',
    isDemo: true,
  },
  {
    id: 'integ-3',
    name: 'Integração PontuaMax',
    provider: 'pontuamax',
    status: 'not_configured',
    description: 'Integração de programa de fidelização via API.',
    releasePhase: 'Disponível na última fase',
    isDemo: true,
  },
]
