# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Aquí tienes las operaciones habituales y las precauciones principales. Para los casos menos comunes, consulta las guías en [inglés](../../README.md) o [chino simplificado](README.zh-CN.md).

Añade celdas combinadas, varias filas de encabezados, encabezados de fila y tablas sin encabezados a Markdown. Abrir o leer una tabla nunca reescribe el Markdown de la nota.

## Capturas de pantalla

### Tabla de tres líneas en vista de lectura

Muestra encabezados agrupados y celdas combinadas sin dibujar un borde completo alrededor de cada celda.

![Tabla de tres líneas con celdas combinadas en vista de lectura](../assets/structural-tables-reading-view-en.png)

### Edición en vista previa

Haz clic en una celda en el escritorio o tócala dos veces en una pantalla táctil para editarla.

![Edición de celdas en vista previa](../assets/structural-tables-live-preview-en.png)

### Ajustes de apariencia

![Ajustes de apariencia de Structural Tables](../assets/structural-tables-settings-en.png)

<!-- section: features -->
## Funciones

- Escribe `<` para combinar con la columna anterior del código fuente o `^` para combinar con la celda superior.
- Usa `||` sin espacios en la fila separadora para marcar las columnas que actúan como encabezados de fila.
- Muestra las combinaciones tanto en vista de lectura como en la vista previa.
- Añade, mueve y elimina filas o columnas, y transpone toda la tabla.
- Copia como HTML, GFM normal, TSV o CSV. En el escritorio, exporta la tabla como PNG.
- Pega tablas HTML compatibles desde navegadores y hojas de cálculo.
- Convierte una tabla en una Base de Obsidian tras revisar la vista previa.
- Evita modificar datos ocultos o no seleccionados, salvo que elijas expresamente borrar contenido.

<!-- section: requirements-and-compatibility -->
## Requisitos y compatibilidad

Requiere Obsidian 1.12.7 o posterior. Compatible con escritorio y Android. Para convertir a Base debes activar el plugin integrado Bases.

`<`, `^` y `||` son extensiones de sintaxis; otros editores Markdown pueden mostrar las combinaciones de forma distinta. Para usar Advanced Tables, abre «Editar código fuente de la tabla» y revisa los datos después de ordenar con otras herramientas.

<!-- section: installation -->
## Instalación

En Obsidian, abre «Ajustes → Complementos de la comunidad → Explorar», busca Structural Tables, instálalo y actívalo.

Para la instalación manual, extrae `structural-tables-<version>.zip` en `Vault/.obsidian/plugins/`, recarga Obsidian y activa el complemento.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Uso

Crea una tabla Markdown y usa la siguiente sintaxis:

```markdown
| Región | Ventas | < |
| Trimestre | Q1 | Q2 |
| --- || --- | --- |
| Norte | 10 | 12 |
| ^ | 8 | 11 |
```

`<` combina con la columna anterior del texto fuente; `^` combina hacia arriba. El `||` de la fila separadora marca el límite de encabezados de fila sin añadir otra columna.

Si una tabla no se ve bien, usa **Validar las tablas estructurales de la nota actual**. El comando muestra los problemas de sintaxis sin modificar Markdown.

Haz clic en una celda en Vista previa. Enter guarda y avanza; Mayús+Enter inserta un salto de línea; Escape cancela. Arrastra un controlador para mover filas o columnas.

Con una selección de celdas, Supr o Retroceso solo borra el contenido, no las filas ni las combinaciones. Usa el menú contextual para eliminar filas, columnas o tablas. Puedes deshacer los cambios.

Los rangos copiados o cortados solo se pegan si puede conservarse la estructura combinada. En móvil, la información de combinación de una copia se pierde al reiniciar o al cambiar el portapapeles.

En escritorio puedes previsualizar, copiar o guardar un PNG de la tabla completa. Los cambios de celda sin guardar no aparecen en la imagen. La exportación de PNG no está disponible en móvil.

Guarda la nota y saca la tabla de listas o citas antes de convertirla en Base. La conversión aplana las combinaciones; restaurar la tabla original no elimina las notas de registro creadas.

Antes de convertir a Base, separa las celdas combinadas del área de datos. Después, sitúa el cursor dentro del bloque Base y ejecuta **Crear un registro para la Base actual** para añadir un registro vacío.

### Tablas Markdown normales

Las tablas GFM normales utilizan por defecto el editor nativo de Obsidian. Activa «Controlar las tablas Markdown ordinarias» para usar los controles de este plugin. Si una fila tiene más celdas en el código fuente que el encabezado, puede haber datos ocultos. Usa «Editar código fuente de la tabla» para resolverlos antes de editarla con estos controles.

### Fórmulas y saltos de línea

Mayús+Enter inserta un salto visual de línea que se guarda mediante `<br>` cuando es compatible. Un `|` sin escapar dentro de una fórmula puede confundirse con un separador de la tabla. En ese caso, se conserva el borrador y no se guarda. Según su significado, usa los comandos TeX `\lvert`, `\rvert` o `\mid`.

### Pegado y copia

Las tablas HTML solo se convierten cuando es posible conservar su estructura de forma segura. Si no se pueden conservar ciertos formatos, se puede usar todo el texto sin formato del portapapeles o dejar que Obsidian gestione el pegado. El texto simple no conserva combinaciones ni estilos. Revisa en la aplicación de destino cualquier conversión a GFM ordinario.

### Convertir a GFM simple

Haz clic derecho en la tabla y elige «Convertir a tabla GFM simple…». En el editor también puedes colocar el cursor en el código de la tabla y ejecutar el comando de conversión a GFM simple.

Si la tabla solo tiene encabezados de fila, se recomienda intercambiar filas y columnas para llevar esas etiquetas al encabezado superior. Si mantienes la orientación sin encabezados de columna, se añade una fila vacía de encabezados arriba y se conservan todas las filas de datos.

Las celdas combinadas se separan. Su contenido se repite en todas las posiciones que cubrían. Las múltiples filas de encabezados se unen en una sola. Los niveles se separan con « / ». Los encabezados de fila que permanecen a un lado pasan a ser celdas normales; GFM no conserva su función de encabezado.

Alterna entre la vista previa del resultado y el código Markdown; después copia el resultado actual o reemplaza la tabla original. La vista de lectura solo permite copiar. El reemplazo es un único cambio que se revierte con un solo Deshacer; cerrar la ventana no modifica el código. Termina primero la edición de celdas. Si cambia la tabla o su archivo, vuelve a abrir la vista previa. El comando de copia directa a GFM utiliza la orientación recomendada.

### Límites de PNG y recuperación de Base

El PNG tiene un límite de 8192 píxeles por lado y 16 megapíxeles en total. Si no cabe toda la tabla, no se crea una imagen recortada. Al convertir a Base se crean notas de registro y un archivo `_promotion.json`. Restaurar la tabla original no incorpora cambios posteriores de Base ni elimina las notas creadas.

<!-- section: settings -->
## Ajustes

«General»: idioma, pegado HTML y conflictos. «Vistas»: lectura, vista previa, diagnósticos y uso del editor en tablas GFM normales. «Apariencia»: estilo, ancho, espaciado y filas alternas.

Elige Seguir tema, Cuadrícula o Tabla de tres líneas. Cambiar la apariencia o el idioma de la interfaz no modifica Markdown ni la dirección de la nota.

<!-- section: limitations -->
## Limitaciones

No es una hoja de cálculo y no evalúa fórmulas. No permite estilos por celda, títulos de tabla, Markdown de bloques dentro de celdas ni saltos de línea reales en el origen.

El HTML importado se convierte en texto y saltos visuales `<br>` compatibles. GFM normal no conserva todas las combinaciones y la conversión a Base aplana los encabezados.

<!-- section: privacy-and-security -->
## Privacidad y seguridad

Las tablas se procesan localmente. No se suben notas ni se recopilan estadísticas. La lectura de una tabla no modifica su Markdown.

Las imágenes y fuentes externas siguen las reglas de red de Obsidian y del tema. No publiques rutas ni contenido privado de tus notas en los informes de errores.

<!-- section: development -->
## Desarrollo

Usa Node 24.19.0 y npm 11.17.0. Instala las dependencias y ejecuta las comprobaciones:

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## Ayuda

Para preguntas usa Q&A; para propuestas, Ideas; y para errores reproducibles, GitHub Issues. Indica la versión de Obsidian, el tema, el Markdown de la tabla y los resultados esperado y real.

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

Comunica las vulnerabilidades de manera privada mediante el sistema de informes de seguridad.

<!-- section: license -->
## Licencia

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
