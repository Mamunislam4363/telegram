/**
 * Video Downloader API Controller
 * Supports: TikTok, YouTube, Facebook, Twitter/X, Instagram, Snapchat, Pinterest
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import platform downloaders
const tiktokDownloader = require('./tiktok/index');
const youtubeDownloader = require('./youtube/index');
const facebookDownloader = require('./facebook/index');
const twitterDownloader = require('./twitter/index');
const instagramDownloader = require('./instagram/index');
const snapchatDownloader = require('./snapchat/index');
const pinterestDownloader = require('./pinterest/index');

const app = express();
const PORT = process.env.VIDEO_DOWNLOAD_PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost', 'https://t.me'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  }
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Video Downloader API is running',
    timestamp: new Date().toISOString(),
    platforms: ['tiktok', 'youtube', 'facebook', 'twitter', 'instagram', 'snapchat', 'pinterest']
  });
});

// Platform routes
app.use('/tiktok', tiktokDownloader);
app.use('/youtube', youtubeDownloader);
app.use('/facebook', facebookDownloader);
app.use('/twitter', twitterDownloader);
app.use('/instagram', instagramDownloader);
app.use('/snapchat', snapchatDownloader);
app.use('/pinterest', pinterestDownloader);

// Universal download endpoint - auto-detects platform
app.post('/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    // Detect platform from URL
    const platform = detectPlatform(url);
    
    if (!platform) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported platform. Supported: TikTok, YouTube, Facebook, Twitter/X, Instagram, Snapchat, Pinterest'
      });
    }

    // Route to appropriate downloader
    let result;
    switch (platform) {
      case 'tiktok':
        result = await tiktokDownloader.download(url);
        break;
      case 'youtube':
        result = await youtubeDownloader.download(url);
        break;
      case 'facebook':
        result = await facebookDownloader.download(url);
        break;
      case 'twitter':
        result = await twitterDownloader.download(url);
        break;
      case 'instagram':
        result = await instagramDownloader.download(url);
        break;
      case 'snapchat':
        result = await snapchatDownloader.download(url);
        break;
      case 'pinterest':
        result = await pinterestDownloader.download(url);
        break;
      default:
        throw new Error('Platform not implemented');
    }

    res.json({
      success: true,
      platform,
      data: result
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to download video'
    });
  }
});

// Platform detection helper
function detectPlatform(url) {
  const patterns = {
    tiktok: /tiktok\.com|vm\.tiktok\.com/,
    youtube: /youtube\.com|youtu\.be/,
    facebook: /facebook\.com|fb\.watch/,
    twitter: /twitter\.com|x\.com|t\.co/,
    instagram: /instagram\.com|instagr\.am/,
    snapchat: /snapchat\.com|snap\.com/,
    pinterest: /pinterest\.com|pin\.it/
  };

  for (const [platform, pattern] of Object.entries(patterns)) {
    if (pattern.test(url)) {
      return platform;
    }
  }
  
  return null;
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Video Downloader API running on port ${PORT}`);
  console.log(`📱 Supported platforms: TikTok, YouTube, Facebook, Twitter/X, Instagram, Snapchat, Pinterest`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
