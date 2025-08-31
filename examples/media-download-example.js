/*
 Ejemplo de uso del sistema de descarga de medios
 Basado en whatsapp-web.js para descargar archivos multimedia de mensajes
*/

const { MediaManager } = require('../src/media/manager');
const MediaDownloader = require('../src/media/downloader');
const MessageMedia = require('../src/media/message-media');

// Ejemplo 1: Uso básico del MediaManager (integrado en WRadar)
async function exampleMediaManager(page) {
  console.log('=== Ejemplo 1: MediaManager integrado ===');
  
  // El MediaManager se inicializa automáticamente en WRadar
  const mediaManager = new MediaManager(page, './media', {
    enabled: true,
    downloadTypes: ['image', 'video', 'audio', 'document', 'sticker'],
    maxFileSize: '50MB',
    concurrentDownloads: 3,
    enableDeduplication: true,
    enableIntegrityCheck: true
  });

  // Simular un evento de mensaje con media
  const messageEvent = {
    event: 'message_create',
    timestamp: Date.now(),
    rawData: {
      id: { _serialized: 'message_123@c.us' },
      type: 'image',
      mimetype: 'image/jpeg',
      size: 1024000, // 1MB
      mediaKey: 'some_media_key',
      filehash: 'some_file_hash',
      directPath: '/some/path',
      body: 'Una imagen'
    }
  };

  // El MediaManager enriquece automáticamente el evento
  const enrichedEvent = await mediaManager.maybeEnrich(messageEvent);
  console.log('Evento enriquecido:', enrichedEvent);

  // Obtener estadísticas
  const stats = mediaManager.getStats();
  console.log('Estadísticas del MediaManager:', stats);
}

// Ejemplo 2: Uso directo del MediaDownloader
async function exampleMediaDownloader(page) {
  console.log('=== Ejemplo 2: MediaDownloader directo ===');
  
  const downloader = new MediaDownloader(page, {
    retryAttempts: 3,
    retryDelayMs: 2000,
    enableIntegrityCheck: true,
    enableDeduplication: true,
    maxFileSize: 50 * 1024 * 1024 // 50MB
  });

  // Inyectar funciones helper en el navegador
  await downloader.injectHelpers();

  // Simular descarga de un mensaje
  const message = {
    id: { _serialized: 'message_456@c.us' },
    type: 'image',
    mimetype: 'image/jpeg',
    size: 2048000, // 2MB
    mediaKey: 'another_media_key',
    filehash: 'another_file_hash',
    directPath: '/another/path'
  };

  try {
    const messageMedia = await downloader.downloadMedia(message);
    
    if (messageMedia) {
      console.log('Descarga exitosa:');
      console.log('- Tipo MIME:', messageMedia.mimetype);
      console.log('- Tamaño:', messageMedia.getFormattedSize());
      console.log('- Extensión:', messageMedia.getExtension());
      console.log('- Es imagen:', messageMedia.isImage());
      console.log('- Es válido:', messageMedia.isValid());

      // Guardar el archivo
      await messageMedia.save('./downloads/imagen_descargada.jpg');
      console.log('Archivo guardado en: ./downloads/imagen_descargada.jpg');

      // Crear metadata JSON
      const metadata = messageMedia.toJSON(false); // Sin incluir datos base64
      console.log('Metadata:', metadata);

    } else {
      console.log('Error: No se pudo descargar el media');
    }
  } catch (error) {
    console.error('Error en descarga:', error.message);
  }

  // Obtener estadísticas del downloader
  const stats = downloader.getStats();
  console.log('Estadísticas del downloader:', stats);
}

// Ejemplo 3: Trabajar con MessageMedia directamente
async function exampleMessageMedia() {
  console.log('=== Ejemplo 3: MessageMedia directo ===');

  // Crear MessageMedia desde un archivo local
  try {
    const mediaFromFile = MessageMedia.fromFilePath('./examples/sample.jpg');
    console.log('MessageMedia desde archivo:');
    console.log('- Tipo:', mediaFromFile.getMediaType());
    console.log('- Tamaño:', mediaFromFile.getFormattedSize());
    console.log('- Extensión:', mediaFromFile.getExtension());
  } catch (error) {
    console.log('No se encontró archivo de ejemplo, creando uno sintético...');
    
    // Crear MessageMedia sintético
    const syntheticMedia = new MessageMedia(
      'image/jpeg',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg==', // 1x1 pixel PNG en base64
      'test.jpg',
      100
    );

    console.log('MessageMedia sintético:');
    console.log('- Tipo:', syntheticMedia.getMediaType());
    console.log('- Tamaño:', syntheticMedia.getFormattedSize());
    console.log('- Extensión:', syntheticMedia.getExtension());
    console.log('- Es imagen:', syntheticMedia.isImage());
    console.log('- Tamaño real:', syntheticMedia.getActualSize(), 'bytes');

    // Guardar archivo
    await syntheticMedia.save('./downloads/test_synthetic.jpg');
    console.log('Archivo sintético guardado');

    // Crear data URL
    const dataUrl = syntheticMedia.toDataURL();
    console.log('Data URL:', dataUrl.substring(0, 50) + '...');
  }
}

// Ejemplo 4: Descarga desde URL
async function exampleDownloadFromUrl() {
  console.log('=== Ejemplo 4: Descarga desde URL ===');

  try {
    // Descargar una imagen desde URL
    const mediaFromUrl = await MessageMedia.fromUrl(
      'https://via.placeholder.com/150x150.png',
      { 
        filename: 'placeholder.png',
        timeout: 10000 
      }
    );

    console.log('Descarga desde URL exitosa:');
    console.log('- Tipo MIME:', mediaFromUrl.mimetype);
    console.log('- Tamaño:', mediaFromUrl.getFormattedSize());
    console.log('- Nombre:', mediaFromUrl.filename);

    // Guardar archivo
    await mediaFromUrl.save('./downloads/from_url.png');
    console.log('Archivo desde URL guardado');

  } catch (error) {
    console.log('Error descargando desde URL:', error.message);
  }
}

// Ejemplo 5: Validación de integridad
async function exampleIntegrityValidation() {
  console.log('=== Ejemplo 5: Validación de integridad ===');

  const media = new MessageMedia(
    'text/plain',
    Buffer.from('Hello World').toString('base64'),
    'test.txt',
    11
  );

  // Calcular hash esperado
  const crypto = require('crypto');
  const expectedHash = crypto.createHash('sha256')
    .update(Buffer.from('Hello World'))
    .digest('base64');

  console.log('Hash esperado:', expectedHash);

  // Validar integridad
  const isValid = media.validateIntegrity(expectedHash);
  console.log('Integridad válida:', isValid);

  // Probar con hash incorrecto
  const isInvalid = media.validateIntegrity('hash_incorrecto');
  console.log('Integridad con hash incorrecto:', isInvalid);
}

// Función principal para ejecutar todos los ejemplos
async function runExamples() {
  console.log('🚀 Iniciando ejemplos del sistema de descarga de medios\n');

  // Nota: Los ejemplos 1 y 2 requieren una instancia de página de Puppeteer
  // En un entorno real, esto sería proporcionado por WRadar
  console.log('⚠️  Los ejemplos 1 y 2 requieren una página de Puppeteer activa');
  console.log('   En WRadar, esto se maneja automáticamente\n');

  // Ejecutar ejemplos que no requieren página
  await exampleMessageMedia();
  console.log('\n' + '='.repeat(50) + '\n');
  
  await exampleDownloadFromUrl();
  console.log('\n' + '='.repeat(50) + '\n');
  
  await exampleIntegrityValidation();
  console.log('\n' + '='.repeat(50) + '\n');

  console.log('✅ Ejemplos completados');
  console.log('\n📖 Para usar en WRadar:');
  console.log('1. El MediaManager se inicializa automáticamente');
  console.log('2. Los mensajes con media se procesan automáticamente');
  console.log('3. Los archivos se guardan en ./media/ organizados por año/mes');
  console.log('4. Los metadatos se guardan como archivos .json');
}

// Ejecutar ejemplos si se llama directamente
if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = {
  exampleMediaManager,
  exampleMediaDownloader,
  exampleMessageMedia,
  exampleDownloadFromUrl,
  exampleIntegrityValidation
};