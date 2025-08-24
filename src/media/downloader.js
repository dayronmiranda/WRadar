/*
 Media Downloader
 - Downloads media from WhatsApp using browser context
 - Handles different media types
 - Saves files with proper extensions
*/
const fs = require('fs');
const path = require('path');

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
      const fileName = `${timestamp}_${messageId}.${extension}`;
      
      // Create year/month directory structure
      const yearDir = path.join(this.storageDir, year.toString());
      const monthDir = path.join(yearDir, month);
      
      if (!fs.existsSync(monthDir)) {
        fs.mkdirSync(monthDir, { recursive: true });
      }
      
      const filePath = path.join(monthDir, fileName);
      
      // Download media using browser context
      const mediaBuffer = await this.downloadFromBrowser(messageId, rawData);
      
      if (mediaBuffer && mediaBuffer.length > 0) {
        // Save actual media file
        fs.writeFileSync(filePath, Buffer.from(mediaBuffer));
        
        const mediaMetadata = {
          messageId: messageId,
          timestamp: timestamp,
          type: rawData.type,
          mimetype: rawData.mimetype,
          size: mediaBuffer.length,
          downloadedAt: Date.now(),
          filePath: filePath,
          fileName: fileName,
          downloaded: true,
          sourceMeta: {
            mediaKey: rawData.mediaKey,
            mediaHash: rawData.filehash,
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
        throw new Error('Empty media buffer received');
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
          mediaHash: rawData.filehash,
          directPath: rawData.directPath,
          clientUrl: rawData.clientUrl
        }
      };
      
      const errorPath = path.join(this.storageDir, `error_${Date.now()}_${messageId}.json`);
      fs.writeFileSync(errorPath, JSON.stringify(errorMetadata, null, 2));
      
      return {
        success: false,
        error: error.message,
        metadata: errorMetadata
      };
    }
  }

  async downloadFromBrowser(messageId, rawData) {
    try {
      // Execute download in browser context using WhatsApp's internal functions
      const mediaData = await this.page.evaluate(async (msgId, mediaInfo) => {
        try {
          // Find the message in WhatsApp's Store
          if (!window.Store || !window.Store.Msg) {
            throw new Error('WhatsApp Store not available');
          }

          // Find message by ID
          const message = window.Store.Msg.get(msgId);
          if (!message) {
            throw new Error('Message not found in Store');
          }

          // Check if message has media
          if (!message.mediaData && !message.clientUrl && !message.directPath) {
            throw new Error('No media data in message');
          }

          // Use WhatsApp's internal download function
          // This is based on how whatsapp-web.js does it
          let mediaBlob = null;

          // Method 1: Try to get media from message.mediaData
          if (message.mediaData) {
            try {
              // Convert base64 to blob if available
              const base64Data = message.mediaData;
              const byteCharacters = atob(base64Data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              mediaBlob = new Blob([byteArray], { type: mediaInfo.mimetype });
            } catch (e) {
              console.log('Failed to decode base64 media:', e);
            }
          }

          // Method 2: Try to download from WhatsApp's servers
          if (!mediaBlob && (message.clientUrl || message.directPath)) {
            try {
              // Use WhatsApp's internal download mechanism
              if (window.Store.DownloadManager && window.Store.DownloadManager.downloadMedia) {
                const downloadResult = await window.Store.DownloadManager.downloadMedia(message);
                if (downloadResult) {
                  mediaBlob = downloadResult;
                }
              }
            } catch (e) {
              console.log('Failed to download via DownloadManager:', e);
            }
          }

          // Method 3: Try alternative download methods
          if (!mediaBlob && message.directPath) {
            try {
              // Construct WhatsApp media URL
              const mediaUrl = `https://mmg.whatsapp.net${message.directPath}`;
              const response = await fetch(mediaUrl, {
                headers: {
                  'User-Agent': navigator.userAgent
                }
              });
              
              if (response.ok) {
                mediaBlob = await response.blob();
              }
            } catch (e) {
              console.log('Failed to download via direct URL:', e);
            }
          }

          if (mediaBlob) {
            // Convert blob to array buffer
            const arrayBuffer = await mediaBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            return Array.from(uint8Array);
          } else {
            throw new Error('Could not obtain media blob');
          }

        } catch (error) {
          console.log('Browser download error:', error);
          throw error;
        }
      }, messageId, rawData);

      return mediaData;
    } catch (error) {
      console.log(`[MediaDownloader] Browser execution failed: ${error.message}`);
      throw error;
    }
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
    
    // Try to get extension from mimetype
    if (mimetype) {
      const mimeMap = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
      };
      
      if (mimeMap[mimetype]) {
        return mimeMap[mimetype];
      }
    }
    
    return typeMap[type] || 'bin';
  }
}

module.exports = MediaDownloader;