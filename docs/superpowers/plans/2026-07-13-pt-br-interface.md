# Interface em pt-BR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traduzir toda a interface estática para português brasileiro.

**Architecture:** Substituir a cópia diretamente nos componentes existentes, pois o produto ficará apenas em pt-BR. Manter valores internos de filtros, rotas, nomes próprios e dados externos inalterados.

**Tech Stack:** Bun, TypeScript, Hono JSX.

## Global Constraints

- Não adicionar dependências nem infraestrutura de i18n.
- Traduzir texto visível, mensagens de erro, acessibilidade, WhatsApp e JavaScript embutido.
- Usar `pt-BR` no documento e nos formatadores de data.
- Não modificar arquivos já alterados pelo usuário sem necessidade.
- Não criar commits sem autorização explícita.

---

### Task 1: Verificação de idioma

**Files:**
- Create: `src/pt-br.test.ts`
- Test: `src/pt-br.test.ts`

**Interfaces:**
- Consumes: `collectionPage()` de `src/views.tsx`.
- Produces: teste de regressão do idioma renderizado.

- [ ] **Step 1: Write the failing test**

Criar um teste Bun que renderize uma coleção vazia e exija `lang="pt-BR"`, `Ordenar e filtrar`, `Nenhum jogo encontrado` e ausência das versões inglesas correspondentes.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/pt-br.test.ts`
Expected: FAIL porque a página ainda usa inglês.

- [ ] **Step 3: Translate the interface**

Alterar `src/views.tsx`, `src/provider-view.tsx` e `src/index.ts`: traduzir toda cópia estática apresentada ao usuário, inclusive textos em templates JavaScript; trocar `lang="en"` por `lang="pt-BR"`; trocar locales `en`/`en-US` por `pt-BR`. Preservar identificadores, valores de formulário, nomes de provedores e conteúdo externo.

- [ ] **Step 4: Run focused test**

Run: `bun test src/pt-br.test.ts`
Expected: PASS.

### Task 2: Verificação completa

**Files:**
- Verify: `src/views.tsx`
- Verify: `src/provider-view.tsx`
- Verify: `src/index.ts`

**Interfaces:**
- Consumes: interface traduzida da Task 1.
- Produces: tradução validada.

- [ ] **Step 1: Search for remaining English UI copy**

Buscar literais em inglês nos três arquivos e corrigir somente os que forem apresentados ao usuário; não traduzir comentários, chaves internas, protocolos ou dados externos.

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: todos os testes passam.

- [ ] **Step 3: Review diff**

Run: `git diff -- src/views.tsx src/provider-view.tsx src/index.ts src/pt-br.test.ts`
Expected: somente tradução, locale e teste de regressão.
