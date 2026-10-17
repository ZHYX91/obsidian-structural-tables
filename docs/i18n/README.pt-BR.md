# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md)

Adicione células mescladas, várias linhas de cabeçalho, cabeçalhos de linha e tabelas sem cabeçalho às tabelas Markdown. Apenas visualizar uma tabela não reescreve a nota.

## Capturas de tela

### Tabela de três linhas no modo de leitura

Cabeçalhos agrupados e células mescladas aparecem sem bordas completas ao redor de cada célula.

![Structural Tables Reading View](../assets/structural-tables-reading-view-en.png)

### Edição na pré-visualização

Clique numa célula no computador ou toque duas vezes na tela sensível ao toque para editar o texto.

![Structural Tables Live Preview](../assets/structural-tables-live-preview-en.png)

### Configurações de aparência

![Structural Tables settings](../assets/structural-tables-settings-en.png)

<!-- section: features -->
## Recursos

- Digite `<` para mesclar com a coluna anterior no código-fonte ou `^` para mesclar com a célula acima.
- Use `||` sem espaços na linha separadora para marcar as colunas que são cabeçalhos de linha.
- Veja a mesma estrutura de mesclagem no modo de leitura e na pré-visualização.
- Adicione, mova e exclua linhas e colunas, ou troque linhas e colunas da tabela inteira.
- Copie como HTML, GFM comum, TSV ou CSV. No computador, exporte a tabela como PNG.
- Cole tabelas HTML compatíveis de navegadores e planilhas.
- Converta uma tabela em Obsidian Base após revisar a prévia dos registros.
- Gravações que poderiam remover dados não selecionados são bloqueadas, exceto nas ações explícitas de limpar ou excluir.

<!-- section: requirements-and-compatibility -->
## Requisitos e compatibilidade

Requer Obsidian 1.12.7 ou mais recente. Compatível com desktop e Android. Para converter em Base, ative o plug-in principal Bases do Obsidian.

`<`, `^` e `||` são extensões de sintaxe, então outros editores Markdown podem exibir as mesclagens de forma diferente. Para usar o Advanced Tables, escolha «Editar código Markdown da tabela» e confira os dados depois de ordenar com outro plug-in.

<!-- section: installation -->
## Instalação

No Obsidian, abra «Configurações → Plug-ins da comunidade → Explorar», pesquise Structural Tables, instale e ative.

Para instalar manualmente, extraia `structural-tables-<version>.zip` em `Vault/.obsidian/plugins/`, recarregue o Obsidian e ative o plug-in.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Como usar

Crie uma tabela Markdown e use a sintaxe abaixo:

```markdown
| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |
```

`<` mescla com a coluna anterior no código-fonte; `^` mescla com a célula acima. O `||` da linha separadora delimita os cabeçalhos de linha sem adicionar uma coluna.

Clique numa célula na pré-visualização. Enter salva e avança, Shift+Enter insere quebra de linha e Escape cancela. Arraste a alça para mover linhas ou colunas.

Com um intervalo de células selecionado, Delete/Backspace apaga apenas o texto, preservando linhas e mesclagens. Para excluir linhas, colunas ou toda a tabela, use o menu de contexto. As alterações podem ser desfeitas.

Copie ou recorte intervalos e cole apenas onde a estrutura de células mescladas possa ser preservada. No celular, as informações temporárias de mesclagem se perdem após reiniciar ou substituir o conteúdo da área de transferência.

No desktop, visualize, copie ou salve o PNG da tabela inteira. Edições de células ainda não salvas não aparecem na imagem. A exportação para PNG não está disponível no celular.

Salve a nota e mova as tabelas para fora de listas ou citações antes de convertê-las em Base. As mesclagens são achatadas, e restaurar a tabela não exclui as notas de registro criadas.

<!-- section: settings -->
## Configurações

«Geral»: idioma, colagem de HTML e avisos de conflito. «Modos de exibição»: leitura, pré-visualização, diagnósticos e edição de tabelas GFM comuns. «Aparência»: estilo, largura, espaçamento e linhas alternadas.

Escolha Seguir tema, Grade ou Tabela de três linhas. Mudar a aparência ou o idioma do plug-in não altera o Markdown nem a direção do texto da nota.

<!-- section: limitations -->
## Limitações

O plug-in não é uma planilha e não calcula fórmulas. Não oferece estilo por célula, legendas, Markdown em blocos dentro de células ou quebras reais de linha no código-fonte da célula.

O HTML importado vira texto simples e quebras visuais `<br>` compatíveis. O GFM comum não preserva todas as mesclagens; a conversão em Base achata os cabeçalhos.

<!-- section: privacy-and-security -->
## Privacidade e segurança

As tabelas são processadas localmente, sem envio de notas ou coleta de análises. Visualizar a tabela não modifica seu Markdown.

Imagens e fontes remotas seguem o comportamento de rede do Obsidian e do tema. Não publique caminhos ou conteúdo particular em issues públicos.

<!-- section: development -->
## Desenvolvimento

Use Node 24.19.0 e npm 11.17.0. Instale as dependências e execute as verificações:

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## Suporte

Use Q&A para dúvidas, Ideas para sugestões e GitHub Issues para problemas reproduzíveis. Informe a versão do Obsidian, o tema, o Markdown da tabela e os resultados esperado e observado.

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

Relate vulnerabilidades pelo canal privado de segurança, nunca em um issue público.

<!-- section: license -->
## Licença

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
