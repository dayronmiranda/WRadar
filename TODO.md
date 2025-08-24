# WRadar - Especificaciones Técnicas de Desarrollo

## Descripción
Programa Node.js para monitoreo pasivo de WhatsApp Web. Captura eventos entrantes únicamente, sin funcionalidades de envío. Envía todos los eventos vía HTTP webhook local.

## Stack Técnico
- **Runtime**: Node.js 18+
- **Browser**: rebrowser-puppeteer-core
- **Events**: Native EventEmitter
- **Storage**: File system (JSON)
- **Output**: HTTP POST webhooks
- **Config**: JSON estático

## Arquitectura del Sistema

### Flujo de Datos
```
WhatsApp Web → Injected JS → Browser Bridge → Node.js → Media Downloader (async) → HTTP Webhook → External App
                                                      ↓
                                                  ./media/ files
```

### Estructura de Directorios
```
wradar/
├── src/
│   ├── index.js          # Entry point, inicia browser y client
│   ├── client.js         # Manejo de eventos y webhook dispatch
│   ├── session.js        # Persistencia de sesión WhatsApp
│   ├── webhook.js        # HTTP dispatcher para eventos
│   ├── media.js          # Descarga asíncrona de archivos
│   ├── injected/
│   │   ├── store.js      # Acceso a window.Store de WhatsApp
│   │   └── bridge.js     # Comunicación page <-> Node.js
│   └── storage/
│       └── file-storage.js # Almacenamiento en archivos JSON
├── config/
│   └── default.json      # Configuración runtime
├── sessions/             # Directorio para sesiones (auto-creado)
├── media/                # Archivos multimedia descargados (auto-creado)
└── package.json
```

## Configuración

### config/default.json
```json
{
  "browser": {
    "headless": false,
    "viewport": { "width": 1200, "height": 800 },
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  },
  "session": {
    "path": "./sessions",
    "filename": "session.json"
  },
  "media": {
    "enabled": true,
    "path": "./media",
    "downloadTypes": ["image", "video", "audio", "document", "sticker"],
    "maxFileSize": "50MB",
    "concurrentDownloads": 3
  },
  "webhook": {
    "enabled": true,
    "port": 3001,
    "endpoint": "/webhook",
    "retries": 3
  }
}
```

## Componentes Principales

### 1. Browser Controller (src/index.js)
```javascript
// Responsabilidades:
// - Lanzar rebrowser-puppeteer-core
// - Navegar a web.whatsapp.com
// - Inyectar scripts de monitoreo
// - Manejar QR code y auth
```

### 2. Event Client (src/client.js)
```javascript
// Responsabilidades:
// - EventEmitter para todos los eventos
// - Router de eventos por tipo
// - Dispatch a webhook
// - Manejo de errores de red
```

### 3. Session Manager (src/session.js)
```javascript
// Responsabilidades:
// - Guardar/cargar session data
// - Persistir cookies y localStorage
// - Restore session automático
```

### 4. Media Downloader (src/media.js)
```javascript
// Responsabilidades:
// - Detección automática de media en eventos
// - Descarga asíncrona a ./media/
// - Queue de descargas sin bloqueo
// - Metadata de archivos locales
```

### 5. Webhook Dispatcher (src/webhook.js)
```javascript
// Responsabilidades:
// - HTTP POST a localhost
// - Retry logic con exponential backoff
// - Event batching opcional
// - Request timeout handling
```

## Scripts Inyectados

### WhatsApp Store Access (src/injected/store.js)
```javascript
// Funciones requeridas:
// - Setup event listeners en window.Store
// - Serialize mensajes, chats, contacts
// - Monitor connection state
// - Extract media metadata
```

### Bridge Communication (src/injected/bridge.js)
```javascript
// Funciones requeridas:
// - Event queue en window object
// - Polling mechanism desde Node.js
// - Error handling y reconnection
// - Data serialization
```

## Eventos a Implementar

### Prioridad Alta (Fase 1)
- `qr` - QR code para auth
- `ready` - Cliente listo
- `message_create` - Nuevo mensaje
- `message_received` - Mensaje recibido
- `connection_state` - Estado conexión

### Prioridad Media (Fase 2)
- `message_delivered`, `message_read`
- `group_*` - Eventos de grupos
- `contact_*` - Cambios de contactos
- `media_*` - Archivos multimedia

### Prioridad Baja (Fase 3)
- `call_*` - Llamadas
- `status_*` - Estados/historias
- `message_reacted` - Reacciones

## Formato de Eventos

### Datos Crudos (Sin Procesar)
Envío directo del objeto completo desde WhatsApp Store:

```javascript
{
  "event": "image_received",
  "timestamp": 1692886800000,
  "rawData": {
    // Objeto completo sin filtros desde window.Store
    "id": { "_serialized": "true_numero@c.us_hash" },
    "body": "descripción imagen",
    "from": { "_serialized": "numero@c.us" },
    "type": "image",
    "mimetype": "image/jpeg",
    // Todos los campos originales del mensaje
    "__x_all_original_properties": "..."
  },
  "localMedia": {
    "downloaded": true,
    "filePath": "./media/2024/08/imagen_hash.jpg",
    "fileName": "imagen_hash.jpg",
    "fileSize": 245760,
    "mimeType": "image/jpeg",
    "downloadedAt": 1692886801000
  }
}
```

### Eventos Sin Media
```javascript
{
  "event": "message_create",
  "timestamp": 1692886800000,
  "rawData": {
    // Objeto crudo completo de texto
  }
  // Sin campo localMedia
}
```

### HTTP Request
```
POST http://localhost:3001/webhook
Content-Type: application/json

[objeto crudo completo]
```

## Especificaciones de Implementación

### Startup Sequence
1. Cargar config/default.json
2. Inicializar storage (crear ./sessions/)
3. Launch browser con rebrowser-puppeteer-core
4. Navigate to web.whatsapp.com
5. Inyectar store.js y bridge.js
6. Wait for `ready` o `qr` event
7. Setup polling loop para eventos
8. Dispatch eventos vía webhook

### Error Handling
```javascript
// Errores críticos que requieren restart:
// - Browser crash
// - WhatsApp logout forzado
// - Network connection lost

// Errores recuperables:
// - Webhook endpoint down
// - Event parsing errors
// - Storage write failures
```

### Performance Requirements
- **Memory usage**: <150MB steady state
- **Event latency**: <200ms desde WhatsApp hasta webhook
- **Startup time**: <10 segundos hasta `ready`
- **Reliability**: 99%+ event capture rate

## Testing Strategy

### Unit Tests
- Event serialization
- Webhook retry logic
- Session persistence
- Config loading

### Integration Tests
- End-to-end event flow
- Browser automation
- WhatsApp auth flow
- Webhook delivery

## Execution

### Development
```bash
npm install
npm run dev  # Con debugging habilitado
```

### Production
```bash
npm install --production
npm start    # Daemon mode
```

### Docker (Opcional)
```dockerfile
FROM node:18-slim
# Instalar Chrome dependencies
# Copy source y npm install
CMD ["npm", "start"]
```

## Dependencies

### Core (package.json)
```json
{
  "dependencies": {
    "rebrowser-puppeteer-core": "^1.0.0",
    "express": "^4.18.0"  // Para webhook server opcional
  }
}
```

### Opcional
- `pm2` para process management
- `winston` para logging
- `dotenv` para env variables

## Deliverables

### Milestone 1 (MVP)
- [ ] Browser launch y navigate
- [ ] QR code detection
- [ ] Basic message events
- [ ] Webhook dispatch
- [ ] Session persistence

### Milestone 2 (Complete)
- [ ] Todos los eventos listados
- [ ] Error handling robusto
- [ ] Performance optimization
- [ ] Documentation completa