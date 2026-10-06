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
10. [Sintetización de Eventos de Puntero/Hover en SPAs con Enlaces 'Lazy' (Evitar Nudges Manuales del Usuario)](#10-sintetización-de-eventos-de-punterohover-en-spas-con-enlaces-lazy-evitar-nudges-manuales-del-usuario)
11. [La Trampa de los Timers en el Service Worker (`setInterval` no previene la suspensión en MV3)](#11-la-trampa-de-los-timers-en-el-service-worker-setinterval-no-previene-la-suspensión-en-mv3)
12. [Invalidación de Contexto de Extensión en Pestañas Previas tras Recargar (Extension Context Invalidated)](#12-invalidación-de-contexto-de-extensión-en-pestañas-previas-tras-recargar-extension-context-invalidated)
13. [Heurísticas de Validación Estricta para Cargas Útiles Protobuf/RPC y Filtrado de Contaminación del DOM en SPAs](#13-heurísticas-de-validación-estricta-para-cargas-útiles-protobufrpc-y-filtrado-de-contaminación-del-dom-en-spas)
14. [Heurísticas de Detección Falsa de Contenedores y Distinción entre Vista de Mapa Canvas (WebGL) vs. Vista de Lista (DOM)](#14-heurísticas-de-detección-falsa-de-contenedores-y-distinción-entre-vista-de-mapa-canvas-webgl-vs-vista-de-lista-dom)
15. [Hidratación Accesible por Foco Teclado (`a11y focusin`) como Bypass Determinístico a Eventos Sintéticos `isTrusted: false`](#15-hidratación-accesible-por-foco-teclado-a11y-focusin-como-bypass-determinístico-a-eventos-sintéticos-istrusted-false)
16. [Discrepancias Estructurales de DOM entre Feeds de Búsqueda y Listas Personalizadas (Placelists), la Trampa de Altura en Listas Cortas y Desempaquetado Post-Order de Protobuf](#16-discrepancias-estructurales-de-dom-entre-feeds-de-búsqueda-y-listas-personalizadas-placelists-la-trampa-de-altura-en-listas-cortas-y-desempaquetado-post-order-de-protobuf)
17. [Detección y Navegación Autónoma entre el Directorio de Guardados (Hub de Listas) y las Listas Individuales en Google Maps](#17-detección-y-navegación-autónoma-entre-el-directorio-de-guardados-hub-de-listas-y-las-listas-individuales-en-google-maps)
18. [La Trampa de Pines Huérfanos con Coordenadas Crudas, Falso Parseo de Calificaciones [4.6, 126] y Virtualización en Listas Masivas (200+ Lugares)](#18-la-trampa-de-pines-huérfanos-con-coordenadas-crudas-falso-parseo-de-calificaciones-46-126-y-virtualización-en-listas-masivas-200-lugares)
19. [Compuerta de Término Temprano por Conteo de Cabecera, Navegación Autónoma Inter-Listas y Desempaquetado de Placelists Personalizadas sin ChIJ](#19-compuerta-de-término-temprano-por-conteo-de-cabecera-navegación-autónoma-inter-listas-y-desempaquetado-de-placelists-personalizadas-sin-chij)
20. [Fusión Espacial por Coordenadas, Aislamiento de Caché Inter-Listas, Filtrado de Artefactos Protobuf/Pegman y Desbloqueo de Feeds Virtuales Profundos](#20-fusión-espacial-por-coordenadas-aislamiento-de-caché-inter-listas-filtrado-de-artefactos-protobufpegman-y-desbloqueo-de-feeds-virtuales-profundos)
21. [La Falacia del Límite de Strings, Extracción de Metadatos de Fotos como Lugares Falsos y Eliminación de Coordenadas Fantasma con Latitud Entera](#21-la-falacia-del-límite-de-strings-extracción-de-metadatos-de-fotos-como-lugares-falsos-y-eliminación-de-coordenadas-fantasma-con-latitud-entera)
22. [Bounding Boxes como Colecciones Falsas, Fuga de Tokens Fotográficos de 11 Caracteres y Detección de Listas del Sistema en el Hub](#22-bounding-boxes-como-colecciones-falsas-fuga-de-tokens-fotográficos-de-11-caracteres-y-detección-de-listas-del-sistema-en-el-hub)
23. [Deduplicación Espacial por Radio de Proximidad (35m), Cadencia de Red de 2s vs Clics Destructivos, Limpieza de Prefijos de Coordenadas y Volcado de Diagnóstico Crudo (Raw Data Log)](#23-deduplicación-espacial-por-radio-de-proximidad-35m-cadencia-de-red-de-2s-vs-clics-destructivos-limpieza-de-prefijos-de-coordenadas-y-volcado-de-diagnóstico-crudo-raw-data-log)

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

---

## 10. Sintetización de Eventos de Puntero/Hover en SPAs con Enlaces 'Lazy' (Evitar Nudges Manuales del Usuario)

### Síntoma / Error
Al ejecutar la extracción en una lista de Google Maps, el scraper avanzaba pero no cosechaba lugares a menos que el usuario pasara físicamente el ratón (*hover manual*) sobre los pines o las tarjetas de la lista. En ausencia de interacción humana, la tasa de recolección se mantenía en 0 o se estancaba.

### Causa Raíz
Las SPAs modernas de alto rendimiento (como Google Maps) aplican técnicas de **hidratación perezosa (lazy hydration) y delegación de eventos por hover**:
1. Para ahorrar memoria y mitigar scraping automatizado masivo, los elementos de la lista en el DOM no contienen enlaces `<a href="...">` completos ni parámetros de coordenadas (`!3d/!4d`) al montarse.
2. Google Maps asocia escuchadores a eventos de puntero (`pointerover`, `mouseenter`, `mouseover`, `mousemove`).
3. Únicamente cuando se dispara uno de estos eventos sobre la tarjeta o pin, el código interno de la aplicación resuelve la entidad en memoria, inyecta la URL canónica en el enlace hijo (o crea el overlay `a.hfpxzc`), y calcula las coordenadas de alta precisión.
4. Si un script de extensión simplemente despacha un evento síncrono y consulta inmediatamente `querySelectorAll('a[href]')` en la misma pila de ejecución, la consulta falla porque el framework de la SPA programa la mutación del DOM de forma asíncrona (mediante microtareas o `requestAnimationFrame`).

### Enseñanza Generalizable
> [!IMPORTANT]
> **Técnica de Emulación de Puntero y Micro-Yielding para SPAs**:
> Para forzar la resolución de datos dinámicos sin requerir nudges o intervención manual del usuario:
> 1. **Secuencia Multievento con Coordenadas Reales**: Despacha una ráfaga completa de eventos sintéticos (`pointerover`, `pointerenter`, `mouseover`, `mouseenter`, `mousemove`) con coordenadas geométricas plausibles (`clientX`, `clientY` calculadas mediante `getBoundingClientRect()`), tanto en el contenedor de la tarjeta como en sus elementos interactivos internos.
> 2. **Micro-Tick de Espera Obligatorio**: Nunca consultes el DOM inmediatamente tras despachar el evento. Inserta un retardo de microtarea (`await new Promise(r => setTimeout(r, 50 - 80))`) que ceda el control del Event Loop de JavaScript, permitiendo que el framework de la página procese el evento y actualice el árbol DOM antes de recolectar los atributos.

---

## 11. La Trampa de los Timers en el Service Worker (`setInterval` no previene la suspensión en MV3)

### Síntoma / Error
En la consola del Side Panel apareció el mensaje:
```text
[12:10:28 PM] Disconnected from service worker. Reconnecting in 2s...
[12:10:30 PM] Connected to Background Service Worker.
```
Exactamente 30 segundos después de haber iniciado la extracción, el Service Worker fue terminado por Chrome, destruyendo los puertos abiertos y reiniciando el estado en memoria.

### Causa Raíz
En el diseño inicial, el Service Worker contenía un `setInterval(() => { ... }, 20000)` para enviar pings al content script y mantenerse despierto.
**Esta es una de las trampas más comunes de Manifest V3**:
- El motor de ciclo de vida de Chromium **no considera los temporizadores internos (`setInterval`, `setTimeout`) como actividad externa**.
- Si no hay eventos de la API de extensiones (`chrome.webRequest`, `chrome.tabs`, etc.) ni **mensajes entrantes de clientes externos** llegando a través de un puerto, Chromium congela la ejecución del Service Worker y lo destruye a los 30 segundos.
- Por ende, el timer dentro del Service Worker deja de dispararse una vez que Chromium decide suspender el worker.

### Enseñanza Generalizable
> [!CAUTION]
> **Inversión de Control en el Keep-Alive de MV3**:
> - **El latido DEBE originarse siempre en los contextos con DOM vivo** (`Content Script` o `Side Panel` / `Popup`), nunca en el Service Worker.
> - Dado que los scripts de contenido y páginas de extensión residen en pestañas activas con bucles de eventos continuos que Chromium no suspende a los 30s, ellos deben ejecutar el `setInterval(15000)` y enviar mensajes `HEARTBEAT_PING` **hacia** el Service Worker.
> - La recepción de un mensaje a través de `port.onMessage` le indica fehacientemente al gestor de extensiones de Chrome que el Service Worker está atendiendo una solicitud activa, reseteando su temporizador de inactividad de 30 segundos indefinidamente.

---

## 12. Invalidación de Contexto de Extensión en Pestañas Previas tras Recargar (Extension Context Invalidated)

### Síntoma / Error
Al recargar la extensión desde el panel de desarrollador (`chrome://extensions` ⟳) y presionar "Start Extraction" en el Side Panel:
1. El Side Panel quedaba congelado en `0 Harvested Places` y los botones bloqueados.
2. En la página de errores de Chrome (`chrome://extensions/?errors=...`) se acumulaba una ráfaga de excepciones:
   ```text
   [Content Script] Failed to connect to background pipeline: Error: Extension context invalidated.
   ```
3. El log del Side Panel mostraba:
   ```text
   [Init] Extension loaded. Waiting for Google Maps tab...
   [12:40:57 PM] Connected to Background Service Worker.
   [12:40:59 PM] Dispatched extraction start command (mode: hybrid).
   ```
   sin recibir ningún evento ni avance posterior.

### Causa Raíz
Cuando se recarga o actualiza una extensión en Chrome:
1. **Destrucción del Runtime:** El identificador de contexto (`chrome.runtime.id`) de la versión anterior se destruye instantáneamente.
2. **Scripts Huérfanos:** Las pestañas de Google Maps que ya estaban abiertas en el navegador **no se recargan automáticamente**. Permanecen ejecutando el Content Script de la versión anterior.
3. **Falla de API:** Cuando ese Content Script huérfano detecta que su puerto se cerró e intenta reconectarse (`chrome.runtime.connect`), Chromium rechaza la llamada lanzando `Error: Extension context invalidated`. Si el script tiene una rutina de reintento recursiva (`setTimeout(connect, 2500)`), satura la consola de errores de Chrome.
4. **Falta de Detección en el Service Worker:** El nuevo Service Worker arrancó limpio, el Side Panel se conectó a él, pero la pestaña de Google Maps **nunca conectó un puerto nuevo**. Al presionar "Start Extraction", el Service Worker intentaba despachar el comando a un `contentPort` nulo, fallando en silencio sin notificar a la interfaz ni intentar reinyectar el código.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Estrategia Tripartita para Manejar la Invalidación de Contexto**:
> 1. **Freno de Mano en el Content Script:** Antes de cualquier reconexión o llamada a la API, comprueba `if (!chrome.runtime?.id)`. Si es nulo o si la excepción contiene `"Extension context invalidated"`, detén inmediatamente los temporizadores de reconexión y emite un mensaje informativo pidiendo recargar la pestaña, evitando ensuciar el registro de errores de Chrome.
> 2. **Auto-Inyección Dinámica desde el Service Worker (`chrome.scripting.executeScript`):** Si el usuario inicia una acción en el Side Panel y `contentPort === null`, el Service Worker no debe fallar en silencio:
>    - Debe consultar las pestañas abiertas mediante `chrome.tabs.query({ url: '*://*.google.*/maps*' })`.
>    - Debe intentar inyectar en caliente el nuevo Content Script en la pestaña activa usando `chrome.scripting.executeScript({ target: { tabId }, files: ['dist/content.bundle.js'] })`.
> 3. **Feedback Inmediato y Reversión de Estado en la UI:** Si la inyección en caliente no es posible o la pestaña no responde, la extensión debe emitir un mensaje de alta prioridad al usuario en la terminal:
>    ```text
>    [RELOAD_REQUIRED] Por favor presiona F5 en la pestaña de Google Maps para reactivar la conexión.
>    ```
>    y **revertir inmediatamente el estado de los botones** de la interfaz a habilitados para evitar que el usuario quede bloqueado.

---

## 13. Heurísticas de Validación Estricta para Cargas Útiles Protobuf/RPC y Filtrado de Contaminación del DOM en SPAs

### Síntoma / Error
Al mover el ratón o hacer hover en Google Maps durante o después de una extracción, el panel de la extensión comenzó a acumular lugares a un ritmo descontrolado, superando los 1.300 "lugares" en una lista que en realidad sólo tenía unas decenas de pines auténticos.
Al inspeccionar el archivo Excel exportado, se descubrieron registros espurios con títulos como:
- `"Cuenta de Google: Santiago Montoya"` (con coordenadas de la cámara global).
- Días de la semana (`lunes`, `martes`, `domingo`).
- Etiquetas de metadatos de Protobuf (`psm`, `gps`, `photos:...`, `bizbuilder:...`, `casanova:...`).
- Enums numéricos interpretados como coordenadas (`[6, 7]`, `[1.4, 5]`, `[81, 84]`, `[32, 84]`).
- Precios y monedas (`$ 1.282.963`, `150€`).
- Estados de concurrencia y horarios (`un poco concurrido`, `cerrado permanentemente`, `abierto las 24 horas`).
- Zonas horarias (`America/Montevideo`).

### Causa Raíz
El desborde de falsos positivos se debió a la confluencia de tres vulnerabilidades de diseño:
1. **Falta de compuerta de estado en la intercepción RPC:** El escuchador `bridge.onRpc` procesaba y enviaba datos continuamente al Service Worker mediante `EXTRACTION_STREAM_BATCH`, incluso cuando la extracción estaba inactiva o abortada. Como Google Maps realiza peticiones Batchexecute en segundo plano con cada movimiento del cursor (previews de tarjetas, precarga de baldosas y capas vectoriales), cada hover inyectaba decenas de paquetes de red no deseados al pipeline.
2. **Desempaquetado Protobuf excesivamente permisivo:** El unpacker (`rpc-unpacker.ts`) recorría recursivamente cualquier array anidado y, si encontraba dos números cualesquiera, los asumía como latitud y longitud (porque valores como `6` y `7` cumplen formalmente `-90 <= lat <= 90`). Si encontraba cualquier string adyacente, lo tomaba como título y generaba un ID sintético aleatorio (`generateSyntheticPlaceId`), asumiendo erróneamente que era un lugar válido. En realidad, Google Maps transporta miles de arrays con identificadores de tipo, escalas de zoom, deltas de renderizado y pares de dimensiones de interfaz.
3. **Selectores DOM hiper-permisivos y captura de la cámara:** En el recolector del DOM (`scroller.ts`), el selector `a[href*="google.com/maps"]` y `a[href*="/maps/@"]` capturaba el botón de perfil/avatar de la cuenta de Google situado en la cabecera superior derecha (`<a href="https://accounts.google.com/SignOutOptions?...continue=https://www.google.com/maps/@4.2522646,-165.7815511..." aria-label="Cuenta de Google: Santiago Montoya">`), extrayendo las coordenadas del centro de la cámara del mapa (`@lat,lng`) como si fueran un pin del usuario.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Defensa en Profundidad para Ingeniería Inversa de RPCs y Scrapers de DOM en SPAs Complejas**:
> 1. **Gating de Estado Activo en Interceptores:** Un interceptor de red inyectado en el contexto de la página principal jamás debe propagar datos procesados hacia el Service Worker a menos que una bandera explícita (`isExtractionActive === true`) certifique que el usuario ordenó la extracción y está en curso. Al abortar o finalizar, la compuerta se cierra de inmediato.
> 2. **Identificador Canónico Obligatorio en Entidades RPC:** Al recorrer grafos deserializados de Protobuf/JSON en aplicaciones propietarias, **nunca generes entidades sintéticas a partir de coincidencias difusas** (número + string). En Google Maps, toda entidad real de un lugar o pin guardado cuenta indispensablemente con un identificador unívoco: o bien un `Place ID` (`ChIJ...` de más de 20 caracteres) o un `Feature ID Hexadecimal` (`0x...:0x...`). Si un nodo carece de ambos, es metadato interno del motor y debe descartarse (`if (!placeId) return null`).
> 3. **Heurística de Coordenadas Geográficas Plausibles (`isPlausibleGeoCoordinate`)**:
>    - Las coordenadas geográficas reales de pines humanos casi nunca son enteros puros; tienen precisión decimal fraccionaria. Descartar pares donde ambos sean enteros (`Number.isInteger(lat) && Number.isInteger(lng)`) elimina de raíz los enums y ratios de renderizado (`[6, 7]`, `[81, 84]`).
>    - Descartar valores cercanos a Null Island (`Math.abs(lat) < 0.1 && Math.abs(lng) < 0.1`), que corresponden a deltas o márgenes de padding interno.
> 4. **Restricción Quirúrgica de Enlaces en el DOM y Filtrado Léxico**:
>    - Nunca uses comodines genéricos de dominio como `a[href*="google.com/maps"]` o `a[href*="/maps/@"]`. Limita los selectores a enlaces explícitos de entidad: `a[href*="/maps/place/"]`, `a[data-href*="/maps/place/"]` y la clase canónica `a.hfpxzc`.
>    - Las coordenadas de cámara `@lat,lng` sólo son válidas para un lugar si la ruta URL contiene explícitamente `/place/` o un identificador de lugar; si es una URL genérica de mapa, representa únicamente la posición de la cámara del viewport.
>    - Implementa una función de validación de títulos (`isLegitimatePlaceTitle`) que descarte elementos del sistema (`Cuenta de Google:`), nombres de días, rangos de precios, etiquetas de concurrencia y prefijos técnicos (`photos:`, `bizbuilder:`, `psm`).
---

## 14. Heurísticas de Detección Falsa de Contenedores y Distinción entre Vista de Mapa Canvas (WebGL) vs. Vista de Lista (DOM)

### Síntoma / Error
Al presionar "Start Extraction", el log de la extensión reportaba:
```text
[DOM] Contenedor de lista localizado: <div.UL7Qtf> (ScrollHeight: 1003px).
[SCROLL] Ciclo #1: Scroll +504px (Posición: 0px). Lugares: 0.
...
[COMPLETE] Ciclo #6: Final de la lista alcanzado tras 6 ciclos. Extracción finalizada con éxito.
[SUCCESS] Extracción completada. 0 lugares listos para exportar a Excel, GeoJSON, KML o CSV.
```
La extensión informaba falsamente que había localizado un contenedor de lista y que la extracción había finalizado con éxito, pero la exportación contenía 0 lugares y la posición de scroll se mantuvo congelada en `0px`.
La inspección visual reveló que el usuario se encontraba en la **vista del mapa satelital general** (viendo los pines amarillos dispersos por el continente), sin tener abierto ningún panel o lista en el margen izquierdo.

### Causa Raíz
1. **Falso positivo por coincidencia de dimensiones brutas:** La rutina de búsqueda fallback `findPrimaryContainer` buscaba cualquier elemento `<div>` en el 60% izquierdo de la pantalla cuyo `scrollHeight` superase a su `clientHeight` en 80px. El elemento `<div.UL7Qtf>` (un contenedor estructural interno de Google Maps para el lienzo del mapa) cumplía esas dimensiones numéricas, pero era un contenedor estático no desplazable que no contenía tarjetas ni enlaces de lugares.
2. **Diferencia arquitectónica fundamental (WebGL Canvas vs. DOM Tree):**
   - En la vista de mapa general de Google Maps, los pines guardados (estrellas, marcadores, corazones) se dibujan como sprites de textura acelerados por hardware en un lienzo `<canvas>` (WebGL). **No existen nodos HTML (`<a>`, `<div>`, `article`) para los pines en el DOM** hasta que el usuario hace clic o hover sobre un pin individual en el canvas.
   - En cambio, los lugares residen en el DOM estructurado únicamente cuando se abre el panel de la lista correspondiente: **Menú ☰ ➔ Guardados 🔖 ➔ Favoritos / Sitios destacados**. Al abrir la lista, Google Maps monta un feed virtual (`div[role="feed"]`) con tarjetas DOM reales que contienen los enlaces `a.hfpxzc` y los nombres de los comercios.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Validación Semántica Obligatoria de Contenedores y Feedback Preventivo**:
> 1. **Nunca selecciones un contenedor solo por sus dimensiones:** Un elemento del DOM jamás debe catalogarse como lista o feed virtual basándose exclusivamente en `scrollHeight > clientHeight`. Debe verificarse obligatoriamente la presencia de nodos de entidad en su interior (`el.querySelector('a[href*="/place/"], a.hfpxzc, div[role="article"]') !== null`) o la presencia del atributo semántico `role="feed"`. Si no contiene elementos de entidad, `findPrimaryContainer()` debe devolver `null`.
> 2. **Prohibición de "Falsos Éxitos":** Si la extracción termina con 0 lugares, el sistema nunca debe emitir un mensaje de `SUCCESS` ni afirmar que se completó con éxito. Debe disparar una advertencia clara (`EMPTY`) notificándole al usuario que debe abrir su lista de lugares guardados para que los pines existan en el DOM.
> 3. **Guía de Navegación Clara al Usuario:** En aplicaciones complejas con renderizado híbrido (WebGL + DOM), la extensión debe educar al usuario: explicarle claramente que los pines visibles en el mapa gráfico pertenecen a una lista guardada y que debe abrir el panel de esa lista (Guardados 🔖) para que el motor pueda extraer los datos.

---

## 15. Hidratación Accesible por Foco Teclado (`a11y focusin`) como Bypass Determinístico a Eventos Sintéticos `isTrusted: false`

### Síntoma / Error
Al intentar forzar la hidratación perezosa (*lazy hydration*) de URLs dinámicas con coordenadas (`!3d/!4d`) mediante eventos de ratón programáticos (`MouseEvent('mouseover')`, `PointerEvent('pointerenter')`), la SPA del host (Google Maps) ignoraba las llamadas y los enlaces permanecían incompletos.
El usuario reportaba que la extensión *"parecía requerir que hiciera hover físico con la mano sobre el pin para registrarlo"*, lo que impedía una extracción 100% autónoma y desatendida.

### Causa Raíz
1. **La barrera de seguridad `event.isTrusted: false`:**
   En las APIs modernas del DOM de Chromium, todo evento instanciado programáticamente (`new MouseEvent(...)` o `element.dispatchEvent(...)`) lleva indeleblemente la propiedad de solo lectura `event.isTrusted === false`.
2. **Defensas internas contra scraping y clickjacking:**
   Los frameworks de páginas web complejas (Google Closure, Angular, React) implementan guardas internas en sus despachadores de puntero:
   - Validan si `event.isTrusted === true`.
   - Comprueban si las coordenadas de pantalla provienen del hardware del sistema operativo.
   Si detectan un evento artificial de ratón, descartan la ejecución de microtareas de precarga o navegación para protegerse de bots y clics fantasmas.

### Enseñanza Generalizable
> [!IMPORTANT]
> **El Canal de Accesibilidad (W3C/WCAG) como Vector Inmune a las Restricciones de Puntero**:
> 1. **La Obligación Legal y Arquitectónica de Accesibilidad:** Por normativas internacionales de accesibilidad web (WCAG 2.1 y directivas ARIA), ninguna aplicación de producción puede impedir que un usuario navegue y active elementos exclusivamente con el teclado (pulsando `Tab` / `Shift+Tab`) o mediante lectores de pantalla asistivos.
> 2. **Por qué el Foco no puede descartarse:** La navegación por teclado **carece de coordenadas físicas de ratón por definición**. En consecuencia, cuando un enlace recibe foco, los escuchadores de accesibilidad de la aplicación están obligados a preparar e hidratar inmediatamente el destino canónico (`href`), sin poder exigir un puntero de ratón físico.
> 3. **Patrón de Hidratación Autónoma Universal:**
>    Para forzar a una SPA a hidratar datos dinámicos sin depender del cursor humano ni lidiar con las trabas de `isTrusted` en eventos de puntero:
>    ```ts
>    // Localizar el ancla interactiva de la tarjeta
>    const anchor = card.querySelector<HTMLAnchorElement>('a.hfpxzc, a[href*="/place/"]');
>    if (anchor) {
>      anchor.focus(); // Foco nativo del navegador
>      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
>    }
>    ```
>    Este enfoque garantiza que los atributos de destino se pueblen de forma determinística en el DOM, permitiendo una extracción 100% autónoma y manos libres.

---

## 16. Discrepancias Estructurales de DOM entre Feeds de Búsqueda y Listas Personalizadas (Placelists), la Trampa de Altura en Listas Cortas y Desempaquetado Post-Order de Protobuf

### Síntoma / Error
1. El usuario abrió una lista personalizada compartida (**"Mayo24"** con 10 sitios: Neuquén, Dropped pin, Valdivia, Playa Las Conchitas, Iquique, etc.) visible en el panel izquierdo de Google Maps.
2. Al presionar "Start Extraction", el log falló de inmediato con el error:
   ```text
   [DOM] No se detectó ninguna lista abierta. Por favor abre tu lista en Google Maps (ej. Guardados -> Favoritos / Quiero ir) y presiona Iniciar de nuevo.
   [EXTRACTION] No active list panel found in Google Maps. Please open your Saved List (in Google Maps: click Menu ☰ -> Saved / Guardados -> select your list) and try again.
   ```
3. En intentos previos, o bien encontraba erróneamente un contenedor de lienzo de mapa estático (`<div.UL7Qtf>`) y terminaba con 0 lugares, o bien realizaba 6 ciclos de scroll inútiles con posición `0px` sin cosechar nada.

### Causa Raíz
Este fallo se produjo por la intersección de tres desalineaciones arquitectónicas:

1. **Discrepancia Estructural entre Feeds de Búsqueda y Listas Guardadas (Placelists):**
   - En los feeds de resultados de búsqueda (`/maps/search/...`), Google Maps estructura las tarjetas con `div[role="article"]`, `div.Nv2PK`, `a.hfpxzc` y el contenedor con `div[role="feed"]`.
   - En las **Listas Personalizadas y Compartidas (Placelists)**, Google Maps **no utiliza ninguno de esos selectores**:
     - No existe ningún `role="feed"`.
     - Las tarjetas no tienen `role="article"` ni clase `Nv2PK`.
     - Los títulos de los lugares residen en `.fontHeadlineSmall`, `.qBF1Pd`, `span.OSrXXb` o `[role="heading"]`.
     - Los botones interactivos de notas son `button[aria-label*="nota" i]` y `button[aria-label*="note" i]`.
     - Los ítems de lista están contenidos en `div[role="listitem"]`, `div[data-item-id]` o hijos directos de `div.m6QErb`.
   - Al exigir estrictamente los selectores de búsqueda (`a.hfpxzc`, `div.Nv2PK`, `div[role="article"]`), la rutina `findPrimaryContainer` fallaba en 0 segundos a pesar de que la lista estaba visible en pantalla.

2. **La Trampa de Altura en Listas Cortas (The Short List Viewport Trap):**
   - Una lista pequeña (de 5 a 15 elementos, como los 10 de "Mayo24") cabe holgadamente en el panel lateral del navegador (`clientHeight ~ 850px`, `scrollHeight ~ 850px`).
   - Requerir numéricamente que `scrollHeight > clientHeight + 80` provocaba que las listas cortas completas fueran descartadas por "no tener scroll", cuando en realidad eran exactamente el contenedor deseado.

3. **Pérdida de Carga Útil RPC por Descarte Temporal y Desempaquetado Superficial de Protobuf:**
   - Cuando el usuario navegaba a la lista antes de abrir la extensión o de hacer clic en "Iniciar", Google Maps solicitaba el listado vía RPC Batchexecute. Al no estar activa la extracción en ese microsegundo exacto, el content script descartaba el payload.
   - Además, en la carga deserializada de Protobuf para listas, la entidad del lugar está profundamente anidada:
     ```json
     ["0x960a...:0x...", ["Neuquén", "Neuquén, Neuquén Province"], null, null, null, [[null, null, -38.9516, -68.0591]], "ChIJ..."]
     ```
     El título reside dentro de un sub-array en el índice 1, y las coordenadas residen dentro de una matriz geométrica `[[null, null, lat, lng]]`. Un escáner superficial que sólo busca números o strings directos en el primer nivel del array ignoraba tanto el título como las coordenadas, devolviendo 0 lugares.
   - Finalmente, lugares como marcadores huérfanos (**"Dropped pin"** / **"Marcador"**) no poseen un `ChIJ...` Place ID canónico. Exigir obligatoriamente un Place ID descartaba todos los pines libres del usuario.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Arquitectura Resiliente para Scrapers de Listas en SPAs**:
> 1. **Mapeo Polimórfico de Esquemas de DOM:**
>    Nunca asumas un único esquema de DOM para distintas vistas de una misma SPA. Define una batería polimórfica de selectores de entidad (`.fontHeadlineSmall`, `.qBF1Pd`, `div[role="listitem"]`, `button[aria-label*="nota" i]`, `a.hfpxzc`, `div[role="article"]`). Para localizar el panel, localiza primero una entidad visible y asciende por sus ancestros en el viewport izquierdo (`rect.left < window.innerWidth * 0.65`), aceptando contenedores tanto con scroll activo como con contenido visible que encaje (`clientHeight > 200px`).
> 2. **Caché en Memoria de Cargas Útiles de Red (Network Pre-Harvesting):**
>    Todo interceptor de red inyectado debe almacenar en una caché persistente (`preHarvestedRpcPlaces`) todas las entidades de lugares autenticadas recibidas en llamadas Batchexecute, independientemente de si la extracción se inició formalmente o no. Cuando el usuario presiona "Iniciar", el motor carga de inmediato los lugares ya recibidos en la sesión activa (`[CACHE] Cargados N lugares`).
> 3. **Desempaquetado Post-Order en Grafos Protobuf:**
>    Para procesar estructuras anidadas donde los contenedores de listas envuelven elementos de lugares:
>    - Recorre los hijos primero (post-order) para que las entidades más específicas se extraigan antes que sus contenedores padre.
>    - Acota la recolección de cadenas al nodo inmediato y su sub-array directo (`depth <= 2`) para evitar que el contenedor de la lista absorba los IDs de los lugares hijos.
>    - Admite marcadores huérfanos reconocidos por semántica (`Dropped pin`, `Marcador`) asignándoles identificadores sintéticos determinísticos basados en sus coordenadas.
> 4. **Detección Inmediata de Listas Cortas:**
>    Si el contenedor de la lista no tiene desbordamiento vertical (`scrollHeight <= clientHeight + 40`) y ya contiene lugares cosechados, el ciclo debe finalizar de inmediato (`COMPLETE`), evitando ciclos de scroll vacíos e innecesarios.

---

## 17. Detección y Navegación Autónoma entre el Directorio de Guardados (Hub de Listas) y las Listas Individuales en Google Maps

### Síntoma / Error
Al presionar "Start Extraction" teniendo abierta la pestaña "Listas" del panel "Guardados" (`data=!4m2!10m1!1e1`), la extensión reportaba:
```text
[DOM] Contenedor de lista localizado: <div.m6QErb.WNBkOb> (ScrollHeight: 711px).
[SCROLL] Ciclo #1: Scroll +495px (Posición: 0px). Lugares: 0.
...
[COMPLETE] Ciclo #6: Final de la lista alcanzado tras 6 ciclos. Extracción finalizada con éxito.
[EMPTY] Extracción finalizada sin lugares. Por favor abre tu lista (ej. Guardados -> Favoritos / Sitios destacados) en Google Maps para que la lista sea visible y vuelve a intentar.
[EXTRACTION] No se detectaron lugares en la vista actual. Por favor abre tu lista de lugares guardados en Google Maps (ej. Menú ☰ -> Guardados 🔖 -> selecciona tu lista).
```
A pesar de que el usuario tenía en pantalla sus listas visibles ("Mayo24" con 10 sitios, "Pacific Islands" con 1 sitio), la extensión no extraía ningún lugar y le exigía al usuario que interactuara manualmente con Google Maps abriendo la lista.

### Causa Raíz
1. **Confusión Arquitectónica entre Directorio de Carpetas (Hub de Listas) vs. Feed de Lugares (Placelist):**
   - En Google Maps, el panel principal de Guardados (`data=!4m2!10m1!1e1`) es un **Directorio de Listas**: sus tarjetas representan carpetas o listas ("Favoritos", "Mayo24", "Pacific Islands"), no lugares geográficos individuales.
   - El contenedor del directorio utiliza exactamente las mismas clases CSS de utilidad (`<div.m6QErb.WNBkOb>`) que las vistas de lugares.
   - El detector heurístico tomaba el contenedor del directorio de listas como si fuera una lista de lugares, lo recorría haciendo scroll, no encontraba enlaces con coordenadas (porque los lugares están adentro de cada lista) y concluía que la lista estaba vacía.
2. **Sutilezas Lingüísticas en Conteos de Listas (Singular vs. Plural):**
   - Las tarjetas del directorio muestran el conteo de elementos: `"10 sitios"` o `"0 sitios"` (plural), pero si una lista tiene exactamente un lugar, Google Maps muestra `"1 sitio"` (singular), o en inglés `"1 place"`.
   - Expresiones regulares que buscan únicamente plural (`sitios|places|lugares`) omiten silenciosamente cualquier lista de 1 solo sitio.
3. **Peligro de Clic en el Botón Secundario de Opciones (Menú de Tres Puntos):**
   - Cada tarjeta de lista en el directorio contiene un botón de menú de tres puntos verticales (`⋮`) para compartir o editar la lista.
   - Si un script despacha un evento de clic genérico al primer botón interactivo de la tarjeta (`div[role="button"]`), activa el menú emergente de opciones en lugar de abrir y navegar hacia el contenido de la lista.
4. **Nodos Desconectados (Detached DOM Nodes) tras Navegación SPA:**
   - Cuando la extensión entra programáticamente a una lista y luego pulsa el botón "Atrás" para regresar al directorio, Google Maps desmonta y reconstruye los nodos HTML del directorio.
   - Cualquier referencia a elementos DOM almacenada antes de la navegación queda descolgada del árbol principal (`document.body.contains(el) === false`), provocando que clics posteriores no tengan ningún efecto.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Jerarquía de Vistas y Orquestación Multi-Lista Desatendida en Extensiones**:
> 1. **Detección Formal del Nivel Jerárquico (Hub vs. Leaf Feed):**
>    Toda extensión de extracción debe identificar inequívocamente en qué nivel de la taxonomía del sitio se encuentra:
>    - **Vista Hub de Listas:** Presencia del botón `+ Nueva lista` / `New list`, URL con `10m1!1e1`, ausencia de botones específicos de lugar como `+ Añadir un sitio` o `+ Nota`.
>    - **Vista de Lista Individual:** Presencia de `+ Añadir un sitio` / `Add a place`, botones `+ Nota`, y encabezado con el título específico de la lista.
> 2. **Extracción Multi-Lista Autónoma sin Intervención Humana:**
>    Si el usuario inicia la extracción mientras está en el Hub de Listas, la extensión jamás debe arrojar un error ni pedirle que haga clics manuales. Debe:
>    - Escanear todas las listas del usuario y filtrar aquellas con elementos (`itemCount > 0`).
>    - Abrir programáticamente cada lista con contenido.
>    - Esperar el montaje del contenedor de lugares y cosechar sus entidades (combinando la captura RPC con el escaneo de DOM).
>    - Regresar automáticamente al directorio con el botón "Atrás", verificar que el hub se remontó y continuar con la siguiente lista.
>    - Consolidar todos los lugares cosechados en una sola exportación unificada.
> 3. **Segmentación y Aislamiento de Objetivos de Clic:**
>    Al automatizar clics en tarjetas de interfaz compuestas, descarta terminantemente cualquier elemento con `aria-haspopup="true"`, `aria-haspopup="menu"` o selectores de menú contextual (`más acciones`, `more options`). Dirige el puntero al elemento hoja del título (`titleEl`) o al enlace de navegación principal.
> 4. **Re-resolución Dinámica contra el DOM Activo:**
>    En aplicaciones web SPA de ciclo de vida reactivo, nunca reutilices referencias a nodos HTML entre transiciones de pantalla. En cada iteración, re-escanea el DOM vivo para obtener referencias a nodos frescos y conectados.

---

## 18. La Trampa de Pines Huérfanos con Coordenadas Crudas, Falso Parseo de Calificaciones [4.6, 126] y Virtualización en Listas Masivas (200+ Lugares)

### Síntoma / Error
En listas grandes (como **"Sitios destacados"** con *"Más de 200 sitios"*):
1. **Pérdida masiva de registros en listas largas (Solo 42 de 200+ extraídos):**
   Si el usuario iniciaba la extracción habiendo hecho scroll hacia abajo previamente (posición `18581px`), el proceso se detenía tras 6 ciclos extrayendo exactamente 42 lugares.
2. **Falso error de "No se detectaron lugares" al subir al inicio:**
   Si el usuario subía manualmente al inicio de la lista (`0px`) y relanzaba la extracción, la extensión mostraba inmediatamente el cartel rojo:
   ```text
   [EXTRACTION] No se detectaron lugares en la vista actual. Por favor abre tu lista de lugares guardados en Google Maps...
   ```
3. **Coordenadas erróneas en comercios (Comercios en medio del océano):**
   En el archivo Excel exportado, negocios legítimos de Buenos Aires o Mozambique aparecían con coordenadas como `Latitude: 4.6, Longitude: 126` o `Latitude: 4.3, Longitude: 118` (situándolos en el Océano Pacífico).

### Causa Raíz
1. **Pines Huérfanos con Títulos de Coordenadas Puras:**
   - Cuando un usuario guarda una chincheta en un punto geográfico sin nombre comercial ni entidad de Google (ej. en el desierto de Turkmenistán cerca del cráter de gas de Darvaza, en Afganistán, o en el océano), Google Maps titula la entidad con las coordenadas crudas entre paréntesis: `(-36.495170, -56.691744)`, `(40.252596, 58.439703)`, etc.
   - El validador `isLegitimatePlaceTitle` contenía la regla: `if (!/[a-zA-Z]/.test(t)) return false`. Al exigir letras alfabéticas obligatorias, descartaba todos los títulos que fuesen únicamente números, paréntesis y signos negativos.
   - Al estar ubicados los primeros 6 elementos de la lista con este formato, el scraper concluía que no había ningún lugar legítimo en la vista y abortaba con error.
   - Asimismo, el extractor RPC exigía que un elemento sin Place ID tuviera en su título palabras como `"pin"` o `"marcador"`, descartando también estos registros a nivel de red.
2. **Tuplas de Calificación y Conteo de Reseñas tomadas como Coordenadas:**
   - En la carga Protobuf deserializada de Google Maps, los metadatos de valoración de un comercio se representan como `[rating, reviewCount]`, por ejemplo `[4.6, 126]` (4.6 estrellas, 126 reseñas).
   - Como 4.6 está entre -90 y 90, 126 está entre -180 y 180, y 4.6 tiene decimales, la función de coordenadas lo aceptaba como un punto geográfico válido antes de inspeccionar el sub-array geométrico real `[null, null, lat, lng]`.
3. **El Reciclador Virtual (DOM Virtualization) y el Aborto Prematuro de Scroll:**
   - En listas con más de 200 lugares, Google Maps no mantiene 200 nodos en el DOM. Utiliza un *virtual recycler* que sólo monta ~20 tarjetas a la vez y desmonta las anteriores.
   - Si la extracción comenzaba con la barra de scroll desplazada, los elementos anteriores ya estaban desmontados.
   - Además, al llegar al final del bloque actual de 20 elementos, Google Maps tarda entre 1 y 2 segundos en solicitar el siguiente bloque por red y expandir la altura desplazable (`scrollHeight`). El límite de 6 ciclos rápidos (2.7 segundos) abortaba antes de que Google Maps alcanzara a inyectar el nuevo bloque.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Extracción Resiliente de Listas Masivas y Datos no Convencionales en SPAs**:
> 1. **Coordenadas Crudas como Títulos Válidos de Entidad:**
>    Los marcadores creados por el usuario en zonas remotas llevan coordenadas como nombre (`(-36.495170, -56.691744)` o `40°15'09.4"N 58°26'22.9"E`). Todo validador léxico debe permitir explícitamente patrones de coordenadas como títulos válidos y extraer sus valores numéricos directamente del texto.
> 2. **Inmunidad Estricta ante Tuplas de Calificación (`[rating, reviews]`):**
>    Toda función de plausibilidad geográfica debe rechazar pares numéricos donde un valor esté en el rango de calificación `[1.0, 5.0]` y el otro sea un número entero `>= 1` representativo de cantidad de opiniones. Asimismo, el buscador de coordenadas en árboles Protobuf debe priorizar sub-arrays dedicados de 2 o 4 elementos (`[lat, lng]`, `[null, null, lat, lng]`) sobre arrays contenedores generales.
> 3. **Rebobinado Obligatorio al Origen (`scrollTop = 0`):**
>    Al iniciar un proceso de cosecha en feeds con reciclador virtual, la extensión debe restablecer incondicionalmente `container.scrollTop = 0` para comenzar desde el primer registro y acumular de forma continua cada lote en memoria a medida que avanza.
> 4. **Detección de Expansión Dinámica de Altura (`scrollHeight`):**
>    En listas infinitas que cargan datos por lotes bajo demanda:
>    - Monitorea activamente los aumentos en `scrollHeight`. Si la altura total crece, significa que la SPA acaba de inyectar nuevos registros: reinicia inmediatamente el contador de estancamiento.
>    - Diferencia entre "estar a mitad de lista sin nuevos elementos visibles" y "estar al fondo físico del scroll". Nunca abortes por inactividad a menos que el scroll esté verdaderamente en el límite inferior (`scrollTop + clientHeight >= scrollHeight - 60`) y tras haber ejecutado rebotes de micro-scroll para reactivar las peticiones de red.

---

## 19. Compuerta de Término Temprano por Conteo de Cabecera, Navegación Autónoma Inter-Listas y Desempaquetado de Placelists Personalizadas sin ChIJ

### Síntoma / Error
1. **Cero lugares extraídos en listas personalizadas cortas (ej. "Mayo24" con 10 sitios):**
   Al ingresar a la lista compartida `Mayo24` (10 sitios visibles en pantalla y en el mapa), la extensión ejecutaba 6 scrolls rápidos y terminaba con error: `Extracción finalizada sin lugares`.
2. **Ciclos de recuperación innecesarios al llegar al final de la lista:**
   Cuando la extensión extraía todos los lugares de una lista (ej. 10 de 10), continuaba intentando scroll y ejecutaba micro-scrolls de recuperación (`[RECOVERY] Extremo visible alcanzado...`) hasta agotar los ciclos de estancamiento.
3. **Falta de visibilidad del progreso respecto al total esperado:**
   El usuario no sabía cuántos lugares le faltaban por cosechar ni si la lista ya estaba completa o si faltaban elementos por cargar.
4. **Dilema de operación manual vs. autónoma entre múltiples listas:**
   El usuario consultó si debía ingresar manualmente a cada lista una por una o si la extensión podía recorrer todas sus listas automáticamente en un solo paso.

### Causa Raíz
1. **La Trampa de los IDs en Listas Personalizadas (Placelists de Google Maps):**
   - En las listas creadas o compartidas por usuarios (`Placelists`), Google Maps renderiza las tarjetas en el DOM como bloques `div` sin hipervínculos `<a href="/maps/place/...">`.
   - En la carga de red Batchexecute que entrega los elementos de la lista, Google Maps no adjunta identificadores estándar `ChIJ...` ni claves hexadecimales `0x...:0x...` en el subárbol inmediato de cada lugar; transporta identificadores de elemento de lista en Base64 (ej. `CAESY0FvQXR...`).
   - El extractor RPC contenía la regla: `if (!effectiveId && !isDroppedPin) return null`. Dado que lugares legítimos como `"Tarapacá"` u `"Observatorio La Silla"` no contienen la palabra `"pin"` ni `"marcador"` en su título, y carecían de `ChIJ...`, el unpacker devolvía `null` para **todos y cada uno** de los lugares de la lista, descartándolos por completo.
2. **Desconexión Temporal del Estado Inicial (`APP_INITIALIZATION_STATE`):**
   - Cuando el usuario navegaba a una lista dentro de la SPA antes de abrir la extensión, los datos ya estaban cargados en la memoria del navegador.
   - El script de contenido solo consultaba los lugares interceptados pasivamente y no solicitaba la re-inspección activa del estado de la ventana al iniciar el flujo de extracción.
3. **Falta de Detección del Conteo Declarado en la Cabecera:**
   - La cabecera de toda lista en Google Maps declara explícitamente la cantidad total de lugares: `"Santiago Montoya · Compartida · 10 sitios"`, `"Lista privada · Más de 200 sitios"`, etc.
   - Al no leer esta cifra, el motor de scroll no sabía cuándo había completado la lista y recurría a bucles de estancamiento para decidir cuándo detenerse.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Arquitectura de Extracción Inteligente por Conteo y Recorrido Autónomo**:
> 1. **Compuerta de Término Temprano (Early Completion Gate):**
>    - Extrae el conteo esperado (`expectedCount`) directamente de los subtítulos de la cabecera mediante expresiones regulares multi-idioma (`/\b(?:más de\s+)?(\d+)\s*(?:sitios?|places?|lugares?)\b/i`).
>    - Informa el progreso en vivo (`X/Total`) en la consola en cada ciclo.
>    - Si `harvestedMap.size >= expectedCount` (y no es aproximado), rompe inmediatamente el bucle de scroll (`break`). Esto elimina al 100% las esperas de estancamiento y los micro-scrolls innecesarios al llegar al final.
> 2. **Sintetización Determinista de IDs para Listas Personalizadas:**
>    - Si un elemento en la respuesta RPC posee coordenadas geográficas plausibles (`isPlausibleGeoCoordinate`) y un nombre comercial o toponímico válido (`isLegitimatePlaceTitle`), y no representa un contenedor de lista (descartando aquellos con textos como `"10 sitios"` o múltiples hijos con coordenadas), debe aceptarse de inmediato.
>    - Si carece de identificador `ChIJ`, asígnale un identificador sintético determinista basado en su nombre y coordenadas (`generateSyntheticPlaceId(title, lat, lng)`).
> 3. **Recorrido Autónomo Multi-Lista (Autonomous Multi-List Crawling):**
>    - Si el usuario inicia la extracción en el **Directorio Hub** (`data=!4m2!10m1!1e1`), la extensión escanea todas las listas del usuario (`itemCount > 0`), ingresa a cada una programáticamente, cosecha sus lugares asignándoles el atributo `listTitle`, vuelve con el botón "Atrás" y avanza a la siguiente.
>    - Todos los lugares se consolidan en una sola exportación con la columna `List Name` / `Lista` para que el usuario obtenga todos sus datos de una sola vez.
>    - Si el usuario inicia la extracción dentro de una lista particular, se procesa exclusivamente esa lista de forma rápida y directa.
> 4. **Hidratación Activa On-Demand (`queryInitialState`):**
>    - Al pulsar "Start Extraction", despacha inmediatamente un mensaje al hilo principal (`QUERY_INITIAL_STATE`) para desempaquetar variables globales (`APP_INITIALIZATION_STATE`, `_pageData`, `<script>` embebidos) antes del primer ciclo de scroll, garantizando que listas ya abiertas en pantalla se hidraten al instante en la memoria de la extensión.

---

## 20. Fusión Espacial por Coordenadas, Aislamiento de Caché Inter-Listas, Filtrado de Artefactos Protobuf/Pegman y Desbloqueo de Feeds Virtuales Profundos

### Síntoma / Error
1. **Registros Duplicados y Títulos Redundantes en Exportaciones:**
   Lugares idénticos aparecían dos veces en el Excel (ej. una fila con `"Neuquén"` y otra con `"Neuquén, Neuquén Province"`), compartiendo exactamente las mismas coordenadas geográficas pero con IDs sintéticos distintos.
2. **Artefactos Espurios y Metadatos Internos de Google Maps:**
   Aparición ocasional de filas con fechas ISO como título (`2015-02-08T08:00:00.000Z`), skins de Street View (`/tactile/pegman_v3/merman/`), o tokens de lista en Base64 (`dtwiDbA3kCGXN9zXNogHTRiK3nccSw`).
3. **Fuga de Caché Acumulativa entre Listas (Cross-List Cache Leakage):**
   Al extraer sucesivamente múltiples listas (Lista 1, luego Lista 2, luego Lista 3), la Lista 2 heredaba los 30 lugares de la Lista 1 (generando 46 registros), y la Lista 3 acumulaba los lugares de las dos anteriores.
4. **Techo de Extracción de ~66 Elementos en Listas de 200+ Lugares:**
   En listas masivas ("Sitios destacados" con más de 200 sitios declarados), la extensión realizaba scrolls pero se detenía tempranamente tras 6 ciclos, cosechando únicamente 66 lugares en total.

### Causa Raíz
1. **La Condición de "Múltiples Coordenadas" que Rechazaba Lugares Reales en RPC:**
   - En el deserializador RPC, existía la regla preventiva `if (directChildWithCoordsCount > 1) return null;` para evitar interpretar contenedores de múltiples lugares como un solo punto.
   - Sin embargo, en Google Maps las entidades geográficas completas (ciudades, atracciones, comercios) transportan no solo el pin puntual (`[null, null, lat, lng]`), sino también el rectángulo envolvente de la cámara (`[[sw_lat, sw_lng], [ne_lat, ne_lng]]`) y las coordenadas de la cámara de Street View.
   - Como resultado, el deserializador rechazaba a **todas las entidades reales con geometría completa** (`Lilongüe`, `Isla de Pascua`, etc.) y solo admitía marcadores manuales huérfanos (`dropped pins`).
2. **Aborto Prematuro al Tocar Fondo en Listas Asíncronas:**
   - La condición de salida del scroller evaluaba `if (stagnationCycles >= MAX_STAGNATION_LIMIT || (isAtBottom && this.harvestedMap.size > 0)) break;`.
   - Cuando el scroll llegaba al final del bloque visible actual (los primeros ~20 ítems montados en el DOM), `isAtBottom` se volvía verdadero y `harvestedMap.size > 0` también lo era. Si Google Maps demoraba más de 800 ms en solicitar por red y pintar el siguiente tramo, la extensión abortaba inmediatamente en el ciclo 2 sin darle tiempo a la SPA de cargar los 200 elementos.
3. **Persistencia Indiscriminada vs. Vaciado Prematuro de Caché RPC:**
   - Al no asociar los lugares pre-cosechados con un identificador de lista, las peticiones interceptadas en listas anteriores permanecían indefinidamente en memoria.
   - Por el contrario, vaciar la caché incondicionalmente al pulsar "Start" borraba los datos que Google Maps acababa de cargar por red segundos antes al abrir la lista en pantalla.
4. **Discrepancia de Nombres en la Misma Posición Geográfica:**
   - El payload RPC contiene tanto el nombre corto de la entidad como el nombre calificado con provincia/país. Al generar IDs sintéticos a partir de `title + lat + lng`, se creaban dos registros independientes para un único sitio geográfico físico.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Arquitectura de Fusión Espacial, Aislamiento de Estado y Recolección Profunda en SPAs Complejas**:
> 1. **Deduplicación Espacial con Fusión Atómica (Spatial Merging & Deduplication):**
>    - Indexa los lugares en memoria utilizando una clave espacial de 5 decimales (`lat.toFixed(5),lng.toFixed(5)` ~1.1 metros de resolución).
>    - Si ingresa un nuevo registro cuyas coordenadas coinciden con uno ya existente:
>      - Conserva el nombre más limpio y conciso como título (ej. prefiere `"Neuquén"` sobre `"Neuquén, Neuquén Province"` si el segundo contiene comas y el primero no).
>      - Traslada la cadena más detallada al campo `address`.
>      - Conserva y combina notas de usuario (`userNote`), Place IDs y estados operativos sin duplicar la fila.
> 2. **Filtro de Artefactos Protobuf, Fechas ISO y Pegman:**
>    - Bloquea explícitamente en el validador léxico (`isLegitimatePlaceTitle`):
>      - Tokens alfanuméricos continuos en Base64/Protobuf de 20 a 60 caracteres (`/^[a-zA-Z0-9_-]{20,60}$/`).
>      - Marcas de tiempo ISO (`/^\d{4}-\d{2}-\d{2}(?:T[\d:\.]+Z?)?$/`).
>      - Rutas de skins o recursos de Street View (`/tactile/`, `pegman`).
>      - Prefijos internos de URL de Google Maps (`CAES`, `CAIS`, `CAEQ`, `!\d+[a-z]\d+!`).
> 3. **Aislamiento de Caché por Huella Digital de Lista (Active List Fingerprint):**
>    - Calcula la huella única de la lista activa combinando el token de URL (`!2s[token]`) y el título del encabezado (`h1`).
>    - Solo purga la caché de pre-cosecha RPC (`preHarvestedRpcPlaces.clear()`) cuando la huella cambia (cambio de lista detectado vía `popstate`, `hashchange` o polling de 1s).
>    - Esto garantiza que los RPCs interceptados al abrir la lista se preserven intactos al iniciar la extracción, eliminando a la vez cualquier fuga de listas previas.
> 4. **Paciencia Dinámica en Feeds Virtuales Profundos (200+ ítems):**
>    - En listas con conteo esperado alto o aproximado (`más de 200 sitios`), amplía el margen de estancamiento (hasta 10 ciclos) y nunca abortes simplemente por `isAtBottom && size > 0`.
>    - Ejecuta micro-rebotes de scroll (subir 350px, esperar 500ms, bajar 450px con eventos `wheel`, esperar 1000ms) para garantizar que los observadores de intersección y listeners de rueda de Google Maps disparen las peticiones de red para los siguientes bloques.

---

## 21. La Falacia del Límite de Strings, Extracción de Metadatos de Fotos como Lugares Falsos y Eliminación de Coordenadas Fantasma con Latitud Entera

### Síntoma / Error
1. **Extracción de Títulos Tecnológicos y Metadatos de Fotos en vez de los Nombres de Lugares:**
   En listas con lugares ricos (ciudades, comercios, atractivos), la exportación generaba filas tituladas `UGCS_REFERENCE`, `gcid:locality`, `797 fotos`, `launch`, `Street View`, `bizbuilder`, mientras que lugares reales como `"Lilongüe"`, `"Isla de Pascua"`, `"Rikitea"`, `"Adamstown"`, `"Guilin"`, `"São Luís"` no aparecían en el Excel.
2. **Coordenadas Fantasma con Latitud Entera (`lat: 3.000000`):**
   Múltiples filas exportadas compartían una latitud fija de `3.000000` combinada con una longitud real (ej. `3.000000, -58.438601`), ubicando comercios de Buenos Aires en medio del Océano Atlántico o la selva de Guyana.
3. **Omisión de Lugares con Nombre y Supervivencia Exclusiva de Marcadores Huérfanos:**
   En una lista de más de 200 sitios, la extensión sólo cosechaba 33 marcadores sueltos (`(-34.591749, -58.444644)`) y los 30 artefactos de fotos, descartando los más de 140 lugares nombrados.

### Causa Raíz
1. **El Filtro Destructivo `strings.length > 12`:**
   - Para evitar procesar arrays de colecciones, el extractor RPC imponía `if (strings.length > 12) return null`.
   - Sin embargo, una entidad de lugar completa en Google Maps transporta títulos, direcciones, categorías, URLs de fotos, reseñas, horarios y atribuciones, acumulando fácilmente entre 15 y 45 strings en su subárbol.
   - Como resultado, el extractor **descartaba al 100% de las entidades reales de lugares**. Únicamente los dropped pins sueltos (que carecen de fotos y reseñas) tenían menos de 12 strings y lograban sobrevivir.
2. **Travesía hacia Sub-arrays de Fotos:**
   - Al descartar el nodo padre del lugar real, el recorrido recursivo descendía a sus sub-arrays internos.
   - El sub-array de metadatos de fotos contenía sólo 4 strings: `['UGCS_REFERENCE', '797 fotos', 'Foto', 'https://...']`. Como 4 $\le$ 12, el extractor creía que era un lugar y tomaba `'UGCS_REFERENCE'` o `'797 fotos'` como el título.
3. **Emparejamiento de Índices Numéricos Protobuf (`[3, lng]`):**
   - El buscador de coordenadas contenía un fallback que escaneaba números adyacentes en cualquier array.
   - En los sub-arrays de fotos, Google Maps almacena `[3, -58.438601]`, donde `3` es un enum de tipo de imagen.
   - Como `3` cae entre -90 y 90, la validación lo aceptaba como latitud porque sólo rechazaba pares donde *ambos* números fueran enteros.
4. **Falta de Reconocimiento de Listas vs. Lugares por Distancia Geográfica:**
   - La distinción entre un array contenedor de lista y un lugar individual debe basarse en la presencia de múltiples hijos con coordenadas geográficas distantes ($> 0.05^\circ$, $> 5$ km), no en un conteo arbitrario de strings.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Extracción Robusta de Entidades Complejas con Medios Enriquecidos en Protobuf**:
> 1. **Prohibición Total de Coordenadas con Latitud/Longitud Entera en Grados Decimales:**
>    - En Google Maps, las coordenadas de pines reales siempre poseen múltiples dígitos decimales (resolución submétrica).
>    - Todo número entero exacto (1, 2, 3, etc.) en un array Protobuf representa un enum, índice de tipo, o conteo.
>    - Si `Number.isInteger(lat) || Number.isInteger(lng)`, el par numérico debe ser rechazado inmediatamente (`isPlausibleGeoCoordinate`). Esto erradica al 100% las coordenadas fantasma como `3.000000`.
> 2. **Eliminación de Límites Artificiales de Longitud de Cadenas (`strings.length`):**
>    - Las entidades de lugares con fotos y opiniones son ricas en texto. Nunca filtres entidades por tener más de 12 strings.
>    - Para diferenciar una colección de listas de un lugar individual, comprueba si el array contiene dos o más hijos con coordenadas geográficas distantes ($> 5$ km entre sí).
> 3. **Filtrado Léxico Infranqueable de Descriptores de Medios:**
>    - Rechaza categóricamente como título cualquier string que sea o comience por: `UGCS_`, `gcid:`, `GEO_PHOTO`, `IMAGE_ALLEYCAT`, `Street View`, `launch`, `bizbuilder`, `foto`, `fotos`, `photo`, `photos` o conteos `\d+\s*fotos?`.
> 4. **Aislamiento de Notas de Usuario de Tokens Serializados:**
>    - Todo valor asignado a `userNote` debe ser texto en lenguaje natural. Descarta strings que contengan `||`, URLs, o hashes alfanuméricos continuos sin espacios de más de 15 caracteres.

---

## 22. Bounding Boxes como Colecciones Falsas, Fuga de Tokens Fotográficos de 11 Caracteres y Detección de Listas del Sistema en el Hub

### Síntoma / Error
1. **Omisión de Lugares con Nombre Propio en Listas Masivas ("Sitios destacados"):**
   Al extraer listas extensas (>200 elementos), la extensión únicamente capturaba 33 a 39 registros, compuestos casi exclusivamente por marcadores huérfanos con coordenadas crudas como `(-34.591749, -58.444644)` o nombres genéricos. Entidades geográficas reconocidas (ciudades, islas, comunas como *"Lilongüe"*, *"Isla de Pascua"*, *"Cartago"*, *"Rikitea"*) eran completamente omitidas del resultado.
2. **Fuga de Tokens Fotográficos Base64 como Títulos de Lugares:**
   En ciertos registros aparecían títulos ininteligibles como `5XdUApWbscM`, `p_Bc38opygI` o `yfDguqJglQs` en lugar del nombre real de la ubicación.
3. **Falla de Reconocimiento Autónomo de Listas del Sistema en el Hub de Guardados:**
   Al presionar "Extraer Todas las Listas" o "Iniciar" desde el menú general, el crawler del Hub no detectaba automáticamente la lista "Sitios destacados", requiriendo que el usuario hiciera clic manual en la lista dentro de Google Maps.
4. **Discrepancia Crítica entre el Log de Auditoría y el Archivo Exportado (.xlsx):**
   El log de la extensión reportaba haber cosechado 33 o 39 lugares, pero al presionar el botón de exportación a Excel, el archivo descargado contenía únicamente 5 filas.

### Causa Raíz
1. **La Trampa del Bounding Box Geográfico (`dLat > 0.05`):**
   - En las respuestas RPC Protobuf de Google Maps, toda entidad geográfica de área (ciudades, provincias, islas, reservas naturales) incluye tanto su coordenada central de marcador `[null, null, lat, lng]` como su caja delimitadora de visualización (viewport bounding box) `[[sw_lat, sw_lng], [ne_lat, ne_lng]]`.
   - Para evitar tratar un array de múltiples lugares como un lugar individual, el extractor RPC comprobaba la dispersión de coordenadas en el array y descartaba cualquier nodo donde `dLat > 0.05` (~5.5 km).
   - Dado que una ciudad, isla o territorio abarca de $0.1^\circ$ a $20^\circ$ (10 a 2,200 km), **el filtro descartaba sistemáticamente el 100% de las entidades geográficas nombradas**, permitiendo únicamente la supervivencia de pines huérfanos sin polígono de visualización.
2. **Brecha de Longitud en el Filtro de Tokens Base64:**
   - Los identificadores internos de recursos multimedia y fotos de Google consisten en hashes Base64 URL-safe de 11 caracteres (ej. `5XdUApWbscM`, `p_Bc38opygI`).
   - La heurística léxica anterior solo descartaba cadenas continuas de longitud $\ge 20$, permitiendo que estos identificadores de fotos eludieran la validación y fueran adoptados como títulos de lugares.
3. **Nodos `<button>` y Parámetros URL No Convencionales en Listas Nativas:**
   - En el Hub de Guardados (`/maps/@.../data=!3m1!1e3!4m2!10m1!1e1`), las listas del sistema (*Sitios destacados*, *Favoritos*, *Quiero ir*) se renderizan frecuentemente como elementos `<button>` nativos o bloques con etiquetas tipo `"Más de 200 sitios"` y parámetros como `11m1!3e4`, en lugar de enlaces convencionales `<a href="...placelist...">`.
   - El escáner del Hub buscaba exclusivamente `div[role="button"]` y `a[href*="placelist"]`, ignorando los `<button>` del sistema.
4. **Desconexión entre el Cierre de Cosecha y el Estado en Memoria del Background Worker:**
   - Al dispararse `EXTRACTION_COMPLETED`, los lugares recolectados eran devueltos en el payload final hacia el content script, pero el Background `port-manager.ts` no los inyectaba en `StateManager.appendHarvestedPlaces()`. Si el usuario descargaba el archivo mientras el primer ciclo solo había acumulado 5 lugares en memoria, la exportación se generaba con esa instantánea desactualizada.

### Enseñanza Generalizable
> [!IMPORTANT]
> **Extracción de Entidades Geográficas Jerárquicas y Sincronización Fiel de Estado**:
> 1. **Detección Estructural vs. Métrica de Colecciones:**
>    - Nunca asumas que un objeto o array es una lista o colección basándote únicamente en la distancia o dispersión entre sus coordenadas internas (`dLat > 0.05`). Las entidades geográficas individuales (ciudades, parques, archipiélagos) tienen extensiones espaciales inmensas.
>    - Para determinar si un array es una colección de lugares independientes, evalúa su estructura: comprueba si contiene 2 o más nodos hijos que posean cada uno un título de lugar autónomo y legítimo.
> 2. **Prioridad Canónica del Marcador de Google Maps:**
>    - En los arrays Protobuf de Google Maps, el marcador de ubicación puntual sigue el patrón canónico `[null, null, lat, lng]`. Este patrón debe tener prioridad absoluta al extraer coordenadas, evitando que los vértices suroeste/noreste del viewport bounding box secuestren la posición del pin.
> 3. **Filtrado Léxico por Entropía Base64 para Identificadores Opacos:**
>    - Los hashes de recursos (fotos, thumbnails) suelen tener entre 8 y 60 caracteres y exhiben patrones de Base64 (mezcla de mayúsculas, minúsculas, números y guiones/subrayados sin espacios).
>    - Todo token mono-palabra que contenga dígitos y letras mezcladas sin puntuación gramatical ni palabras en diccionario debe ser descalificado como título de lugar.
> 4. **Garantía Atómica de Persistencia en el Cierre de Extracción:**
>    - En arquitecturas distribuidas de extensiones de navegador (Content Script $\leftrightarrow$ Background Service Worker $\leftrightarrow$ Side Panel), el evento de finalización (`EXTRACTION_COMPLETED`) debe sincronizar atómicamente la lista final completa en el almacén de estado central (`StateManager`) y notificar inmediatamente a la UI con `ITEMS_HARVESTED_UPDATE` antes de permitir cualquier operación de exportación.

---

## 23. Deduplicación Espacial por Radio de Proximidad (35m), Cadencia de Red de 2s vs Clics Destructivos, Limpieza de Prefijos de Coordenadas y Volcado de Diagnóstico Crudo (Raw Data Log)

### Síntoma / Error
1. **Lugares Duplicados a Poca Distancia (<20m) en el Archivo Exportado:**
   Al exportar listas de lugares (ej. *Sitios destacados*), ciertas entidades aparecían dos veces con coordenadas ligeramente distintas (~9m a 18m) y títulos complementarios:
   - Fila A (de RPC): `Teodoro García 2380` (`-34.568914, -58.445007`, con Place ID `ChIJ...`).
   - Fila B (de DOM): `Teodoro García 2380, C1426 Cdad. Autónoma de Buenos Aires` (`-34.568909, -58.445104`, sin Place ID).
   - De igual modo para `B1661IEK Bella Vista` vs `Moine 723, B1661IEK Bella Vista...` (~18m de diferencia) o dropped pins con variaciones submétricas por redondeo flotante (`-34.533075499...` vs `-34.533075`, diferencia de 6 cm).
2. **Pines Internacionales Exportados como Coordenadas Crudas con el País en la Nota de Usuario:**
   Entidades geográficas legítimas (ciudades, territorios o países como *Turkmenistán*, *Vietnam*, *Cuba*, *Afganistán*, *Svalbard y Jan Mayen*, *Seychelles*) aparecían en el Excel tituladas como `(40.252596, 58.439703)` y en la columna de *Personal User Note* se colaba `(40.252596, 58.439703)Turkmenistán`, a pesar de que el usuario nunca escribió esa nota.
3. **Corte Prematuro en Listas Profundas (53 lugares en vez de 200+):**
   Al recorrer feeds virtualizados masivos, la extensión se desplazaba demasiado rápido (300ms a 500ms por ciclo), alcanzando el extremo visible antes de que los paquetes `batchexecute` de Google Maps retornaran del servidor, abortando por estancamiento aparente con solo una fracción del total.

### Causa Raíz
1. **La Trampa de la Grilla Rígida de Coordenadas (`toFixed(5)`):**
   - El índice espacial usaba una clave alfanumérica exacta: `${lat.toFixed(5)},${lng.toFixed(5)}` (~1.1 metros).
   - Google Maps asigna las coordenadas del POI en la base de datos para el RPC, mientras que en la tarjeta DOM HTML inyecta la coordenada geocodificada de la dirección a nivel de calle (diferencia típica de 8 a 25 metros entre la entrada y el centroide del edificio).
   - Al diferir en 10 metros, las claves `coordKey` no coincidían, los identificadores eran distintos (Place ID `ChIJ...` vs hash sintético de DOM), y el sistema insertaba dos filas separadas.
2. **La Trampa de Formato de Pins de Google (`(lat, lng)País`):**
   - Cuando un usuario guarda un pin en una región sin dirección de calle exacta, Google Maps sintetiza la etiqueta `(lat, lng)País` o envía arrays con `(lat, lng)` y el nombre del territorio adyacente.
   - El extractor RPC asignaba primero el string de coordenadas como `title`. Al encontrar luego `(lat, lng)País`, el código veía que `title` ya estaba asignado y lo relegaba a `userNote` creyendo que era una nota personal escrita por el usuario.
3. **Desincronización entre la Velocidad de Scroll y la Latencia de Red:**
   - La paginación en Google Maps es asíncrona: cada solicitud de bloque toma entre 800ms y 1800ms. Un ciclo de scroll de 300ms agotaba los intentos de recuperación antes de que la respuesta llegara a la pestaña.
   - Clicar secuencialmente en cada tarjeta de lugar para abrir su ficha no es viable porque navega fuera de la lista virtual a la vista de detalle y requiere pulsar "Atrás" repetidamente (lo cual en 200 lugares llevaría >13 minutos y reinicia la posición del scroll).

### Enseñanza Generalizable
> [!IMPORTANT]
> **Fusión Espacial por Radio de Tolerancia, Ritmo Medido y Auditoría Forense**:
> 1. **Deduplicación Espacial con Radio de Proximidad Haversine (35–40 metros):**
>    - Nunca confíes en comparaciones de cadenas exactas para coordenadas decimales (`toFixed(5)`).
>    - Aplica una distancia geodésica (fórmula de Haversine o aproximación euclidiana corregida por latitud).
>    - Si la distancia es $\le 40$ metros y existe coincidencia de subcadena en el título/dirección, o uno de los registros es un marcador huérfano con coordenadas crudas, o provienen de fuentes complementarias (RPC + DOM), **fusiona atómicamente ambos registros**: conserva el Place ID oficial, el nombre corto como Título y la dirección larga como Dirección.
> 2. **Depuración de Prefijos de Coordenadas y Promoción de Entidades Geográficas:**
>    - Limpia sistemáticamente expresiones como `^\(?\s*-?\d{1,3}\.\d+[\s,]+-?\d{1,3}\.\d+\s*\)?\s*` de las cadenas Protobuf.
>    - Si el título actual es una coordenada numérica y se descubre un nombre geográfico válido (*Turkmenistán*, *Cuba*), **promueve de inmediato el nombre a Título**.
>    - Rechaza categóricamente que etiquetas sintéticas que inicien con coordenadas sean clasificadas como `userNote`.
> 3. **Cadencia Deliberada de 1.8s - 2.0s por Ciclo para Virtual Feeds Profundos:**
>    - En SPAs masivas con paginación debounced, la velocidad es enemiga de la completitud. Una cadencia de ~1.8s a 2.2s por ciclo otorga el tiempo necesario para que las respuestas `batchexecute` se descarguen y los observadores virtuales del DOM monten los nuevos lotes.
>    - Ante el fin aparente de la lista, permite hasta 10–12 ciclos de paciencia con micro-pulsos de scroll antes de declarar finalización.
> 4. **Exportación Forense Transparente (Raw Data Log JSON):**
>    - Las extensiones complejas deben proporcionar un mecanismo directo para que el usuario o desarrollador exporte un volcado crudo (`Raw Data Log`) con las cargas útiles JSON interceptadas de la red, los snapshots de tarjetas DOM, las trazas de deduplicación espacial y el log de auditoría cronológico, eliminando conjeturas forenses.

