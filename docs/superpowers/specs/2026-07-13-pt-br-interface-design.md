# Interface em pt-BR

## Objetivo

Deixar toda a interface voltada ao usuário exclusivamente em português brasileiro.

## Escopo

- Traduzir textos estáticos, mensagens de erro, rótulos acessíveis, mensagens de WhatsApp e texto gerado pelo JavaScript da interface.
- Alterar o idioma do documento e a formatação de datas para `pt-BR`.
- Preservar nomes próprios, siglas, títulos dos jogos e conteúdo recebido de provedores externos.
- Não adicionar biblioteca, mapa de traduções ou seletor de idioma.

## Arquivos

- `src/views.tsx`
- `src/provider-view.tsx`
- `src/index.ts`
- Testes existentes afetados por textos renderizados.

## Validação

Executar os testes do projeto e buscar textos estáticos em inglês que ainda sejam exibidos ao usuário.
