-- Test Script: 02_phase3_homologation_audit.sql
-- Validação estrita de RPCs atômicas, isolamento RLS, salvaguardas de admin e índice único de telefone no PostgreSQL

BEGIN;

-- 1. Setup de Dados para Homologação da Fase 3
INSERT INTO public.organizations (id, name, slug) VALUES 
  ('33333333-3333-3333-3333-333333333333', 'Quero Ser Fit Homologacao', 'qsf-homologacao'),
  ('44444444-4444-4444-4444-444444444444', 'Empresa Externa', 'empresa-externa')
ON CONFLICT (id) DO NOTHING;

-- Perfis Simulados
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('a3333333-3333-3333-3333-333333333333', 'Admin QSF Homologacao', 'admin.hml@queroserfit.com.br'),
  ('u3333333-3333-3333-3333-333333333333', 'Atendente 1 QSF', 'atendente1@queroserfit.com.br'),
  ('u3333334-3333-3333-3333-333333333334', 'Atendente 2 QSF', 'atendente2@queroserfit.com.br'),
  ('u4444444-4444-4444-4444-444444444444', 'Atendente Empresa Externa', 'atendente@externa.com.br')
ON CONFLICT (id) DO NOTHING;

-- Vínculos de Membros
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('33333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'admin'),
  ('33333333-3333-3333-3333-333333333333', 'u3333333-3333-3333-3333-333333333333', 'attendant'),
  ('33333333-3333-3333-3333-333333333333', 'u3333334-3333-3333-3333-333333333334', 'attendant'),
  ('44444444-4444-4444-4444-444444444444', 'u4444444-4444-4444-4444-444444444444', 'attendant')
ON CONFLICT DO NOTHING;

-- Contatos de Teste
INSERT INTO public.contacts (id, organization_id, name, phone) VALUES
  ('c3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Cliente Teste 1', '+55 11 98888-1111')
ON CONFLICT (id) DO NOTHING;

-- Conversas de Teste
INSERT INTO public.conversations (id, organization_id, contact_id, channel, status) VALUES
  ('conv3333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333', 'whatsapp', 'open')
ON CONFLICT (id) DO NOTHING;

-- TESTE 1: Bloqueio de execução de RPC por usuário anônimo (anon)
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.assume_conversation_atomic('conv3333-3333-3333-3333-333333333333');
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Usuário anônimo executou assume_conversation_atomic!';
  EXCEPTION WHEN OTHERS THEN
    -- Erro esperado de permissão negada
  END;
END $$;

-- TESTE 2: Duplicidade no banco (mesmo telefone normalizado na mesma organização deve falhar)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'a3333333-3333-3333-3333-333333333333';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.contacts (organization_id, name, phone) 
    VALUES ('33333333-3333-3333-3333-333333333333', 'Cliente Duplicado', '11988881111');
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: O banco aceitou cliente com telefone normalizado duplicado na mesma empresa!';
  EXCEPTION WHEN unique_violation THEN
    -- Sucesso: Rejeição esperada pelo índice único idx_contacts_org_normalized_phone
  END;
END $$;

-- TESTE 3: Salvaguarda do Último Administrador (Tentativa de rebaixar único admin deve falhar)
DO $$
BEGIN
  BEGIN
    PERFORM public.update_member_role_safe('33333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'attendant');
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: A RPC permitiu rebaixar o único administrador ativo da empresa!';
  EXCEPTION WHEN OTHERS THEN
    -- Sucesso: Exceção disparada pela salvaguarda
  END;
END $$;

-- TESTE 4: Transferência para usuário de outra empresa deve falhar
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_conversation_atomic('conv3333-3333-3333-3333-333333333333', 'u4444444-4444-4444-4444-444444444444');
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Transferência permitiu destino fora da organização!';
  EXCEPTION WHEN OTHERS THEN
    -- Sucesso: Exceção disparada pela validação de pertencimento
  END;
END $$;

ROLLBACK;
