/*
 Media Downloader
 - Downloads media from WhatsApp using correct browser context methods
 - Handles different media types with proper decryption
 - Saves files with proper extensions and integrity checks
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MediaDownloader {
  constructor(page, storageDir) {
    this.page = page;
    this.storageDir = storageDir;
  }

  async downloadMedia(messageId, rawData) {
    try {
      // Generate filename
      const timestamp = Date.now();
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      
      const extension = this.getFileExtension(rawData.type, rawData.mimetype);
      const fileName = `${timestamp}_${this.sanitizeMessageId(messageId)}.${extension}`;
      
      // Create year/month directory structure
      const yearDir = path.join(this.storageDir, year.toString());
      const monthDir = path.join(yearDir, month);
      
      if (!fs.existsSync(monthDir)) {
        fs.mkdirSync(monthDir, { recursive: true });
      }
      
      const filePath = path.join(monthDir, fileName);
      
      // Download media using browser context with correct message ID
      const downloadResult = await this.downloadFromBrowser(rawData.id, rawData);
      
      if (downloadResult && downloadResult.success && downloadResult.data) {
        // Convert base64 to buffer
        const mediaBuffer = Buffer.from(downloadResult.data, 'base64');
        
        // Verify file integrity if hash is available
        if (rawData.filehash && !this.verifyFileHash(mediaBuffer, rawData.filehash)) {
          throw new Error('File integrity check failed - hash mismatch');
        }
        
        // Save actual media file
        fs.writeFileSync(filePath, mediaBuffer);
        
        const mediaMetadata = {
          messageId: messageId,
          timestamp: timestamp,
          type: rawData.type,
          mimetype: rawData.mimetype,
          size: mediaBuffer.length,
          expectedSize: rawData.size,
          downloadedAt: Date.now(),
          filePath: filePath,
          fileName: fileName,
          downloaded: true,
          verified: !!rawData.filehash,
          sourceMeta: {
            mediaKey: rawData.mediaKey,
            mediaKeyTimestamp: rawData.mediaKeyTimestamp,
            mediaHash: rawData.filehash,
            encFilehash: rawData.encFilehash,
            directPath: rawData.directPath,
            clientUrl: rawData.clientUrl
          }
        };
        
        // Save metadata as JSON file
        const metadataPath = filePath + '.json';
        fs.writeFileSync(metadataPath, JSON.stringify(mediaMetadata, null, 2));
        
        console.log(`[MediaDownloader] Downloaded ${rawData.type}: ${fileName} (${mediaBuffer.length} bytes)`);
        
        return {
          success: true,
          fileName: fileName,
          filePath: filePath,
          metadata: mediaMetadata,
          size: mediaBuffer.length
        };
      } else {
        throw new Error(downloadResult?.error || 'Empty media buffer received');
      }
    } catch (error) {
      console.log(`[MediaDownloader] Failed to download media ${messageId}: ${error.message}`);
      
      // Save error metadata
      const errorMetadata = {
        messageId: messageId,
        timestamp: Date.now(),
        type: rawData.type,
        mimetype: rawData.mimetype,
        downloaded: false,
        error: error.message,
        sourceMeta: {
          mediaKey: rawData.mediaKey,
          mediaKeyTimestamp: rawData.mediaKeyTimestamp,
          mediaHash: rawData.filehash,
          encFilehash: rawData.encFilehash,
          directPath: rawData.directPath,
          clientUrl: rawData.clientUrl
        }
      };
      
      const errorPath = path.join(this.storageDir, `error_${Date.now()}_${this.sanitizeMessageId(messageId)}.json`);
      fs.writeFileSync(errorPath, JSON.stringify(errorMetadata, null, 2));
      
      return {
        success: false,
        error: error.message,
        metadata: errorMetadata
      };
    }
  }

  async downloadFromBrowser(messageIdObj, rawData) {
    try {
      // Execute download in browser context using WhatsApp's correct methods
      const downloadResult = await this.page.evaluate(async (msgIdObj, mediaInfo) => {
        try {
          // Check if Store is available with download capabilities
          if (!window.Store || !window.Store.Msg) {
            throw new Error('WhatsApp Store not available');
          }

          if (!window.Store.downloadMedia) {
            throw new Error('Download function not available in Store');
          }

          // Find message using the complete ID object
          let message = null;
          
          if (msgIdObj && msgIdObj._serialized) {
            message = window.Store.Msg.get(msgIdObj._serialized);
          }
          
          if (!message) {
            throw new Error('Message not found in Store');
          }

          // Check if message has media
          if (!message.type || !['image', 'video', 'audio', 'document', 'sticker', 'ptt'].includes(message.type)) {
            throw new Error('Message does not contain downloadable media');
          }

          // Use WhatsApp's download function
          console.log('[Browser] Attempting to download media for message:', msgIdObj._serialized);
          
          const mediaBlob = await window.Store.downloadMedia(message);
          
          if (!mediaBlob) {
            throw new Error('Download returned null/undefined');
          }

          // Convert blob to base64
          let base64Data = '';
          
          if (mediaBlob instanceof Blob) {
            // Convert Blob to base64
            const arrayBuffer = await mediaBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
            base64Data = btoa(binaryString);
          } else if (typeof mediaBlob === 'string') {
            // Already base64 or needs conversion
            if (mediaBlob.startsWith('data:')) {
              // Data URL format
              base64Data = mediaBlob.split(',')[1];
            } else {
              // Assume it's already base64
              base64Data = mediaBlob;
            }
          } else if (mediaBlob.buffer || mediaBlob instanceof ArrayBuffer) {
            // ArrayBuffer or similar
            const uint8Array = new Uint8Array(mediaBlob.buffer || mediaBlob);
            const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
            base64Data = btoa(binaryString);
          } else {
            throw new Error('Unknown media blob format: ' + typeof mediaBlob);
          }

          if (!base64Data) {
            throw new Error('Failed to convert media to base64');
          }

          console.log('[Browser] Successfully downloaded media, size:', base64Data.length);

          return {
            success: true,
            data: base64Data,
            size: base64Data.length
          };

        } catch (error) {
          console.log('[Browser] Download error:', error.message);
          return {
            success: false,
            error: error.message
          };
        }
      }, messageIdObj, rawData);

      return downloadResult;
    } catch (error) {
      console.log(`[MediaDownloader] Browser execution failed: ${error.message}`);
      return {
        success: false,
        error: `Browser execution failed: ${error.message}`
      };
    }
  }

  verifyFileHash(buffer, expectedHash) {
    try {
      // WhatsApp uses SHA-256 for file hashes
      const hash = crypto.createHash('sha256').update(buffer).digest('base64');
      return hash === expectedHash;
    } catch (error) {
      console.log(`[MediaDownloader] Hash verification failed: ${error.message}`);
      return false;
    }
  }

  sanitizeMessageId(messageId) {
    // Clean message ID for filename use
    if (typeof messageId === 'object' && messageId._serialized) {
      return messageId._serialized.replace(/[^a-zA-Z0-9@._-]/g, '_');
    }
    return String(messageId).replace(/[^a-zA-Z0-9@._-]/g, '_');
  }

  getFileExtension(type, mimetype) {
    // Map media types to file extensions
    const typeMap = {
      'image': 'jpg',
      'video': 'mp4', 
      'audio': 'ogg',
      'document': 'pdf',
      'sticker': 'webp',
      'ptt': 'ogg' // voice messages
    };
    
    // Try to get extension from mimetype first (more accurate)
    if (mimetype) {
      const mimeMap = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/3gpp': '3gp',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/msword': 'doc',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.ms-powerpoint': 'ppt',
        'text/plain': 'txt'
      };
      
      if (mimeMap[mimetype]) {
        return mimeMap[mimetype];
      }
    }
    
    return typeMap[type] || 'bin';
  }
}

module.exports = MediaDownloader;