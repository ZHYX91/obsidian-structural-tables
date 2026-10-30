# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Veja aqui como realizar as tarefas mais comuns e quais cuidados tomar. Os guias completos em [inglês](../../README.md) e [chinês simplificado](README.zh-CN.md) cobrem os casos especiais.

Adicione células mescladas, várias linhas de cabeçalho, cabeçalhos de linha e tabelas sem cabeçalho às tabelas Markdown. Apenas visualizar uma tabela não reescreve a nota.

## Capturas de tela

### Tabela de três linhas no modo de leitura

Cabeçalhos agrupados e células mescladas aparecem sem bordas completas ao redor de cada célula.

![Tabela de três linhas com células mescladas no modo de leitura](../assets/structural-tables-reading-view-en.png)

### Edição na pré-visualização

Clique numa célula no computador ou toque duas vezes na tela sensível ao toque para editar o texto.

![Edição de uma célula na pré-visualização](../assets/structural-tables-live-preview-en.png)

### Configurações de aparência

![Configurações de aparência do Structural Tables](../assets/structural-tables-settings-en.png)

A imagem de aparência mostra os componentes reais de configurações e tabela em um navegador de teste; não é uma captura do Obsidian.

<!-- section: features -->
## Recursos

- Novas tabelas usam `<<` e `^^` compatíveis com GFM por padrão; a sintaxe compacta continua disponível.

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

`<`, `^` e `||` são extensões de sintaxe, então outros editores Markdown podem exibir as mesclagens de forma diferente. Para usar o Advanced Tables, escolha “Editar código Markdown da tabela” e confira os dados depois de ordenar com outro plug-in.

### Uma nota e um pedido de desculpas sobre a compatibilidade das tabelas

**2026-10-31**

Criei o Structural Tables como uma ferramenta pequena para lidar com tabelas complexas de artigos científicos no Obsidian, com ajuda da IA na implementação. Eu precisava de apenas uma pequena parte dos recursos do LaTeX e tentei substituí-la com algumas extensões de Markdown. No início, pensei principalmente no meu próprio uso e não considerei suficientemente outros editores Markdown.

A sintaxe original para tabelas sem cabeçalho de coluna e com cabeçalhos de linha não segue a estrutura de tabelas do GFM. Por isso, alguns editores não conseguem reconhecer ou exibir essas tabelas corretamente. Foi um descuido meu no projeto. Peço desculpas pelos transtornos ao ler, compartilhar ou migrar notas.

Agora há uma opção compatível com GFM além da sintaxe compacta: colunas antes de `<<` são cabeçalhos de linha e linhas antes de `^^` são cabeçalhos de coluna. Se `^^` estiver na primeira linha, não há cabeçalho de coluna. Outros editores GFM reconhecem a tabela, mas exibem as setas como texto comum.

<!-- section: installation -->
## Instalação

No Obsidian, abra “Configurações → Plug-ins da comunidade → Explorar”, pesquise Structural Tables, instale e ative.

Para instalar manualmente, extraia `structural-tables-<version>.zip` em `Vault/.obsidian/plugins/`, recarregue o Obsidian e ative o plug-in.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Como usar

Coloque o cursor em uma linha vazia, sem selecionar texto, e execute **Inserir tabela estrutural** na paleta de comandos. O exemplo é inserido diretamente. Mova o cursor para fora da tabela na pré-visualização ou mude para o modo de leitura para ver o resultado. Você pode adaptar este exemplo com a mesma estrutura:

```markdown
| Região | << | Vendas | < |
| --- | --- | --- | --- |
| Trimestre | << | Q1 | Q2 |
| ^^ | << | ^^ | ^^ |
| Norte | << | 10 | 12 |
| ^ | << | 8 | 11 |
```

Novas tabelas usam, por padrão, a sintaxe compatível com GFM. As colunas anteriores a `<<` no código-fonte são cabeçalhos de linha; as linhas anteriores a `^^` são cabeçalhos de coluna. O plugin oculta os marcadores.

Para criar uma tabela sem cabeçalho de coluna, preencha a primeira linha com `^^` (mantenha `<<` no cruzamento, se houver). A segunda linha continua sendo o separador GFM normal com `---`.

A sintaxe compacta antiga com `||` continua disponível. Os comandos de conversão mostram uma prévia antes de substituir o código; isso é diferente de converter para GFM comum, que achata a estrutura. A configuração para novas tabelas não altera tabelas existentes.

Sintaxe compacta anterior:

```markdown
| Região | Vendas | < |
| Trimestre | Q1 | Q2 |
| --- || --- | --- |
| Norte | 10 | 12 |
| ^ | 8 | 11 |
```

Tabela sem cabeçalho de coluna:

```markdown
| ^^ | ^^ |
| --- | ---: |
| A | 10 |
| B | 20 |
```

Se a tabela não aparecer como esperado, use **Verificar tabelas estruturais da nota atual**. O comando aponta problemas de sintaxe sem alterar o Markdown.

Clique numa célula na pré-visualização. Enter salva e avança, Shift+Enter insere quebra de linha e Escape cancela. Arraste a alça para mover linhas ou colunas.

Com um intervalo de células selecionado, Delete/Backspace apaga apenas o texto, preservando linhas e mesclagens. Para excluir linhas, colunas ou toda a tabela, use o menu de contexto. As alterações podem ser desfeitas.

Copie ou recorte intervalos e cole apenas onde a estrutura de células mescladas possa ser preservada. No celular, as informações temporárias de mesclagem se perdem após reiniciar ou substituir o conteúdo da área de transferência.

No desktop, visualize, copie ou salve o PNG da tabela inteira. Edições de células ainda não salvas não aparecem na imagem. A exportação para PNG não está disponível no celular.

Salve a nota e mova as tabelas para fora de listas ou citações antes de convertê-las em Base. As mesclagens são achatadas, e restaurar a tabela não exclui as notas de registro criadas.

Separe as células mescladas na área de dados antes de converter a tabela em Base. Depois, coloque o cursor no bloco Base e execute **Criar registro na Base atual** para adicionar um registro vazio.

### Tabelas Markdown comuns

As tabelas GFM comuns usam o editor nativo do Obsidian por padrão. Ative “Editar também tabelas Markdown comuns” para usar os controles do Structural Tables. Se uma linha tiver mais células no Markdown que o cabeçalho, parte do conteúdo pode ficar oculta. Abra “Editar código Markdown da tabela” e corrija essas células antes de alterar a estrutura.

### Fórmulas e quebras de linha

Shift+Enter insere uma quebra visual de linha, gravada como um `<br>` compatível. Uma barra `|` não escapada dentro de uma fórmula pode ser confundida com separador de tabela. Nesse caso, o rascunho é mantido e a gravação é recusada. Dependendo do significado, use os comandos TeX `\lvert`, `\rvert` ou `\mid`.

### Colar e copiar

A conversão de tabelas HTML só acontece quando é possível manter a estrutura das células com segurança. Se não for possível preservar a formatação, o plugin pode usar a alternativa completa em texto simples ou deixar a colagem para o Obsidian. Texto simples não preserva mesclagens nem estilos. Confira o resultado no aplicativo de destino após converter para GFM comum.

### Converter em GFM comum

Clique com o botão direito na tabela e escolha “Converter em tabela GFM simples…”. No editor, você também pode posicionar o cursor no código da tabela e executar o comando de conversão para GFM simples.

Se a tabela tiver apenas cabeçalhos de linha, recomenda-se trocar linhas e colunas para mover esses rótulos ao cabeçalho superior. Ao manter a orientação sem cabeçalhos de coluna, uma linha vazia de cabeçalho é adicionada no topo e todas as linhas de dados são preservadas.

As células mescladas são separadas. Seu conteúdo se repete em cada posição que ocupavam. Várias linhas de cabeçalho são unidas em uma só. Os níveis são separados por “ / ”. Os cabeçalhos de linha que permanecem na lateral viram células comuns; o GFM não mantém sua função de cabeçalho.

Alterne entre a prévia do resultado e o código Markdown; depois copie o resultado atual ou substitua a tabela original. A visualização de leitura permite apenas copiar. A substituição é uma única alteração, reversível com um Desfazer; fechar a janela não altera o código. Conclua primeiro a edição das células. Se a tabela ou o arquivo mudar, abra a prévia novamente. O comando de cópia direta em GFM usa a orientação recomendada.

### Limites de PNG e restauração da Base

O limite de exportação PNG é 8192 pixels por lado ou 16 megapixels no total. Se não for possível capturar a tabela inteira, nenhuma imagem cortada é criada. A conversão em Base cria notas de registro e o arquivo `_promotion.json`. Restaurar a tabela original não traz edições posteriores dos registros nem apaga as notas criadas.

<!-- section: settings -->
## Configurações

“Geral”: idioma, colagem de HTML e avisos de conflito. “Modos de exibição”: leitura, pré-visualização, diagnósticos e edição de tabelas GFM comuns. “Aparência”: estilo, largura, espaçamento e linhas alternadas.

Escolha Seguir tema, Grade ou Tabela de três linhas. Mudar a aparência ou o idioma do plug-in não altera o Markdown nem a direção do texto da nota.

Abaixo de “Linhas e fundo” e “Layout e espaçamento”, uma tabela de exemplo mostra as alterações imediatamente. Ela usa texto fixo e não lê nem edita notas. As configurações se aplicam às tabelas de todo o cofre e são salvas automaticamente.

A **sintaxe para novas tabelas** é compatível com GFM por padrão. Escolher « Compacta » só afeta novas tabelas e importações HTML, não altera notas existentes.

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
