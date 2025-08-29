# WRadar - Simplified Architecture

## Changes Made

### Architecture Simplification
- **Removed Program B dependencies**: Eliminated all references to Program B health monitoring and staging
- **Streamlined flow**: WhatsApp Web → Scripts → Client → NATS (direct publishing)
- **Removed health checker**: No more Program B health monitoring components

### Phone Number-Based NATS Subjects
- **Dynamic subjects**: NATS subjects now include the WhatsApp phone number
- **Format**: `whatsapp.{phoneNumber}.events` (e.g., `whatsapp.17862334567.events`)
- **Auto-detection**: Phone number is automatically detected from WhatsApp Web session
- **Fallback**: Uses `whatsapp.events` if phone number cannot be detected

### Configuration Changes
- **New field**: Added `whatsapp.phoneNumber` in config for manual phone number setting
- **Stream subjects**: Updated to support wildcard pattern `whatsapp.*.events`
- **Example config**: Created `config/example.json` with phone number example

### Files Modified
1. **config/default.json**: Added `whatsapp.phoneNumber` field
2. **src/index.js**: 
   - Removed Program B health checker imports and initialization
   - Added phone number detection functionality
   - Updated logging to reflect new architecture
   - Simplified cleanup process
3. **src/client.js**: 
   - Removed Program B references
   - Added `updatePhoneNumber()` method
   - Updated event routing messages
4. **src/nats/publisher.js**: 
   - Added phone number support in constructor
   - Added `updatePhoneNumber()` method for dynamic subject updates
   - Subject now dynamically constructed based on phone number

### Files Removed
- **src/health/program_b_checker.js**: Removed Program B health monitoring
- **src/health/**: Removed entire health directory

### New Features
- **Phone number detection**: Automatically detects WhatsApp phone number from session
- **Dynamic NATS subjects**: Subjects update automatically when phone number is detected
- **Phone number event**: Emits `phone_number_detected` event when number is found

## Usage

### Manual Phone Number Configuration
Set the phone number in your config file:
```json
{
  "whatsapp": {
    "phoneNumber": "17862334567"
  }
}
```

### Automatic Detection
The system will automatically detect the phone number from WhatsApp Web and update the NATS subject accordingly.

### NATS Stream Configuration
Update your NATS stream to support the new subject pattern:
```json
{
  "nats": {
    "stream": {
      "subjects": ["whatsapp.*.events"]
    }
  }
}
```

## Architecture Flow

```
WhatsApp Web → Injected Scripts → Client → NATS
                                      ↓
                               MediaManager (for media downloads)
```

### Media Processing
- **Detection**: Media detected in events
- **Download**: MediaManager downloads via browser context  
- **Storage**: Files stored in configured media directory
- **Event enrichment**: Events enriched with media metadata

### Event Flow
1. WhatsApp Web events captured by injected scripts
2. Events queued in browser bridge
3. Main process polls and retrieves events
4. Client processes events and enriches with media
5. Events published to NATS with phone-specific subject
6. Local event server receives copy for debugging

## Benefits
- **Simplified architecture**: No Program B dependencies
- **Phone-specific routing**: Events can be routed by phone number
- **Automatic configuration**: Phone number detected automatically
- **Cleaner codebase**: Removed unused health monitoring code
- **Direct NATS publishing**: No staging, direct event publishing