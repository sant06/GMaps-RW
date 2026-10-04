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
11. [La Trampa de los Timers en el Service Worker (setInterval no previene la suspensión en MV3)](#11-la-trampa-de-los-timers-en-el-service-worker-setinterval-no-previene-la-suspensión-en-mv3)
12. [Invalidación de Contexto de Extensión en Pestañas Previas tras Recargar (Extension Context Invalidated)](#12-invalidación-de-contexto-de-extensión-en-pestañas-previas-tras-recargar-extension-context-invalidated)

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





