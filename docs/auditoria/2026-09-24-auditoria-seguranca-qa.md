# Auditoria de QA e Segurança — 24/09/2026

## 0. Escopo real desta auditoria (leia primeiro)

| Item | Situação |
|---|---|
| Sistema pedido | **FitGestor** (ERP: produtos, estoque, PDV, financeiro, trocas, expedição, ponto, sync com queroserfit.com) |
| Repositório disponível nesta sessão | `packoliver/quero-ser-fit-crm`, o **CRM de atendimento** (inbox WhatsApp/Instagram, funil, tarefas, insights de IA, API pública) |
| Repositório do FitGestor | `packoliver/fitgestor-erp` existe, mas **o acesso foi negado pela política de permissões desta sessão**. Não foi lido nem testado. |

**Consequência:** nenhum achado deste documento cobre PDV, estoque, variações, XML de nota, gateways, motoboys, ponto, relatórios de venda ou a sincronização de 5 minutos. Não há código desses módulos neste repositório (busca por `estoque|pdv|produto|variação|expedição|motoboy|ponto|nfe|xml` não encontrou nenhuma implementação). Qualquer afirmação sobre esses módulos seria inventada.

O CRM, por outro lado, guarda **dados pessoais de clientes da Quero Ser Fit** (nome, telefone, e-mail, conversas completas, fotos, áudios e documentos). Por isso foi auditado a fundo: revisão de código das 23 rotas de API, do middleware, das 40 migrations/políticas RLS e dos webhooks, com testes executados onde foi possível.

**Método:** revisão estática completa + execução de `tsc`, `eslint` e `vitest` + reprodução isolada do bug da API pública (Node, sem rede). **Não houve** teste contra produção nem contra o banco real.

---

## 1. Resumo executivo

| Severidade | Qtd | Destaques |
|---|---|---|
| ❌ Bug crítico | 2 | API pública (`/api/public/v1/*`) quebrada de duas formas independentes |
| 🔒 Segurança (alta) | 4 | Permissões granulares só valem na tela; qualquer membro cria chave de API que **sobrevive à demissão**; mídia de clientes em bucket **público**; ex-funcionário continua recebendo push com o texto das mensagens |
| ⚠️ Atenção (média) | 7 | Roteamento de Instagram "adivinha" a conexão; índice único global de telefone; logs e payloads com dados pessoais sem retenção; ausência de headers de segurança/MFA |
| ⚠️ Atenção (baixa) | 6 | Derivação fraca da chave de criptografia, `REVOKE` de coluna sem efeito, etc. |

**Build/testes:** `tsc --noEmit` ✅, `eslint` ✅ (sem avisos), `vitest` ✅ 141/141. Os testes passam, mas **nenhum deles cobre os dois bugs críticos abaixo**.

---

## 2. ✅ O que está OK

- **Autenticação no servidor:** o middleware usa `supabase.auth.getUser()`, que valida o token no Supabase, e não `getSession()`, que só lê o cookie. Os cookies rotacionados também são propagados nos redirects (`src/lib/supabase/middleware.ts`).
- **Webhook Meta:** HMAC-SHA256 com comparação em tempo constante, validado sobre o *raw body* antes do parse (`src/lib/security/webhook.ts`). Sem segredo configurado, o webhook responde 503 (falha fechada).
- **Webhook uazapi:** segredo aleatório por conexão embutido na URL; sem ele, a resposta é 404.
- **Idempotência:** mensagens recebidas têm dedupe por `external_id` com índice único; envios e sync offline usam `Idempotency-Key` com hash do payload (409 se a chave for reusada com outro conteúdo).
- **OAuth do Instagram:** `state` assinado, amarrado a usuário e organização, cookie apagado antes de qualquer chamada remota (proteção contra replay e CSRF).
- **Credenciais de integração:** AES-256-GCM; `SELECT` revogado de `authenticated` em `integration_connections`; em produção, a aplicação recusa a chave de fallback conhecida.
- **Auditoria:** `audit_logs` só aceita escrita via service role e RPCs `SECURITY DEFINER`, então o usuário não consegue apagar nem forjar o próprio rastro. Mudanças de papel e remoção de membro são registradas.
- **Proteções de RPC:** não é possível remover o último admin; funções `SECURITY DEFINER` usam `search_path = ''`.
- **XSS:** nenhum `dangerouslySetInnerHTML`, `innerHTML` ou `eval` no front. O React escapa todo o conteúdo das mensagens.
- **Logout:** cancela o push, limpa o IndexedDB offline e zera o badge (`src/lib/auth-client.ts`).
- **Download de mídia:** limite rígido de 24 MB lendo o stream, mesmo sem `Content-Length`.

---

## 3. ❌ Bugs críticos

### C1. API pública bloqueada pelo middleware (401 para todo cliente externo)

- **Onde:** `src/lib/supabase/middleware.ts:51`
- **Problema:** `publicRoutes` não inclui `/api/public`. Toda rota `/api/*` sem sessão de navegador recebe `401 Não autenticado` **antes** de chegar na validação da chave de API.
- **Impacto:** Zapier, Make, n8n e planilhas, os consumidores anunciados em `/configuracoes/api`, nunca funcionam. A tela deixa gerar chaves que não servem para nada.
- **Reproduzir:** `curl -H "Authorization: Bearer crm_<chave válida>" https://<dominio>/api/public/v1/contacts` → `{"error":"Não autenticado."}` (401).
- **Correção:**
  ```ts
  const publicRoutes = ['/login', '/recuperar-senha', '/politica-de-privacidade',
    '/api/webhooks', '/api/push/vapid-public-key', '/api/public/']
  const isApiRoute = pathname.startsWith('/api/')
    && !pathname.startsWith('/api/webhooks') && !pathname.startsWith('/api/public/')
  ```

### C2. Chave de API válida derruba a rota com `TypeError` (500)

- **Onde:** `src/lib/security/api-keys.ts:53`
- **Problema:** `db.from('api_keys').update(...).eq(...).catch(() => {})`. O builder do Supabase implementa só `PromiseLike` (tem `then`, **não tem `catch`**). Isso foi confirmado executando `@supabase/postgrest-js` instalado: `typeof builder.catch === 'undefined'`. O `TypeError` é lançado de forma síncrona dentro de `authenticateApiKey`, e nenhuma das 3 rotas públicas tem `try/catch` em volta.
- **Impacto:** mesmo depois de corrigir C1, **toda requisição com chave válida responde 500**. Chaves inválidas "funcionam" (401), o que esconde o bug em testes rápidos. O `as unknown as` do cast impede o TypeScript de detectar o erro.
- **Correção:**
  ```ts
  void Promise.resolve(
    db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
  ).catch(() => {})
  ```
  Adicione também um teste que use o builder real (ou um mock sem `.catch`) para a chave válida.

---

## 4. 🔒 Falhas de segurança

### S1. [ALTA] Permissões granulares só existem na interface; o banco libera tudo para qualquer membro

- **Onde:** políticas `"Tenant isolation for …"` em `supabase/master_setup.sql` e na migration `20260805000000`, com `FOR ALL USING (organization_id IN get_user_org_ids())` em `contacts`, `messages`, `deals`, `tasks`, `internal_notes`, `tags`, `api_keys`, entre outras. Somado a `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES TO authenticated` (`20260806010000`).
- **Problema:** `delete_clients`, `delete_messages`, `export_clients`, `delete_tasks`, `edit_deals` e `manage_integrations` são checados só nas telas e em algumas rotas `/api`. A exceção é `view_all_conversations`, que tem política `RESTRICTIVE`, e mesmo ela só vale para `SELECT`. A URL do Supabase e a anon key são públicas por definição (`NEXT_PUBLIC_*`), então qualquer atendente logado fala direto com o PostgREST.
- **Reproduzir** (atendente com "Excluir clientes" e "Excluir mensagens" desmarcados), no console do navegador já logado no CRM:
  ```js
  // sb = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) — ambos visíveis no bundle;
  // a sessão do usuário logado (cookie sb-*) dá o JWT de "authenticated"
  await sb.from('messages').delete().eq('conversation_id', '<id>')   // apaga histórico
  await sb.from('contacts').delete().neq('id', '00000000-0000-0000-0000-000000000000') // apaga TODOS os clientes (cascade)
  await sb.from('contacts').select('*')  // exporta tudo, ignorando export_clients=false
  ```
- **Impacto:** perda total da base de clientes por um único usuário de baixo privilégio, apagamento de evidência (mensagens) sem registro em `audit_logs` e exportação em massa (risco LGPD).
- **Correção:** trocar as políticas `FOR ALL` por uma política para cada comando, usando a função `has_permission()` que já existe:
  ```sql
  DROP POLICY "Tenant isolation for contacts" ON public.contacts;
  CREATE POLICY contacts_select ON public.contacts FOR SELECT
    USING (organization_id IN (SELECT public.get_user_org_ids()));
  CREATE POLICY contacts_insert ON public.contacts FOR INSERT
    WITH CHECK (organization_id IN (SELECT public.get_user_org_ids())
                AND public.has_permission(organization_id, 'create_clients'));
  CREATE POLICY contacts_update ON public.contacts FOR UPDATE
    USING (organization_id IN (SELECT public.get_user_org_ids())
           AND public.has_permission(organization_id, 'edit_clients'))
    WITH CHECK (organization_id IN (SELECT public.get_user_org_ids()));
  CREATE POLICY contacts_delete ON public.contacts FOR DELETE
    USING (organization_id IN (SELECT public.get_user_org_ids())
           AND public.has_permission(organization_id, 'delete_clients'));
  -- repetir o padrão para messages (delete_messages), tasks, deals, internal_notes…
  ```
  Também vale um trigger `AFTER DELETE` em `contacts` e `messages` gravando em `audit_logs`.

### S2. [ALTA] Qualquer membro cria chave de API, e ela continua válida depois que a pessoa sai da empresa

- **Onde:** `20260816040000_public_api_keys.sql:30`, com política `FOR ALL` só por organização; `authenticateApiKey` não verifica `created_by`.
- **Reproduzir** (atendente sem `manage_integrations`):
  ```js
  // sha256 de um segredo escolhido pelo atacante
  await sb.from('api_keys').insert({ name: 'x', key_hash: '<sha256("crm_meusegredo")>', key_prefix: 'crm_meusegre' })
  ```
  Depois o admin remove o funcionário em Equipe. `remove_member_safe` apaga só `organization_members`, então a chave continua ativa, e (com C1 e C2 corrigidos) `GET /api/public/v1/contacts` e `/conversations` com `Bearer crm_meusegredo` devolvem toda a base.
- O atendente também consegue `UPDATE api_keys SET revoked_at = NULL`, reativando chaves que o admin revogou.
- **Impacto:** acesso persistente e invisível de ex-funcionário a todos os clientes e conversas.
- **Correção:**
  1. Política: `SELECT` para membros; `INSERT/UPDATE/DELETE` só com `has_permission(organization_id,'manage_integrations')`, ou simplesmente revogar a escrita de `authenticated` (a rota `/api/api-keys` já usa o service role).
  2. Em `remove_member_safe`: `UPDATE api_keys SET revoked_at = now() WHERE created_by = p_target_user_id AND organization_id = p_org_id;`
  3. **Corrigir S1 e S2 antes de C1 e C2.** Hoje os bugs C1 e C2 são, sem querer, a única coisa que impede essa exploração.

### S3. [ALTA] Fotos, áudios e documentos de clientes em bucket público

- **Onde:** `20260818010000_chat_media_bucket_public_reassert.sql` (`UPDATE storage.buckets SET public = true`) desfaz o `public = false` de `20260812000000_security_followup.sql`. `mirrorMediaToStorage` devolve `getPublicUrl`.
- **Impacto:** quem tiver a URL acessa o arquivo **sem login e para sempre**, inclusive depois que o contato é excluído (nada apaga os objetos do Storage). URLs vazam por print, encaminhamento, histórico de navegador e pelo `metadata` das mensagens. Clientes mandam comprovante de PIX, documento com CPF e foto pessoal pelo WhatsApp.
- **Reproduzir:** abrir qualquer `media_url` de `messages` em uma aba anônima → o arquivo baixa.
- **Correção:** bucket privado + `createSignedUrl(path, 3600)` na leitura (ou rota `/api/media/[id]` que verifica a organização e redireciona para a URL assinada). Guardar em `messages.media_url` o **path**, não a URL pública, e rodar uma migration que converta as URLs antigas.

### S4. [ALTA] Ex-funcionário continua recebendo o conteúdo das mensagens por push

- **Onde:** `remove_member_safe` não apaga `push_subscriptions`; `sendPushToOrganization` (`src/lib/pwa/push.ts:24`) envia para **todas** as inscrições da organização, com `body` = texto da mensagem (até 240 caracteres).
- **Impacto:** o celular de quem foi desligado continua mostrando as mensagens dos clientes. Além disso, atendentes com `view_all_conversations = false` recebem o texto de conversas que não podem abrir.
- **Correção:** em `remove_member_safe`, `DELETE FROM push_subscriptions WHERE user_id = p_target_user_id AND organization_id = p_org_id;`. No envio, filtrar por quem pode ver a conversa e **não mandar o conteúdo** no push (ex.: "Nova mensagem de Maria"): o payload passa pelo FCM/APNs.

### S5. [MÉDIA] Sem headers de segurança, sem MFA e sem rate limit próprio

- `next.config.ts` está vazio: sem `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` (há risco de clickjacking na tela de envio), `Referrer-Policy` e `Permissions-Policy`.
- Login só com e-mail e senha (`signInWithPassword`), **sem MFA**, inclusive para admin. A única proteção contra força bruta é o rate limit padrão do Supabase Auth.
- Rotas de IA (`/api/ai/*`) não têm limite por usuário: um admin ou gerente pode gerar custo ilimitado no gateway.
- **Correção mínima:**
  ```ts
  // next.config.ts
  const securityHeaders = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  ]
  const nextConfig: NextConfig = { async headers() { return [{ source: '/:path*', headers: securityHeaders }] } }
  ```
  Habilitar MFA TOTP no Supabase e exigir `aal2` para admin no middleware.

### S6. [MÉDIA] Instagram: mensagem sem conexão correspondente vai para "a conexão mais recente" de qualquer organização

- **Onde:** `src/lib/integrations/persist-event.ts:68` ("Fallback 3") pega `integration_connections` de `instagram_meta` **sem filtro de organização**, ordenadas por `updated_at`.
- **Impacto:** com mais de uma conta de Instagram (ou mais de uma organização), a DM de uma conta cai na caixa da outra, e a resposta sai pela conta errada. Em ambiente multi-organização, isso é vazamento de dados entre empresas.
- **Correção:** remover o fallback 3. Se os caminhos 1 e 2 falharem, gravar em `webhook_events` com `error_message = 'no_connection'` e alertar, em vez de adivinhar.

---

## 5. ⚠️ Pontos de atenção

### Prioridade alta

| # | Problema | Impacto | Correção |
|---|---|---|---|
| A1 | **LGPD: dados pessoais nos logs.** `console.log('[Meta Webhook] Eventos extraídos…', events)` (`src/app/api/webhooks/meta/route.ts:208`) grava texto, nome e telefone de **toda** mensagem nos logs da Vercel. | Dados pessoais em sistema de terceiros, sem controle de acesso nem retenção definida. | Logar só `events.length` e ids. |
| A2 | **LGPD: retenção infinita de payload bruto.** `webhook_events.payload` (inclusive os `diag_*` da uazapi) e `messages.metadata` (`persist-event.ts:448`) guardam o payload completo do provedor. `purge_expired_sync_mutations()` existe, mas **nada a agenda** (não há `pg_cron`). | O "direito de exclusão" não é cumprido: excluir o contato apaga as mensagens (cascade), mas o payload continua em `webhook_events` e a mídia no Storage. | Job diário (pg_cron ou Vercel Cron) apagando `webhook_events` com mais de 30 dias e `sync_mutations` expiradas. Na exclusão do contato, apagar também os objetos `chat-media/<org>/…` dele. |
| A3 | **LGPD: envio das conversas a um gateway de IA externo** (`OMNIROUTE_BASE_URL`, auto-hospedado, que roteia para provedores de LLM). | Transferência de dados pessoais a operador/suboperador, possivelmente internacional (LGPD art. 33), sem menção verificada na política de privacidade. | Confirmar se a política de privacidade cita isso; mascarar telefone, e-mail e CPF antes de enviar ao modelo; registrar o operador. |

### Prioridade média

| # | Problema | Impacto | Correção |
|---|---|---|---|
| M1 | Índice `idx_contact_channels_global_extid UNIQUE (channel_type, external_id)` é **global**, não por organização (`master_setup.sql:383`). | Em multi-organização, o 2º CRM que falar com o mesmo telefone não consegue criar o canal; como o erro só é logado, **cada mensagem nova cria um contato duplicado**. | Tornar o índice `(organization_id, channel_type, external_id)`, que já existe como `UNIQUE` da tabela, e remover o global. |
| M2 | `messages/send` busca `contact_channels` por `contact_id` com `.maybeSingle()` (`src/app/api/messages/send/route.ts:120`). | Contato com WhatsApp **e** Instagram faz o `maybeSingle` falhar e o resultado é "Não foi possível identificar o destinatário". | Filtrar também por `channel_type = conversation.channel_type`. |
| M3 | O webhook processa eventos em série e faz `await` de push, auto-resposta e CSAT **antes** de responder ao provedor (`persist-event.ts:554+`). | Em pico (campanha, lote de grupo), a resposta demora, a Meta/uazapi reenvia e o risco de timeout na Vercel aumenta. O dedupe evita duplicata, mas a carga dobra. | Mover push, auto-resposta e CSAT para `after()`, como já é feito com a análise de IA. |
| M4 | Sessão expirada (sem clicar em "Sair") não limpa o IndexedDB offline. | Em aparelho compartilhado da loja, as conversas continuam legíveis no navegador até a próxima pessoa logar. | Limpar o escopo offline também no redirect para `/login` quando `getUser()` falha no cliente. |

### Prioridade baixa

| # | Problema | Correção |
|---|---|---|
| B1 | `getEncryptionKey` usa `padEnd(32,'0')` sobre UTF-8. Uma chave curta vira chave fraca, sem erro. | Exigir 32 bytes (ou base64 de 32 bytes) e falhar se não tiver. |
| B2 | `REVOKE SELECT (key_hash) ON api_keys` **não tem efeito**: no Postgres, revogar coluna não anula o `GRANT SELECT` de tabela. | `REVOKE SELECT ON api_keys FROM authenticated; GRANT SELECT (id,name,key_prefix,created_at,last_used_at,revoked_at) …` |
| B3 | O OAuth do Instagram aceita `manager`, mas `manage_integrations` do manager é `false` e o middleware bloqueia manager em `/configuracoes/integracoes`. | Unificar a regra (usar `hasPermission('manage_integrations')`). |
| B4 | `GET /api/integrations/connections` lista conexões (com `api_base_url`) para qualquer membro. | Restringir a quem tem `manage_integrations`. |
| B5 | Header `x-meta-provider` escolhe o parser. Só depois do HMAC, então não é explorável, mas é desnecessário. | Remover; usar só `object`. |
| B6 | `README.md` é o padrão do create-next-app: não há runbook de deploy, rollback, variáveis obrigatórias nem restauração de backup. | Documentar (ver seção 6). |

---

## 6. Riscos operacionais

- **Interruptor de manutenção por constante** (`src/proxy.ts`, `MANUTENCAO_ATIVA`): ligar ou desligar exige deploy. Um incidente fora do horário depende de quem tem acesso ao repositório e à Vercel. Sugestão: flag em variável de ambiente ou Edge Config.
- **Migrations fora de ordem lógica:** `security_followup` torna o bucket privado e `chat_media_bucket_public_reassert` o torna público de novo. Aplicar `master_setup.sql` em um banco novo **ou** as migrations em sequência pode gerar estados diferentes. Vale gerar um `schema dump` do banco real e comparar.
- **Backup:** nada no repositório indica PITR ou backup do Storage (`chat-media`). Confirmar no painel do Supabase se o plano tem PITR; o Storage não entra no backup do Postgres.
- **Falha silenciosa de webhook:** eventos sem conexão (`persistInboundEvent` → `success:false`) só geram `console.log`. Não há alerta nem tela de "mensagens não roteadas".

---

## 7. O que **não** foi auditado e precisa de acesso ao `fitgestor-erp`

Estes itens do pedido original não podem ser respondidos sem o código ou o ambiente do FitGestor:

- PDV: abertura e fechamento de caixa, cancelamento (estorno de estoque e financeiro), múltiplas formas de pagamento, trocas e vales.
- Estoque: entrada manual, XML de NF-e, inventário, consistência preço/estoque **por variação**, os 128 produtos sem foto.
- Sincronização com queroserfit.com a cada 5 min: retry, fila de erro, idempotência de pedido, comportamento com o site ou o ERP fora do ar.
- Numeração de vendas reiniciada em #1 depois de apagar as vendas de teste: risco de colisão com números já enviados a clientes, gateway ou nota fiscal.
- Financeiro, conciliação com gateway, expedição e motoboys, ponto eletrônico (fraude de batida, geolocalização), relatórios.
- RLS e permissões por cargo (gerente, vendedor, motoboy) no banco do FitGestor.

Assim que o acesso for liberado, o mesmo método (código + RLS + fluxos de erro) se aplica a esses módulos, começando por **cancelamento de venda → estoque → financeiro → auditoria** e **pedido do site → baixa de estoque (race condition entre loja física e site)**, que são os pontos de maior risco para o lançamento.

---

## 8. Ordem de correção recomendada

1. **S1 + S2** (RLS por comando, chaves de API só para admin, revogação na saída do membro), antes de qualquer coisa que reative a API pública.
2. **S3** (bucket privado + URLs assinadas) e **S4** (limpar push na saída; push sem conteúdo).
3. **A1** (remover o log de dados pessoais): uma linha, efeito imediato.
4. **C1 + C2** (API pública funcionando) com teste de integração da chave válida.
5. **S6, M1, M2** (roteamento e integridade de contatos).
6. **A2, A3, S5, M3, M4** e os itens de baixa prioridade.
