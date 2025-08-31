# Sistema de Descarga de Medios - WRadar

Este documento describe el sistema de descarga de medios implementado en WRadar, basado en las mejores prácticas de la librería `whatsapp-web.js`.

## 📋 Características Principales

### ✅ Compatibilidad con whatsapp-web.js
- **Múltiples estrategias de descarga**: Implementa 4 métodos diferentes para descargar medios
- **Manejo robusto de errores**: Sistema de reintentos con backoff exponencial
- **Validación de integridad**: Verificación de hash SHA-256 para archivos descargados
- **Deduplicación**: Evita descargas duplicadas basándose en claves de media

### ✅ Gestión Avanzada
- **Cola de descarga**: Procesamiento concurrente con límites configurables
- **Circuit breaker**: Protección contra fallos en cascada
- **Monitoreo de memoria**: Pausa automática en caso de alto uso de memoria
- **Estadísticas detalladas**: Métricas completas de descargas y errores

### ✅ Organización de Archivos
- **Estructura jerárquica**: Organización por año/mes (YYYY/MM/)
- **Metadatos completos**: Archivos JSON con información detallada
- **Nombres únicos**: Prevención de colisiones de nombres
- **Limpieza automática**: Eliminación de estados antiguos

## 🏗️ Arquitectura del Sistema

```
MediaManager (Gestor Principal)
├── MediaDownloader (Descargador)
│   ├── Estrategia 1: message.downloadMedia()
│   ├── Estrategia 2: Store.downloadMedia()
│   ├── Estrategia 3: Métodos sin opciones
│   └── Estrategia 4: Métodos de respaldo
├── MessageMedia (Representación de Media)
│   ├── Datos base64
│   ├── Metadatos (mimetype, filename, size)
│   └── Utilidades (save, validate, convert)
└── Sistema de Cola
    ├── Procesamiento por lotes
    ├── Control de concurrencia
    └── Manejo de reintentos
```

## 🚀 Uso Básico

### Integración Automática en WRadar

El sistema se integra automáticamente en WRadar. Cuando llega un mensaje con media:

1. **Detección**: Se identifica automáticamente si el mensaje contiene media
2. **Validación**: Se verifican tipo, tamaño y disponibilidad
3. **Cola**: Se añade a la cola de descarga si pasa las validaciones
4. **Descarga**: Se procesa usando múltiples estrategias
5. **Almacenamiento**: Se guarda en `./media/YYYY/MM/` con metadatos

### Configuración

```json
{
  "media": {
    "enabled": true,
    "downloadTypes": ["image", "video", "audio", "document", "sticker"],
    "maxFileSize": "50MB",
    "concurrentDownloads": 3,
    "retryAttempts": 3,
    "enableDeduplication": true,
    "enableIntegrityCheck": true
  }
}
```

## 📁 Estructura de Archivos

```
media/
├── 2024/
│   ├── 01/
│   │   ├── 1704067200000_message_123.jpg
│   │   ├── 1704067200000_message_123.jpg.json
│   │   ├── 1704067300000_message_124.mp4
│   │   └── 1704067300000_message_124.mp4.json
│   └── 02/
│       ├── 1706745600000_message_125.pdf
│       └── 1706745600000_message_125.pdf.json
└── error_1704067400000_message_126.json
```

### Ejemplo de Metadata JSON

```json
{
  "messageId": "message_123@c.us",
  "timestamp": 1704067200000,
  "type": "image",
  "mimetype": "image/jpeg",
  "size": 1048576,
  "expectedSize": 1048576,
  "downloadedAt": 1704067205000,
  "filePath": "./media/2024/01/1704067200000_message_123.jpg",
  "fileName": "1704067200000_message_123.jpg",
  "downloaded": true,
  "verified": true,
  "sourceMeta": {
    "mediaKey": "abc123...",
    "mediaHash": "def456...",
    "directPath": "/v/t62.../",
    "clientUrl": "https://mmg.whatsapp.net/..."
  }
}
```

## 🔧 API Programática

### MediaManager

```javascript
const { MediaManager } = require('./src/media/manager');

const mediaManager = new MediaManager(page, './media', config);

// Procesar evento con media
const enrichedEvent = await mediaManager.maybeEnrich(messageEvent);

// Obtener estadísticas
const stats = mediaManager.getStats();

// Limpiar estados antiguos
const cleaned = mediaManager.cleanup();
```

### MediaDownloader

```javascript
const MediaDownloader = require('./src/media/downloader');

const downloader = new MediaDownloader(page, config);
await downloader.injectHelpers();

// Descargar media directamente
const messageMedia = await downloader.downloadMedia(message);
```

### MessageMedia

```javascript
const MessageMedia = require('./src/media/message-media');

// Crear desde archivo
const media = MessageMedia.fromFilePath('./image.jpg');

// Crear desde URL
const media = await MessageMedia.fromUrl('https://example.com/image.jpg');

// Crear desde buffer
const media = MessageMedia.fromBuffer(buffer, 'image/jpeg', 'image.jpg');

// Guardar archivo
await media.save('./output.jpg');

// Validar integridad
const isValid = media.validateIntegrity(expectedHash);

// Obtener información
console.log(media.getMediaType()); // 'image'
console.log(media.getFormattedSize()); // '1.5 MB'
console.log(media.isImage()); // true
```

## 📊 Monitoreo y Estadísticas

### Estadísticas del MediaManager

```javascript
const stats = mediaManager.getStats();
console.log(stats);
```

```json
{
  "processed": 150,
  "downloaded": 145,
  "errors": 5,
  "queued": 0,
  "deduplicated": 12,
  "retries": 8,
  "circuitBreakerTrips": 0,
  "queueLength": 0,
  "processing": false,
  "activeDownloads": 0,
  "maxConcurrent": 3,
  "totalStates": 150,
  "deduplicationCacheSize": 145
}
```

### Estadísticas del MediaDownloader

```javascript
const stats = downloader.getStats();
console.log(stats);
```

```json
{
  "downloads": 100,
  "successes": 95,
  "failures": 5,
  "retries": 8,
  "cached": 12,
  "integrityChecks": 95,
  "integrityFailures": 0,
  "cacheSize": 95,
  "successRate": "95.00%",
  "integritySuccessRate": "100.00%"
}
```

## 🛠️ Estrategias de Descarga

El sistema implementa 4 estrategias de descarga en orden de preferencia:

### 1. message.downloadMedia() (Preferida)
```javascript
const mediaBlob = await message.downloadMedia({
  downloadEvenIfExpensive: true,
  rmrReason: 1
});
```

### 2. Store.downloadMedia()
```javascript
const mediaBlob = await window.Store.downloadMedia(message, {
  downloadEvenIfExpensive: true,
  rmrReason: 1
});
```

### 3. Métodos sin opciones
```javascript
const mediaBlob = await message.downloadMedia();
// o
const mediaBlob = await window.Store.downloadMedia(message);
```

### 4. Métodos de respaldo
```javascript
// Usando prototype
const mediaBlob = await message.constructor.prototype.downloadMedia.call(message);
```

## ⚠️ Manejo de Errores

### Tipos de Error Categorizados

- **VALIDATION**: Errores de validación de entrada
- **BROWSER**: Errores del contexto del navegador
- **NETWORK**: Errores de red y timeouts
- **INTEGRITY**: Fallos en verificación de integridad
- **STORAGE**: Errores de almacenamiento
- **DOWNLOAD**: Errores generales de descarga

### Circuit Breaker

El sistema incluye un circuit breaker que:
- Se abre después de 10 fallos consecutivos (configurable)
- Permanece abierto por 60 segundos (configurable)
- Pasa a estado semi-abierto para probar recuperación
- Se cierra automáticamente tras descargas exitosas

### Reintentos

- **Intentos**: 3 por defecto (configurable)
- **Delay**: Backoff exponencial (2s, 4s, 8s...)
- **Condiciones**: Solo para errores recuperables

## 🔍 Casos de Uso Especiales

### Mensajes de Estado (Stories)
- Verificación automática de expiración (24 horas)
- Manejo especial para `status@broadcast`

### Archivos Grandes
- Límite configurable de tamaño
- Monitoreo de memoria durante descarga
- Pausa automática en caso de alto uso de memoria

### Deduplicación
- Basada en `mediaKey`, `filehash`, `directPath` y `size`
- Cache en memoria con límite de 1000 entradas
- Limpieza automática de entradas antiguas

## 🚨 Solución de Problemas

### Problema: Descargas fallan constantemente
**Solución**: Verificar que WhatsApp Web esté completamente cargado y que `window.Store` esté disponible.

### Problema: Archivos corruptos
**Solución**: Habilitar `enableIntegrityCheck` en la configuración.

### Problema: Alto uso de memoria
**Solución**: Reducir `concurrentDownloads` y ajustar `pauseOnHighMemoryMB`.

### Problema: Cola se llena
**Solución**: Aumentar `maxQueueSize` o reducir la frecuencia de mensajes.

## 📝 Logs y Debugging

El sistema genera logs detallados:

```
[MediaManager] Enqueued image: message_123@c.us (queue: 1)
[MediaDownloader] Attempt 1: Using strategy 1
[Browser] Download successful using: message.downloadMedia
[MediaManager] Downloaded: 1704067200000_message_123.jpg (1048576 bytes)
```

Para debugging adicional, habilitar logs del navegador:
```javascript
page.on('console', (msg) => {
  console.log('[Browser]', msg.text());
});
```

## 🔄 Migración desde Sistemas Anteriores

Si tienes un sistema de descarga existente, puedes migrar gradualmente:

1. **Mantener sistema actual**: El nuevo sistema es compatible
2. **Configurar gradualmente**: Habilitar tipos de media específicos
3. **Monitorear estadísticas**: Verificar que las descargas funcionen
4. **Migrar completamente**: Deshabilitar sistema anterior

## 📚 Ejemplos Adicionales

Ver `examples/media-download-example.js` para ejemplos completos de uso.

## 🤝 Contribuciones

Para contribuir al sistema de descarga de medios:

1. Mantener compatibilidad con whatsapp-web.js
2. Añadir tests para nuevas funcionalidades
3. Documentar cambios en este README
4. Seguir los patrones de error handling existentes

---

**Nota**: Este sistema está diseñado para ser robusto y manejar los casos edge comunes en WhatsApp Web. Sin embargo, WhatsApp puede cambiar su implementación interna, por lo que el sistema incluye múltiples estrategias de respaldo para mantener la compatibilidad.