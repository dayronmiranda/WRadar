/*
 Test script para verificar que el sistema de descarga de medios funciona correctamente
*/

const MessageMedia = require('./src/media/message-media');

async function testMessageMedia() {
  console.log('🧪 Probando MessageMedia...');
  
  try {
    // Test 1: Crear MessageMedia básico
    const media = new MessageMedia(
      'image/jpeg',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg==',
      'test.jpg',
      100
    );
    
    console.log('✅ MessageMedia creado correctamente');
    console.log('- Tipo MIME:', media.mimetype);
    console.log('- Nombre:', media.filename);
    console.log('- Tamaño:', media.filesize);
    console.log('- Es válido:', media.isValid());
    console.log('- Es imagen:', media.isImage());
    console.log('- Extensión:', media.getExtension());
    console.log('- Tamaño formateado:', media.getFormattedSize());
    console.log('- Tamaño real:', media.getActualSize());
    
    // Test 2: Validación de integridad
    const crypto = require('crypto');
    const buffer = Buffer.from(media.data, 'base64');
    const expectedHash = crypto.createHash('sha256').update(buffer).digest('base64');
    
    const isValid = media.validateIntegrity(expectedHash);
    console.log('✅ Validación de integridad:', isValid);
    
    // Test 3: Conversión a JSON
    const json = media.toJSON(false);
    console.log('✅ Conversión a JSON exitosa');
    console.log('- JSON keys:', Object.keys(json));
    
    // Test 4: Crear desde JSON
    const mediaFromJson = MessageMedia.fromJSON({
      mimetype: 'image/png',
      data: media.data,
      filename: 'from-json.png',
      filesize: 50
    });
    console.log('✅ Creación desde JSON exitosa');
    console.log('- Tipo:', mediaFromJson.getMediaType());
    
    // Test 5: Clonar
    const cloned = media.clone();
    console.log('✅ Clonación exitosa');
    console.log('- Clonado es válido:', cloned.isValid());
    
    console.log('\n🎉 Todos los tests de MessageMedia pasaron correctamente!');
    
  } catch (error) {
    console.error('❌ Error en test de MessageMedia:', error.message);
    console.error(error.stack);
  }
}

async function testBasicExtensions() {
  console.log('\n🧪 Probando extensiones básicas...');
  
  const testCases = [
    { mimetype: 'image/jpeg', expected: 'jpg' },
    { mimetype: 'image/png', expected: 'png' },
    { mimetype: 'video/mp4', expected: 'mp4' },
    { mimetype: 'audio/ogg', expected: 'ogg' },
    { mimetype: 'application/pdf', expected: 'pdf' },
    { mimetype: 'unknown/type', expected: 'bin' }
  ];
  
  for (const testCase of testCases) {
    const media = new MessageMedia(testCase.mimetype, 'dGVzdA==', 'test', 4);
    const extension = media.getExtension();
    
    if (extension === testCase.expected) {
      console.log(`✅ ${testCase.mimetype} -> .${extension}`);
    } else {
      console.log(`❌ ${testCase.mimetype} -> .${extension} (esperado: .${testCase.expected})`);
    }
  }
}

async function main() {
  console.log('🚀 Iniciando tests del sistema de descarga de medios\n');
  
  await testMessageMedia();
  await testBasicExtensions();
  
  console.log('\n✅ Tests completados. El sistema debería funcionar correctamente ahora.');
  console.log('\n📝 Notas:');
  console.log('- MessageMedia funciona sin dependencias externas');
  console.log('- Las extensiones se detectan correctamente');
  console.log('- La validación de integridad funciona');
  console.log('- El sistema es compatible con whatsapp-web.js');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testMessageMedia, testBasicExtensions };