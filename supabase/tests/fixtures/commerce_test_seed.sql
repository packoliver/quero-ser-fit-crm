-- ============================================================================
-- Commerce Test Seed Dataset v1
-- ============================================================================
-- Dataset representativo para validação E2E dos Workstreams 3-14.
-- 30+ cenários de comércio de roupas cobrindo:
--   Lead novo, preço, produto, tamanho, cor, frete, endereço, PIX,
--   comprovante, motoboy, pagamento na entrega, objeções, abandono,
--   follow-up, recuperação, venda ganha/perdida, divergência CRM×IA.
--
-- ORG_ID fixa para testes: 'test-org-commerce-001'
-- SELLER_A: 'seller-a-001' (vendedora ativa)
-- SELLER_B: 'seller-b-001' (vendedora com falhas)
--
-- SEGURANÇA: Este script só deve rodar em ambiente de teste/staging.
-- Nunca execute em produção.
-- ============================================================================

DO $$
DECLARE
  org_id UUID := 'test-org-commerce-001';
  seller_a UUID := 'seller-a-001';
  seller_b UUID := 'seller-b-001';
  contact_id UUID;
  conv_id UUID;
  deal_id UUID;
  msg_ts TIMESTAMPTZ;
BEGIN
  -- Limpa dados anteriores desta org de teste (idempotente)
  DELETE FROM commercial_signals WHERE organization_id = org_id;
  DELETE FROM ai_conversation_insights WHERE organization_id = org_id;
  DELETE FROM tasks WHERE organization_id = org_id;
  DELETE FROM deals WHERE organization_id = org_id;
  DELETE FROM messages WHERE organization_id = org_id;
  DELETE FROM conversations WHERE organization_id = org_id;
  DELETE FROM contacts WHERE organization_id = org_id;

  -- =========================================================================
  -- CENÁRIO 1: Lead novo pergunta preço → INTERESSE + PRICE_ASKED
  -- Esperado: score ~13, temperatura FRIO, estado AGUARDANDO_VENDEDORA
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c001-lead-novo', org_id, 'Ana Souza', '11999990001', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-001-price', org_id, 'c001-lead-novo', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '5 minutes');
  
  INSERT INTO messages (organization_id, conversation_id, sender_type, content, created_at)
  VALUES (org_id, 'conv-001-price', 'contact', 'Oi, quanto custa o vestido floral?', NOW() - INTERVAL '5 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-001-price', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-001-price', 'PRICE_ASKED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-001-price', 'ok', '["PRODUCT_INTEREST","PRICE_ASKED"]', 13, 'FRIO', 'AGUARDANDO_VENDEDORA', 'Informar preço e condições; verificar interesse em fechar', NOW());

  -- =========================================================================
  -- CENÁRIO 2: Cliente escolhe tamanho → SIZE_SELECTED
  -- Esperado: score ~23, temperatura FRIO, FOLLOWUP_NECESSARIO
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c002-tamanho', org_id, 'Beatriz Lima', '11999990002', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-002-size', org_id, 'c002-tamanho', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '30 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-002-size', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-002-size', 'SIZE_SELECTED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-002-size', 'ok', '["PRODUCT_INTEREST","SIZE_SELECTED"]', 23, 'FRIO', 'FOLLOWUP_NECESSARIO', 'Confirmar disponibilidade do item selecionado e avançar para pagamento', NOW() - INTERVAL '30 minutes');

  -- =========================================================================
  -- CENÁRIO 3: Cliente escolhe cor → COLOR_SELECTED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c003-cor', org_id, 'Carla Mendes', '11999990003', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-003-color', org_id, 'c003-cor', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '1 hour');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-003-color', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-003-color', 'COLOR_SELECTED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, last_analyzed_at)
  VALUES (org_id, 'conv-003-color', 'ok', '["PRODUCT_INTEREST","COLOR_SELECTED"]', 23, 'FRIO', 'FOLLOWUP_NECESSARIO', NOW() - INTERVAL '1 hour');

  -- =========================================================================
  -- CENÁRIO 4: Cliente pergunta frete → SHIPPING_ASKED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c004-frete', org_id, 'Daniela Costa', '11999990004', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-004-shipping', org_id, 'c004-frete', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '2 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-004-shipping', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-004-shipping', 'SHIPPING_ASKED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, last_analyzed_at)
  VALUES (org_id, 'conv-004-shipping', 'ok', '["PRODUCT_INTEREST","SHIPPING_ASKED"]', 20, 'FRIO', 'FOLLOWUP_NECESSARIO', NOW() - INTERVAL '2 hours');

  -- =========================================================================
  -- CENÁRIO 5: Cliente passa endereço → ADDRESS_PROVIDED (alta intenção)
  -- Esperado: score ~25, FOLLOWUP_NECESSARIO
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c005-endereco', org_id, 'Elena Rodrigues', '11999990005', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-005-address', org_id, 'c005-endereco', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '3 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-005-address', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-005-address', 'ADDRESS_PROVIDED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-005-address', 'ok', '["PRODUCT_INTEREST","ADDRESS_PROVIDED"]', 25, 'FRIO', 'FOLLOWUP_NECESSARIO', 'Validar endereço e calcular frete para avançar no fechamento', NOW() - INTERVAL '3 hours');

  -- =========================================================================
  -- CENÁRIO 6: Cliente pede PIX → PIX_REQUESTED
  -- Esperado: score ~28, FOLLOWUP_NECESSARIO
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c006-pix-req', org_id, 'Fernanda Oliveira', '11999990006', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-006-pix-requested', org_id, 'c006-pix-req', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '4 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-006-pix-requested', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-006-pix-requested', 'PIX_REQUESTED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-006-pix-requested', 'ok', '["PRODUCT_INTEREST","PIX_REQUESTED"]', 28, 'FRIO', 'FOLLOWUP_NECESSARIO', 'PIX_KEY_SENT', NOW() - INTERVAL '4 hours');

  -- =========================================================================
  -- CENÁRIO 7: Vendedora envia chave PIX → PIX_KEY_SENT
  -- Esperado: score ~36, AGUARDANDO_CLIENTE, AWAITING_PAYMENT
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c007-pix-sent', org_id, 'Gabriela Santos', '11999990007', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-007-pix-sent', org_id, 'c007-pix-sent', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '1 hour');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-007-pix-sent', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-007-pix-sent', 'PIX_KEY_SENT', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-007-pix-sent', 'ok', '["PRODUCT_INTEREST","PIX_KEY_SENT"]', 36, 'FRIO', 'AGUARDANDO_CLIENTE', 'AWAITING_PAYMENT', NOW() - INTERVAL '1 hour');

  -- =========================================================================
  -- CENÁRIO 8: Cliente responde 👍 após PIX (NÃO confirma pagamento)
  -- Esperado: permanece AGUARDANDO_CLIENTE, NÃO vira PAYMENT_CONFIRMED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c008-thumbs-up', org_id, 'Helena Martins', '11999990008', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-008-thumbs', org_id, 'c008-thumbs-up', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '45 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-008-thumbs', 'PIX_KEY_SENT', 'ai_analysis', 1.0);
  -- NOTA: 👍 NÃO gera PAYMENT_CONFIRMED — apenas sinal de reconhecimento
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-008-thumbs', 'ok', '["PIX_KEY_SENT"]', 36, 'FRIO', 'AGUARDANDO_CLIENTE', 'AWAITING_PAYMENT', NOW() - INTERVAL '45 minutes');

  -- =========================================================================
  -- CENÁRIO 9: Cliente diz "paguei" SEM comprovante visual
  -- Esperado: NÃO cria PAYMENT_EVIDENCE_RECEIVED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c009-paguei-texto', org_id, 'Isabela Ferreira', '11999990009', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-009-paguei-text', org_id, 'c009-paguei-texto', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '20 minutes');
  
  INSERT INTO messages (organization_id, conversation_id, sender_type, content, created_at)
  VALUES (org_id, 'conv-009-paguei-text', 'contact', 'Já paguei!', NOW() - INTERVAL '20 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-009-paguei-text', 'PIX_KEY_SENT', 'ai_analysis', 1.0);
  -- NOTA: Texto "paguei" sem imagem NÃO gera PAYMENT_EVIDENCE_RECEIVED
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-009-paguei-text', 'atencao', '["PIX_KEY_SENT"]', 36, 'FRIO', 'AGUARDANDO_VENDEDORA', 'AWAITING_PAYMENT', NOW() - INTERVAL '20 minutes');

  -- =========================================================================
  -- CENÁRIO 10: Comprovante válido recebido → PAYMENT_EVIDENCE_RECEIVED
  -- Esperado: score ~61, AGUARDANDO_VENDEDORA, EVIDENCE_RECEIVED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c010-comprovante', org_id, 'Juliana Alves', '11999990010', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-010-evidence', org_id, 'c010-comprovante', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '10 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-010-evidence', 'PIX_KEY_SENT', 'ai_analysis', 1.0),
    (org_id, 'conv-010-evidence', 'PAYMENT_EVIDENCE_RECEIVED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-010-evidence', 'ok', '["PIX_KEY_SENT","PAYMENT_EVIDENCE_RECEIVED"]', 61, 'MORNO', 'AGUARDANDO_VENDEDORA', 'EVIDENCE_RECEIVED', 'Verificar comprovante e confirmar pagamento ao cliente', NOW() - INTERVAL '10 minutes');

  -- =========================================================================
  -- CENÁRIO 11: Comprovante + confirmação da vendedora → PAYMENT_CONFIRMED
  -- Esperado: score ~91, QUENTE, CONFIRMED, SEM_ACAO_NECESSARIA
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c011-confirmado', org_id, 'Karla Nunes', '11999990011', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-011-confirmed', org_id, 'c011-confirmado', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '5 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-011-confirmed', 'PIX_KEY_SENT', 'ai_analysis', 1.0),
    (org_id, 'conv-011-confirmed', 'PAYMENT_EVIDENCE_RECEIVED', 'ai_analysis', 1.0),
    (org_id, 'conv-011-confirmed', 'PAYMENT_CONFIRMED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-011-confirmed', 'ok', '["PIX_KEY_SENT","PAYMENT_EVIDENCE_RECEIVED","PAYMENT_CONFIRMED"]', 91, 'QUENTE', 'SEM_ACAO_NECESSARIA', 'CONFIRMED', 'Confirmar entrega ou retirada ao cliente', NOW() - INTERVAL '5 minutes');

  -- =========================================================================
  -- CENÁRIO 12: Pagamento na entrega → PAYMENT_ON_DELIVERY
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c012-pagto-entrega', org_id, 'Larissa Barbosa', '11999990012', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-012-on-delivery', org_id, 'c012-pagto-entrega', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '2 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-012-on-delivery', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-012-on-delivery', 'ADDRESS_PROVIDED', 'ai_analysis', 1.0),
    (org_id, 'conv-012-on-delivery', 'PAYMENT_ON_DELIVERY', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-012-on-delivery', 'ok', '["PRODUCT_INTEREST","ADDRESS_PROVIDED","PAYMENT_ON_DELIVERY"]', 50, 'MORNO', 'FOLLOWUP_NECESSARIO', 'ON_DELIVERY', NOW() - INTERVAL '2 hours');

  -- =========================================================================
  -- CENÁRIO 13: Motoboy confirmado → MOTOBOY_CONFIRMED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c013-motoboy', org_id, 'Mariana Correia', '11999990013', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-013-motoboy', org_id, 'c013-motoboy', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '30 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-013-motoboy', 'PAYMENT_CONFIRMED', 'ai_analysis', 1.0),
    (org_id, 'conv-013-motoboy', 'MOTOBOY_CONFIRMED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-013-motoboy', 'ok', '["PAYMENT_CONFIRMED","MOTOBOY_CONFIRMED"]', 80, 'QUENTE', 'SEM_ACAO_NECESSARIA', 'MOTOBOY_DISPATCHED', NOW() - INTERVAL '30 minutes');

  -- =========================================================================
  -- CENÁRIO 14: Objeção de preço → OBJECTION_PRICE
  -- Esperado: riskPenalty 12, score reduzido
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c014-obj-preco', org_id, 'Natália Dias', '11999990014', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-014-obj-price', org_id, 'c014-obj-preco', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '1 hour');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-014-obj-price', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-014-obj-price', 'OBJECTION_PRICE', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, loss_reason, last_analyzed_at)
  VALUES (org_id, 'conv-014-obj-price', 'atencao', '["PRODUCT_INTEREST","OBJECTION_PRICE"]', 1, 'FRIO', 'AGUARDANDO_VENDEDORA', NULL, NOW() - INTERVAL '1 hour');

  -- =========================================================================
  -- CENÁRIO 15: Objeção de frete → OBJECTION_SHIPPING
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c015-obj-frete', org_id, 'Olivia Ramos', '11999990015', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-015-obj-shipping', org_id, 'c015-obj-frete', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '3 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-015-obj-shipping', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-015-obj-shipping', 'SHIPPING_ASKED', 'ai_analysis', 1.0),
    (org_id, 'conv-015-obj-shipping', 'OBJECTION_SHIPPING', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, last_analyzed_at)
  VALUES (org_id, 'conv-015-obj-shipping', 'atencao', '["PRODUCT_INTEREST","SHIPPING_ASKED","OBJECTION_SHIPPING"]', 7, 'FRIO', 'AGUARDANDO_VENDEDORA', NOW() - INTERVAL '3 hours');

  -- =========================================================================
  -- CENÁRIO 16: Cliente some (ghosting) APÓS vendedora responder
  -- Esperado: CLIENT_GHOSTED (não SELLER_NO_RESPONSE)
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c016-ghost', org_id, 'Patricia Melo', '11999990016', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-016-ghost', org_id, 'c016-ghost', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '72 hours');
  
  INSERT INTO messages (organization_id, conversation_id, sender_type, content, created_at)
  VALUES (org_id, 'conv-016-ghost', 'user', 'Segue o link do produto!', NOW() - INTERVAL '72 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-016-ghost', 'PRODUCT_INTEREST', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, loss_controllability, last_analyzed_at)
  VALUES (org_id, 'conv-016-ghost', 'risco', '["PRODUCT_INTEREST"]', 'perdida', 8, 'FRIO', 'AGUARDANDO_CLIENTE', 'CLIENT_GHOSTED', 'NAO_CONTROLAVEL', NOW() - INTERVAL '72 hours');

  -- =========================================================================
  -- CENÁRIO 17: Vendedora não responde → SELLER_NO_RESPONSE
  -- Esperado: NÃO é CLIENT_GHOSTED, é falha controlável
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c017-no-response', org_id, 'Renata Vieira', '11999990017', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-017-no-response', org_id, 'c017-no-response', 'whatsapp', 'open', seller_b, NOW() - INTERVAL '6 hours');
  
  INSERT INTO messages (organization_id, conversation_id, sender_type, content, created_at)
  VALUES (org_id, 'conv-017-no-response', 'contact', 'Quero comprar, me ajuda?', NOW() - INTERVAL '6 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-017-no-response', 'WAITING_ATTENDANT_REPLY', 'ai_analysis', 1.0),
    (org_id, 'conv-017-no-response', 'PRODUCT_INTEREST', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, loss_controllability, last_analyzed_at)
  VALUES (org_id, 'conv-017-no-response', 'risco', '["WAITING_ATTENDANT_REPLY","PRODUCT_INTEREST"]', 'perdida', 8, 'FRIO', 'AGUARDANDO_VENDEDORA', 'SELLER_NO_RESPONSE', 'CONTROLAVEL', NOW() - INTERVAL '6 hours');

  -- =========================================================================
  -- CENÁRIO 18: Follow-up esquecido → FOLLOWUP_MISSING
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c018-followup-miss', org_id, 'Sandra Lopes', '11999990018', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-018-followup-missing', org_id, 'c018-followup-miss', 'whatsapp', 'open', seller_b, NOW() - INTERVAL '8 hours');
  
  INSERT INTO messages (organization_id, conversation_id, sender_type, content, created_at)
  VALUES (org_id, 'conv-018-followup-missing', 'contact', 'Ainda tem disponível?', NOW() - INTERVAL '8 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-018-followup-missing', 'PRODUCT_INTEREST', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, loss_controllability, last_analyzed_at)
  VALUES (org_id, 'conv-018-followup-missing', 'risco', '["PRODUCT_INTEREST"]', 'perdida', 8, 'FRIO', 'FOLLOWUP_ATRASADO', 'FOLLOWUP_MISSING', 'CONTROLAVEL', NOW() - INTERVAL '8 hours');

  -- =========================================================================
  -- CENÁRIO 19: Lead recuperado → tarefa criada, estado muda
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c019-recuperado', org_id, 'Tatiane Rocha', '11999990019', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-019-recovered', org_id, 'c019-recuperado', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '1 hour');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-019-recovered', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-019-recovered', 'SIZE_SELECTED', 'ai_analysis', 1.0),
    (org_id, 'conv-019-recovered', 'FOLLOW_UP_SCHEDULED', 'ai_analysis', 1.0);
  
  INSERT INTO tasks (organization_id, title, status, priority, conversation_id, assigned_to_id)
  VALUES (org_id, 'Follow-up: confirmar tamanho M', 'pending', 'media', 'conv-019-recovered', seller_a);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, last_analyzed_at)
  VALUES (org_id, 'conv-019-recovered', 'ok', '["PRODUCT_INTEREST","SIZE_SELECTED","FOLLOW_UP_SCHEDULED"]', 29, 'FRIO', 'FOLLOWUP_AGENDADO', NOW() - INTERVAL '1 hour');

  -- =========================================================================
  -- CENÁRIO 20: Venda ganha → deal is_won
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c020-venda-ganha', org_id, 'Ursula Campos', '11999990020', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-020-won', org_id, 'c020-venda-ganha', 'whatsapp', 'closed', seller_a, NOW() - INTERVAL '1 day');
  
  INSERT INTO deals (organization_id, contact_id, conversation_id, title, value, stage, assigned_to_id, closed_at)
  VALUES (org_id, 'c020-venda-ganha', 'conv-020-won', 'Kit Fitness Mensal', 289.90, 'fechado', seller_a, NOW() - INTERVAL '1 day');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-020-won', 'PAYMENT_CONFIRMED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-020-won', 'ok', '["PAYMENT_CONFIRMED"]', 60, 'MORNO', 'SEM_ACAO_NECESSARIA', 'CONFIRMED', NOW() - INTERVAL '1 day');

  -- =========================================================================
  -- CENÁRIO 21: Venda perdida por preço → PRICE
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c021-perda-preco', org_id, 'Vanessa Pinto', '11999990021', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-021-lost-price', org_id, 'c021-perda-preco', 'whatsapp', 'closed', seller_b, NOW() - INTERVAL '2 days');
  
  INSERT INTO deals (organization_id, contact_id, conversation_id, title, value, stage, assigned_to_id, closed_at)
  VALUES (org_id, 'c021-perda-preco', 'conv-021-lost-price', 'Vestido Longo', 159.90, 'perdido', seller_b, NOW() - INTERVAL '2 days');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-021-lost-price', 'OBJECTION_PRICE', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, loss_controllability, last_analyzed_at)
  VALUES (org_id, 'conv-021-lost-price', 'risco', '["OBJECTION_PRICE"]', 0, 'FRIO', 'SEM_ACAO_NECESSARIA', 'PRICE', 'CONTROLAVEL', NOW() - INTERVAL '2 days');

  -- =========================================================================
  -- CENÁRIO 22: Divergência CRM × IA (CRM diz aberta, IA diz risco)
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c022-divergencia', org_id, 'Wanessa Torres', '11999990022', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-022-divergence', org_id, 'c022-divergencia', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '5 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-022-divergence', 'CANCELLATION_REQUESTED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, last_analyzed_at)
  VALUES (org_id, 'conv-022-divergence', 'risco', '["CANCELLATION_REQUESTED"]', 0, 'FRIO', 'AGUARDANDO_VENDEDORA', 'CLIENT_GAVE_UP', NOW() - INTERVAL '5 hours');

  -- =========================================================================
  -- CENÁRIO 23: Cliente recorrente (múltiplas conversas)
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c023-recorrente', org_id, 'Ximena Garcia', '11999990023', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-023a-recurrent', org_id, 'c023-recorrente', 'whatsapp', 'closed', seller_a, NOW() - INTERVAL '30 days');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-023b-recurrent', org_id, 'c023-recorrente', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '2 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-023a-recurrent', 'PAYMENT_CONFIRMED', 'ai_analysis', 1.0),
    (org_id, 'conv-023b-recurrent', 'PRODUCT_INTEREST', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, last_analyzed_at)
  VALUES 
    (org_id, 'conv-023a-recurrent', 'ok', '["PAYMENT_CONFIRMED"]', 60, 'MORNO', 'SEM_ACAO_NECESSARIA', 'ganha', NOW() - INTERVAL '30 days'),
    (org_id, 'conv-023b-recurrent', 'ok', '["PRODUCT_INTEREST"]', 8, 'FRIO', 'AGUARDANDO_VENDEDORA', 'aberta', NOW() - INTERVAL '2 hours');

  -- =========================================================================
  -- CENÁRIO 24: PIX abandonado (>24h sem confirmação)
  -- Esperado: recovery_opportunities identifica como cold_lead
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c024-pix-abandonado', org_id, 'Yasmin Freitas', '11999990024', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-024-pix-abandoned', org_id, 'c024-pix-abandonado', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '30 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-024-pix-abandoned', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-024-pix-abandoned', 'SIZE_SELECTED', 'ai_analysis', 1.0),
    (org_id, 'conv-024-pix-abandoned', 'PIX_KEY_SENT', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-024-pix-abandoned', 'atencao', '["PRODUCT_INTEREST","SIZE_SELECTED","PIX_KEY_SENT"]', 46, 'MORNO', 'FOLLOWUP_ATRASADO', 'AWAITING_PAYMENT', NOW() - INTERVAL '30 hours');

  -- =========================================================================
  -- CENÁRIO 25: Alta intenção sem resposta (lead quente parado)
  -- Esperado: ALTA prioridade em /recuperacao
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c025-hot-stalled', org_id, 'Zara Monteiro', '11999990025', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-025-hot-stalled', org_id, 'c025-hot-stalled', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '5 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-025-hot-stalled', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-025-hot-stalled', 'SIZE_SELECTED', 'ai_analysis', 1.0),
    (org_id, 'conv-025-hot-stalled', 'COLOR_SELECTED', 'ai_analysis', 1.0),
    (org_id, 'conv-025-hot-stalled', 'ADDRESS_PROVIDED', 'ai_analysis', 1.0),
    (org_id, 'conv-025-hot-stalled', 'URGENCY_EXPRESSED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-025-hot-stalled', 'ok', '["PRODUCT_INTEREST","SIZE_SELECTED","COLOR_SELECTED","ADDRESS_PROVIDED","URGENCY_EXPRESSED"]', 73, 'QUENTE', 'FOLLOWUP_NECESSARIO', 'Priorizar atendimento e acelerar processo de fechamento', NOW() - INTERVAL '5 hours');

  -- =========================================================================
  -- CENÁRIO 26: NO_REAL_PURCHASE_INTENT (curioso, não comprador)
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c026-no-intent', org_id, 'Amanda Reis', '11999990026', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-026-no-intent', org_id, 'c026-no-intent', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '1 day');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-026-no-intent', 'NO_REAL_PURCHASE_INTENT', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, loss_controllability, last_analyzed_at)
  VALUES (org_id, 'conv-026-no-intent', 'risco', '["NO_REAL_PURCHASE_INTENT"]', 'perdida', 0, 'FRIO', 'SEM_ACAO_NECESSARIA', 'NO_REAL_PURCHASE_INTENT', 'NAO_CONTROLAVEL', NOW() - INTERVAL '1 day');

  -- =========================================================================
  -- CENÁRIO 27: Retirada confirmada → PICKUP_CONFIRMED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c027-retirada', org_id, 'Bruna Cardoso', '11999990027', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-027-pickup', org_id, 'c027-retirada', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '4 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-027-pickup', 'PAYMENT_CONFIRMED', 'ai_analysis', 1.0),
    (org_id, 'conv-027-pickup', 'PICKUP_CONFIRMED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, payment_stage, last_analyzed_at)
  VALUES (org_id, 'conv-027-pickup', 'ok', '["PAYMENT_CONFIRMED","PICKUP_CONFIRMED"]', 80, 'QUENTE', 'SEM_ACAO_NECESSARIA', 'PICKUP_READY', NOW() - INTERVAL '4 hours');

  -- =========================================================================
  -- CENÁRIO 28: Concorrente mencionado → COMPETITOR_MENTIONED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c028-concorrente', org_id, 'Camila Araújo', '11999990028', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-028-competitor', org_id, 'c028-concorrente', 'whatsapp', 'open', seller_b, NOW() - INTERVAL '12 hours');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-028-competitor', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-028-competitor', 'COMPETITOR_MENTIONED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, outcome, lead_score, temperature, follow_up_state, loss_reason, loss_controllability, last_analyzed_at)
  VALUES (org_id, 'conv-028-competitor', 'atencao', '["PRODUCT_INTEREST","COMPETITOR_MENTIONED"]', 'perdida', 5, 'FRIO', 'AGUARDANDO_VENDEDORA', 'COMPETITOR', 'NAO_CONTROLAVEL', NOW() - INTERVAL '12 hours');

  -- =========================================================================
  -- CENÁRIO 29: Urgência expressa → URGENCY_EXPRESSED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c029-urgencia', org_id, 'Diana Moreira', '11999990029', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-029-urgency', org_id, 'c029-urgencia', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '15 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-029-urgency', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-029-urgency', 'URGENCY_EXPRESSED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-029-urgency', 'ok', '["PRODUCT_INTEREST","URGENCY_EXPRESSED"]', 23, 'FRIO', 'FOLLOWUP_NECESSARIO', 'Priorizar atendimento e acelerar processo de fechamento', NOW() - INTERVAL '15 minutes');

  -- =========================================================================
  -- CENÁRIO 30: Budget stated → BUDGET_STATED
  -- =========================================================================
  INSERT INTO contacts (id, organization_id, name, phone, status)
  VALUES ('c030-orcamento', org_id, 'Elisa Nogueira', '11999990030', 'active');
  
  INSERT INTO conversations (id, organization_id, contact_id, channel_type, status, current_assignee_id, last_message_at)
  VALUES ('conv-030-budget', org_id, 'c030-orcamento', 'whatsapp', 'open', seller_a, NOW() - INTERVAL '45 minutes');
  
  INSERT INTO commercial_signals (organization_id, conversation_id, signal_type, source, confidence)
  VALUES 
    (org_id, 'conv-030-budget', 'PRODUCT_INTEREST', 'ai_analysis', 1.0),
    (org_id, 'conv-030-budget', 'BUDGET_STATED', 'ai_analysis', 1.0);
  
  INSERT INTO ai_conversation_insights (organization_id, conversation_id, status, signals, lead_score, temperature, follow_up_state, next_best_action, last_analyzed_at)
  VALUES (org_id, 'conv-030-budget', 'ok', '["PRODUCT_INTEREST","BUDGET_STATED"]', 21, 'FRIO', 'FOLLOWUP_NECESSARIO', 'Ajustar proposta ao orçamento informado', NOW() - INTERVAL '45 minutes');

  RAISE NOTICE 'Commerce test seed completed: 30 scenarios inserted for org %', org_id;
END $$;