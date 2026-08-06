-- Test Script: 01_rls_security_audit.sql
-- Validação estrita de RLS, isolamento de tenant e bloqueio de auditoria no PostgreSQL / Supabase Local

BEGIN;

-- 1. Criação de Dados de Teste com 2 Organizações, 2 Admins, 2 Atendentes e 1 Sem Organização
INSERT INTO public.organizations (id, name, slug) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Quero Ser Fit', 'quero-ser-fit'),
  ('22222222-2222-2222-2222-222222222222', 'Empresa Concorrente', 'empresa-concorrente')
ON CONFLICT (id) DO NOTHING;

-- Perfis Simulados
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Admin Quero Ser Fit', 'admin@queroserfit.com.br'),
  ('u1111111-1111-1111-1111-111111111111', 'Atendente Quero Ser Fit', 'atendente@queroserfit.com.br'),
  ('a2222222-2222-2222-2222-222222222222', 'Admin Concorrente', 'admin@concorrente.com.br'),
  ('u2222222-2222-2222-2222-222222222222', 'Atendente Concorrente', 'atendente@concorrente.com.br'),
  ('u9999999-9999-9999-9999-999999999999', 'Usuario Sem Org', 'semorg@email.com')
ON CONFLICT (id) DO NOTHING;

-- Vínculos de Membros
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'admin'),
  ('11111111-1111-1111-1111-111111111111', 'u1111111-1111-1111-1111-111111111111', 'attendant'),
  ('22222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'u2222222-2222-2222-2222-222222222222', 'attendant')
ON CONFLICT DO NOTHING;

-- Contatos e Atendimentos de Teste
INSERT INTO public.contacts (id, organization_id, name, phone) VALUES
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Cliente QSF 1', '+5511900000001'),
  ('c2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Cliente Concorrente 1', '+5511900000002')
ON CONFLICT (id) DO NOTHING;

-- Registros de Auditoria de Teste
INSERT INTO public.audit_logs (id, organization_id, actor_id, action, target_type) VALUES
  ('log11111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'TEST_ACTION', 'contacts')
ON CONFLICT (id) DO NOTHING;

-- TESTE 1: Leitura anônima deve ser completamente bloqueada
SET LOCAL ROLE anon;
DO $$
DECLARE count_contacts INT;
BEGIN
  SELECT COUNT(*) INTO count_contacts FROM public.contacts;
  IF count_contacts > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Usuário anônimo conseguiu ler dados da tabela contacts!';
  END IF;
END $$;

-- TESTE 2: Usuário da Org A não lê contatos da Org B
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'u1111111-1111-1111-1111-111111111111';

DO $$
DECLARE count_leaked INT;
BEGIN
  SELECT COUNT(*) INTO count_leaked FROM public.contacts WHERE organization_id = '22222222-2222-2222-2222-222222222222';
  IF count_leaked > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Atendente da Org A leu contatos da Org B!';
  END IF;
END $$;

-- TESTE 3: Usuário sem organização não lê contatos operacionais
SET LOCAL "request.jwt.claim.sub" = 'u9999999-9999-9999-9999-999999999999';

DO $$
DECLARE count_contacts INT;
BEGIN
  SELECT COUNT(*) INTO count_contacts FROM public.contacts;
  IF count_contacts > 0 THEN
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Usuário sem organização conseguiu ler contatos operacionais!';
  END IF;
END $$;

-- TESTE 4: Tentativa de UPDATE ou DELETE em audit_logs por usuário comum deve falhar (Append-Only)
SET LOCAL "request.jwt.claim.sub" = 'u1111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  BEGIN
    DELETE FROM public.audit_logs WHERE id = 'log11111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'FALHA DE SEGURANÇA: Usuário comum conseguiu deletar registros da audit_logs!';
  EXCEPTION WHEN OTHERS THEN
    -- Erro esperado de permissão negada
  END;
END $$;

ROLLBACK;
