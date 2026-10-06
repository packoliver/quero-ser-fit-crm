# Investigação do carregamento de conversas — 05/10/2026

## Causa confirmada e correção aplicada no Supabase

A migration `20261003000000` alterou `get_user_org_ids()` para
`SECURITY INVOKER`. Essa função consulta `organization_members`, cuja política
de leitura chama a mesma função. Isso criou uma dependência circular:

`organization_members → política RLS → get_user_org_ids → organization_members`.

Uma consulta com o papel `authenticated` e a identificação de um membro real
reproduziu `SQLSTATE 54001: stack depth limit exceeded`. Os logs do projeto CRM
também mostraram diversos `statement timeout`. As 911 conversas permaneciam no
banco; o problema era o acesso a elas.

A correção de 05/10 (`c7b5ab4`) da função `get_conversation_list_secure()` não
resolvia essa dependência. A justificativa de que `SECURITY DEFINER` faz
`auth.uid()` retornar NULL estava incorreta: `auth.uid()` lê o JWT da requisição
nos dois modos. Uma consulta executada como `postgres`, sem assumir o papel
`authenticated`, também não reproduz as políticas aplicadas pelo navegador.

A nova migration `20261005232824_fix_inbox_membership_recursion.sql` foi aplicada
no projeto **CRM QSF**. Ela coloca somente a consulta dos vínculos do próprio
usuário em uma função privilegiada no schema `crm_private`, sem acesso anônimo
e sem parâmetro que permita consultar vínculos de outro usuário. A função pública
continua como invoker, assim como a consulta de conversas e a checagem de permissões.
As tabelas continuam com RLS habilitado.

## Outros problemas encontrados

- A função de não lidas implantada diferia da migration original: era definer e
  contava mensagens sem restringir a organização. A nova migration restaurou
  `SECURITY INVOKER` e acrescentou um filtro explícito por organização.
- O Inbox ignorava `convRes.error`, convertendo erros do Supabase em lista vazia.
  Agora diferencia falha de consulta e lista vazia válida.
- Autenticação, consultas auxiliares e armazenamento offline não tinham um prazo
  de espera. Agora há um limite de 15 segundos por etapa de rede e de 3 segundos
  para operações de cache. A gravação do cache não bloqueia mais o carregamento.
- Foi adicionado um aviso acessível com botão **Tentar novamente**. O cache não
  substitui respostas de erro de permissão quando o navegador está online.
- A API `/api/configuracoes/ia` usava service role e selecionava a primeira
  organização sem autenticar ou autorizar o chamador. Agora exige uma sessão de
  administrador e filtra leitura e escrita pela organização resolvida no servidor.
  Também valida os tipos dos campos e mantém a chave existente ao receber texto
  vazio; somente `null` explícito remove a chave.
- As mudanças recentes de tema e configuração de IA introduziram dois erros de
  lint. O tema resolvido agora deriva da preferência e de uma assinatura do tema
  do sistema; a configuração de IA segue o padrão de carregamento adiado do projeto.
- O teste de navegação ainda esperava 15 itens, mas a opção IA já havia aumentado
  o menu para 16. A expectativa foi atualizada, incluindo essa opção explicitamente.

## Validação

- Regressão no Supabase com os 8 membros existentes: lista esperada por usuário,
  vínculos restritos à organização e não lidas restritas às conversas visíveis.
- Usuário sem vínculo e consulta sem identificação no JWT: nenhuma conversa ou
  contagem de não lidas exposta.
- Anônimo sem permissão de execução nas funções de vínculo e não lidas.
- Consulta de 905 conversas sob o papel autenticado: aproximadamente **1,7 s**.
- Teste combinado de lista e não lidas: máximo de aproximadamente **2 s** nessa execução.
- `npm test`: **184 testes passaram**, 8 ignorados pelas condições já existentes.
- `npm run typecheck`: passou.
- `npm run build`: passou.
- `npm run lint`: nenhum erro; 2 avisos anteriores, em `insights.ts`
  (`runAnalysis` sem uso) e `rate-limit.test.ts` (importação `vi` sem uso).
- `git diff --check`: passou.
- Não há comando de formatter configurado no `package.json`.
- O usuário confirmou que as conversas apareceram no CRM publicado após atualizar a página.

Os advisors do Supabase ainda apontam itens anteriores à correção, incluindo o
search path do trigger `update_agent_tasks_updated_at` e permissão anônima em
`is_org_admin`. A revisão não foi uma auditoria completa de todos os recursos.
Referências: [search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
e [execução anônima de funções definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Como testar

No CRM publicado, atualizar **Conversas** com **Ctrl + F5**, abrir uma conversa e
verificar o histórico e os indicadores de não lidas. A alteração do banco já está
ativa, e o usuário confirmou que a lista voltou a aparecer após atualizar a página.
Envio de mensagens e demais operações não foram verificados no navegador nesta investigação.

Para testar o código local, executar no PowerShell:

```powershell
cd 'C:\Users\Patri\Desktop\SITES\fit-crm-connect-main\fit-crm-connect-main'
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

Abrir `http://localhost:3000/inbox` e entrar com uma conta do CRM. Ao simular rede
indisponível, o carregamento deve terminar com mensagem de erro ou cache, e o botão
de nova tentativa deve permitir recuperar a lista quando a conexão voltar.

Para repetir a regressão no banco, executar o conteúdo de
`supabase/tests/inbox_rls_regression.sql` no SQL Editor do projeto CRM QSF como
`postgres`. O script usa objetos temporários e encerra com ROLLBACK.

## Publicação

A migration local usa a mesma versão registrada pelo MCP no Supabase para evitar
que um futuro deploy tente aplicá-la novamente como uma migration diferente.

As alterações da tela, da API de IA e dos componentes estão no repositório local
e ainda precisam ser publicadas. Nenhuma dependência foi adicionada e as alterações
locais preexistentes foram preservadas.
