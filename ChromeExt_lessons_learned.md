# Lecciones Aprendidas en Desarrollo de Extensiones de Chrome (Manifest V3)

Este documento recopila los incidentes, errores y discrepancias encontrados durante el ciclo de vida y desarrollo de la extensión **Google Maps Spatial Sync & Export Engine (GMaps-RW)**, junto con sus causas profundas y **principios de ingeniería generalizables a cualquier extensión de navegador**.

---

## Índice de Lecciones

1. [Manifest V3: Restricción de Origen en `web_accessible_resources`](#1-manifest-v3-restricción-de-origen-en-web_accessible_resources)
2. [La Paradoja del Mocking: Por qué los Tests Unitarios no detectan estados del DOM de una SPA](#2-la-paradoja-del-mocking-por-qué-los-tests-unitarios-no-detectan-estados-del-dom-de-una-spa)
3. [Detección Heurística Multinivel vs. Selectores Estáticos de Clases/ARIA](#3-detección-heurística-multinivel-vs-selectores-estáticos-de-clasesaria)
4. [Recuperación de Estado en la UI ante Errores y Excepciones](#4-recuperación-de-estado-en-la-ui-ante-errores-y-excepciones)
5. [Inadecuación de Expresiones Regulares para Streams JSON/Protobuf Anidados](#5-inadecuación-de-expresiones-regulares-para-streams-jsonprotobuf-anidados)
6. [Regla de Match Patterns en Chrome: Prohibición de TLDs Comodín](#6-regla-de-match-patterns-en-chrome-prohibición-de-tlds-comodín)
7. [Automatización DOM Agnóstica al Idioma (I18N e Identificadores Semánticos)](#7-automatización-dom-agnóstica-al-idioma-i18n-e-identificadores-semánticos)
8. [Auto-Apertura y Heurística de Enrutamiento en SPAs Complejas](#8-auto-apertura-y-heurística-de-enrutamiento-en-spas-complejas)
9. [Ciclo de Vida Epímero del Service Worker (Heartbeats y Puertos)](#9-ciclo-de-vida-epímero-del-service-worker-heartbeats-y-puertos)

---

## 1. Manifest V3: Restricción de Origen en `web_accessible_resources`

### Síntoma / Error
Al intentar cargar la extensión en Chrome Developer Mode (`chrome://extensions`):
```text
Invalid value for 'web_accessible_resources[0]'. Invalid match pattern.
Could not load manifest.
```

### Causa Raíz
En `manifest.json`, se configuró:
```json
"web_accessible_resources": [
  {
    "resources": ["dist/injected_interceptor.bundle.js"],
    "matches": ["*://www.google.com/maps/*"]
  }
]
```
En la especificación de **Chrome Manifest V3**, las reglas de coincidencia (`matches`) en `web_accessible_resources` **solo admiten patrones a nivel de origen**. A diferencia de `content_scripts.matches` (que sí permite rutas como `/maps/*`), `web_accessible_resources` prohíbe terminantemente cualquier ruta que no sea `/*`.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Regla de Oro en MV3**: En `web_accessible_resources`, el campo `matches` siempre debe terminar en `/*` a nivel de host (por ejemplo, `https://www.google.com/*` o `*://*.dominio.com/*`). Si necesitas restringir la ejecución a subrutas específicas, haz el filtrado dentro del script inyectado mediante `window.location.pathname`, nunca en la declaración del manifiesto.

---

## 2. La Paradoja del Mocking: Por qué los Tests Unitarios no detectan estados del DOM de una SPA

### Síntoma / Error
El test suite de Vitest reportó 100% de éxito (19/19 tests pasando), pero al ejecutar la extensión en vivo en Google Maps arrojó:
```text
[EXTRACTION] Google Maps scrolling container (role="feed") not found in active document.
```

### Causa Raíz
Los tests unitarios evalúan funciones puras en aislamiento dentro de un entorno sintetizado (Node.js/jsdom):
- Se comprobó que el parser de coordenadas extrae `!3d/!4d` correctamente dada una URL.
- Se comprobó que el generador de Excel serializa un array de objetos a `.xlsx`.
- **Lo que NO se comprobó**: El estado dinámico de la Single Page Application (SPA). El usuario estaba en la vista del mapa global (lienzo WebGL/Canvas). Los pines estaban dibujados en la GPU, pero el panel lateral HTML donde residen los nodos del DOM con la lista de lugares no había sido abierto por el usuario.

### Enseñanza Generalizable
> [!TIP]
> **Enseñanza de Arquitectura**: En extensiones que interactúan con SPAs complejas (Google Maps, Twitter/X, LinkedIn, Notion):
> 1. Las pruebas unitarias validan la lógica de procesamiento de datos, pero **no pueden garantizar la presencia del DOM**.
> 2. El código del Content Script debe asumir que **las precondiciones visuales pueden no estar cumplidas**.
> 3. Implementa siempre rutinas de auto-apertura o detección de precondiciones con mensajes amigables y accionables (ej: *"Panel de guardados no detectado. Abre la lista en Google Maps antes de iniciar"*), en lugar de arrojar excepciones técnicas genéricas.

---

## 3. Detección Heurística Multinivel vs. Selectores Estáticos de Clases/ARIA

### Síntoma / Error
Al intentar identificar el contenedor con scroll, buscar exclusivamente `div[role="feed"]` falló porque Google Maps utiliza múltiples estructuras según la versión, tipo de lista y dispositivo:
- Listas de guardados: `div.m6QErb`, `div[role="region"]`, o `div#pane div[tabindex="-1"]`.
- Resultados de búsqueda: `div[role="feed"]`.

### Causa Raíz
Las grandes plataformas web actualizan constantemente sus clases minificadas (obfuscadas) y sus roles ARIA mediante compiladores como Closure Compiler.

### Enseñanza Generalizable
> [!TIP]
> **Enseñanza**: Para scraping o interacción robusta en extensiones:
> 1. **Evita depender de un solo selector ARIA o clase CSS**.
> 2. **Aplica rastreo de ancestros**: Si localizas cualquier enlace diana (`a[href*="/place/"]`), recorre hacia arriba sus nodos padres (`parentElement`) inspeccionando con `window.getComputedStyle`:
>    ```typescript
>    const isScrollable = parent.scrollHeight > parent.clientHeight &&
>      (style.overflowY === 'auto' || style.overflowY === 'scroll');
>    ```
>    El primer ancestro con scroll activo es, por definición matemática, el contenedor de virtualización.

---

## 4. Recuperación de Estado en la UI ante Errores y Excepciones

### Síntoma / Error
Cuando ocurrió el error de contenedor no encontrado, el botón **"Start Extraction"** en el Side Panel permaneció deshabilitado indefinidamente, forzando al usuario a recargar la extensión.

### Causa Raíz
El controlador de la interfaz deshabilitaba el botón al despachar el comando (`btnStartExtract.disabled = true`), pero la rutina de restauración (`resetExtractionUiState()`) únicamente se invocaba al recibir un evento de éxito (`OPERATION_FINISHED`). El mensaje de error (`LOG_ENTRY` nivel `error`) no disparaba la liberación de los botones.

### Enseñanza Generalizable
> [!WARNING]
> **Principio de Resiliencia en UI**: En extensiones basadas en mensajería asíncrona entre contextos (`SidePanel` <-> `ServiceWorker` <-> `ContentScript`):
> - Toda máquina de estados en la interfaz debe contar con un **manejador centralizado de errores** que garantice la reversión del estado de los controles interactivos.
> - Ninguna acción del usuario debe quedar bloqueada de forma permanente tras una falla controlada o excepción capturada.

---

## 5. Inadecuación de Expresiones Regulares para Streams JSON/Protobuf Anidados

### Síntoma / Error
Durante la implementación inicial de `BatchexecuteUnpacker`, la expresión regular `chunkRegex = /\[\["wrb\.fr",\s*"([^"]+)",\s*(".*?"|null|\[.*?\])/g` fallaba al decodificar respuestas que contenían comillas escapadas (`\"`) o corchetes internos (`[[ ... ]]`).

### Causa Raíz
Las expresiones regulares convencionales son incapaces de parsear gramáticas recursivas o de corchetes balanceados en presencia de caracteres de escape y cadenas anidadas. La búsqueda no codiciosa (`.*?`) se detenía en la primera comilla escapada o en el primer corchete de cierre interno.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Regla de Parsing**: Para des-empaquetar cargas útiles RPC de Google (`batchexecute`, `WIZ`, Protobuf sobre JSON):
> - **Nunca utilices expresiones regulares para extraer el cuerpo completo del JSON**.
> - Emplea un **escáner de delimitadores balanceados** que mantenga un contador de profundidad (`depth`), distinga si está dentro de una cadena de texto (`inString`) y respete el escape por barra invertida (`\\`).

---

## 6. Regla de Match Patterns en Chrome: Prohibición de TLDs Comodín

### Síntoma / Error Potencial
Intentar declarar `*://*.google.*/maps*` en `manifest.json` para dar soporte a todos los países del mundo.

### Causa Raíz
El motor de validación de Chrome prohíbe terminantemente comodines en el Dominio de Nivel Superior (TLD). Un patrón como `*://example.*` o `https://www.google.*/*` se considera **inválido** y bloquea la instalación de la extensión.

### Enseñanza Generalizable
> [!CAUTION]
> En extensiones con alcance internacional sobre servicios con dominios por país (Google, Amazon, Yahoo):
> - Debes enumerar explícitamente los dominios de primer nivel soportados (`.com`, `.es`, `.com.ar`, `.com.mx`, `.co.uk`, etc.) o utilizar `<all_urls>` / permisos amplios justificados.

---

## 7. Automatización DOM Agnóstica al Idioma (I18N e Identificadores Semánticos)

### Síntoma / Error Potencial
Un usuario con Google Maps en inglés tiene botones `"Save"`, mientras que un usuario en español tiene `"Guardar"`, en francés `"Sauvegarder"` y en alemán `"Speichern"`. Un selector rígido por texto falla en cualquier entorno no previsto.

### Causa Raíz
El renderizado del DOM de Google Maps se localiza dinámicamente según la cuenta del usuario (`hl=es`, `hl=en`, `hl=fr`).

### Enseñanza Generalizable
> [!TIP]
> **Estrategia Multi-Idioma**:
> 1. Prioriza selectores por atributos de datos independientes de traducción (ej: `button[data-value="Save"]`, `button[data-item-id="save"]`).
> 2. Si se requiere inspeccionar texto, utiliza normalización a minúsculas y listas de sinónimos internacionales (`['save', 'guardar', 'sauvegarder', 'salva', 'speichern']`).
> 3. Utiliza firmas visuales como rutas SVG o selectores de posición estructural en la barra de herramientas del card.

---

## 8. Auto-Apertura y Heurística de Enrutamiento en SPAs Complejas

### Síntoma / Error
El usuario ejecutó la extracción desde la vista satelital/mapamundi general de Google Maps sin tener abierto el panel lateral de "Guardados", provocando que no existiese ningún contenedor de lista en el DOM.

### Causa Raíz
A diferencia de sitios web convencionales con URLs fijas para cada recurso, las SPAs cargan y descargan vistas completas dentro de un solo canvas/documento.

### Enseñanza Generalizable
> [!TIP]
> **Enfoque Proactivo vs. Pasivo en Extensiones**:
> - En lugar de limitarse a fallar pasivamente cuando una vista requerida no está montada, el Content Script debe intentar **navegar o accionar la UI automáticamente** (ej: haciendo clic programático en el botón "Guardados" o abriendo la pestaña correspondiente).
> - Si la auto-apertura no es posible, la extensión debe guiar al usuario mediante pasos visuales claros en la interfaz en lugar de arrojar trazas de error crípticas.

---

## 9. Ciclo de Vida Epímero del Service Worker (Heartbeats y Puertos)

### Síntoma / Error Potencial
En Manifest V3, el Service Worker entra en suspensión tras 30 segundos de inactividad o 5 minutos de ejecución continuada, abortando extracciones de listas largas (+500 lugares).

### Causa Raíz
MV3 eliminó las páginas de fondo persistentes (`persistent: true`) en favor de Service Workers basados en eventos.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Patrón Keep-Alive en MV3**:
> 1. Establece un canal bidireccional mediante `chrome.runtime.Port` (`chrome.runtime.connect`).
> 2. Implementa un intercambio de latidos (*heartbeat pings*) cada 20 a 25 segundos entre el Content Script / SidePanel y el Service Worker. Cada mensaje recibido a través de un puerto abierto resetea el temporizador de inactividad de 30 segundos de Chrome.
> 3. Almacena cualquier estado transitorio de la cola en `chrome.storage.session` para garantizar que, si el worker se recicla, la sesión se restaure instantáneamente sin pérdida de datos.

