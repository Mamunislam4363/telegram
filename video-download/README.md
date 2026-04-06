# Video Downloader API

A comprehensive video downloader API supporting 7 major social media platforms: **TikTok**, **YouTube**, **Facebook**, **Twitter/X**, **Instagram**, **Snapchat**, and **Pinterest**.

## Features

- Download videos without watermark (where supported)
- Multiple download methods for reliability
- Rate limiting and security features
- CORS enabled for Telegram bot integration
- Health check endpoint
- Auto-detection of platform from URL

## Supported Platforms

| Platform | Video | Audio | Images | HD Quality |
|----------|-------|-------|--------|------------|
| TikTok | | N/A | - | |
| YouTube | | | N/A | |
| Facebook | | N/A | - | |
| Twitter/X | | N/A | | - |
| Instagram | | N/A | | - |
| Snapchat | | N/A | | - |
| Pinterest | | N/A | | - |

*Key: = Supported, - = Not applicable*

## Installation

```bash
# Navigate to video-download folder
cd video-download

# Install dependencies
npm install

# Optional: Install YouTube downloader (requires ytdl-core)
npm install @distube/ytdl-core
```

## Usage

### Start the Server

```bash
npm start
# or
node index.js
```

The server will start on port **3001** (or set `VIDEO_DOWNLOAD_PORT` env variable).

### API Endpoints

#### Health Check
```bash
GET http://localhost:3001/health
```

#### Universal Download (Auto-detects platform)
```bash
POST http://localhost:3001/download
Content-Type: application/json

{
  "url": "https://tiktok.com/@user/video/123456"
}
```

#### Platform-Specific Downloads

**TikTok:**
```bash
GET http://localhost:3001/tiktok/download?url=https://tiktok.com/@user/video/123456
```

**YouTube:**
```bash
GET http://localhost:3001/youtube/download?url=https://youtube.com/watch?v=VIDEO_ID&quality=720p
```

**Facebook:**
```bash
GET http://localhost:3001/facebook/download?url=https://facebook.com/watch?v=123456
```

**Twitter/X:**
```bash
GET http://localhost:3001/twitter/download?url=https://x.com/user/status/123456
```

**Instagram:**
```bash
GET http://localhost:3001/instagram/download?url=https://instagram.com/p/ABC123
```

**Snapchat:**
```bash
GET http://localhost:3001/snapchat/download?url=https://snapchat.com/add/username
```

**Pinterest:**
```bash
GET http://localhost:3001/pinterest/download?url=https://pinterest.com/pin/123456
```

### Response Format

```json
{
  "success": true,
  "platform": "tiktok",
  "title": "Video Title",
  "author": "Username",
  "media": {
    "video": {
      "url": "https://download-link.mp4",
      "hd_url": "https://hd-download-link.mp4",
      "sd_url": "https://sd-download-link.mp4"
    },
    "audio": {
      "url": "https://audio-link.mp3"
    }
  }
}
```

## Integration with Telegram Bot

To integrate with your Telegram bot:

```javascript
// In your bot.js or main file
const videoDownloadApi = require('./video-download/index');

// Or make HTTP requests to the API
const axios = require('axios');

async function downloadVideo(url) {
  try {
    const response = await axios.post('http://localhost:3001/download', {
      url: url
    });
    return response.data;
  } catch (error) {
    console.error('Download failed:', error);
    return null;
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VIDEO_DOWNLOAD_PORT` | 3001 | Server port |
| `ALLOWED_ORIGINS` | localhost, t.me | CORS allowed origins |
| `NODE_ENV` | development | Environment mode |

## Folder Structure

```
video-download/
├── index.js              # Main API controller
├── package.json          # Dependencies
├── README.md            # This file
├── tiktok/              # TikTok downloader
│   └── index.js
├── youtube/             # YouTube downloader
│   └── index.js
├── facebook/            # Facebook downloader
│   └── index.js
├── twitter/             # Twitter/X downloader
│   └── index.js
├── instagram/           # Instagram downloader
│   └── index.js
├── snapchat/            # Snapchat downloader
│   └── index.js
└── pinterest/           # Pinterest downloader
    └── index.js
```

## Error Handling

The API returns proper HTTP status codes:
- `200` - Success
- `400` - Bad Request (invalid URL)
- `404` - Endpoint not found
- `429` - Rate limit exceeded
- `500` - Server error

## Rate Limiting

Default rate limits:
- 100 requests per 15 minutes per IP
- Configurable via middleware

## Security

- Helmet.js for security headers
- CORS protection
- Rate limiting
- Input validation

## Notes

1. **YouTube**: Requires `@distube/ytdl-core` for best results
2. **Private Content**: Cannot download private videos/stories
3. **Rate Limits**: Some platforms may block frequent requests
4. **Reliability**: Multiple fallback methods implemented for each platform

## Troubleshooting

### YouTube downloads not working
```bash
npm install @distube/ytdl-core
```

### Rate limit exceeded
Wait 15 minutes or implement proxy rotation.

### Video URL expired
Download URLs are temporary. Download immediately or refresh.

## License

MIT License - See main project LICENSE file

## Support

For issues or feature requests, please open an issue on the main repository.
