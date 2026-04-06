/**
 * YouTube Video Downloader Module
 * Supports: Multiple qualities, Audio only, Video + Audio
 */

const express = require('express');
const router = express.Router();

// Using ytdl-core for YouTube downloads
let ytdl;
try {
  ytdl = require('@distube/ytdl-core');
} catch {
  try {
    ytdl = require('ytdl-core');
  } catch {
    console.warn('ytdl-core not installed. Run: npm install @distube/ytdl-core');
  }
}

/**
 * Extract video ID from YouTube URL
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Get video info using ytdl-core
 */
async function getVideoInfo(url) {
  if (!ytdl) {
    throw new Error('ytdl-core not installed. Run: npm install @distube/ytdl-core');
  }

  try {
    const info = await ytdl.getInfo(url);
    return info;
  } catch (error) {
    console.error('Error getting video info:', error);
    throw error;
  }
}

/**
 * Format file size
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Download YouTube video
 */
async function downloadYouTube(url, options = {}) {
  try {
    const { quality = 'highest', type = 'video' } = options;
    
    if (!ytdl) {
      // Fallback API method
      return await downloadFromAPI(url, quality, type);
    }

    const info = await getVideoInfo(url);
    const videoId = info.videoDetails.videoId;
    
    // Get available formats
    const formats = ytdl.filterFormats(info.formats, format => {
      if (type === 'audio') {
        return format.hasAudio && !format.hasVideo;
      }
      return format.hasVideo && format.hasAudio;
    });

    // Sort by quality
    formats.sort((a, b) => {
      return parseInt(b.height || 0) - parseInt(a.height || 0);
    });

    // Select format based on quality preference
    let selectedFormat;
    if (quality === 'highest') {
      selectedFormat = formats[0];
    } else if (quality === 'lowest') {
      selectedFormat = formats[formats.length - 1];
    } else {
      // Find closest quality
      const targetQuality = parseInt(quality);
      selectedFormat = formats.reduce((prev, curr) => {
        return Math.abs(curr.height - targetQuality) < Math.abs(prev.height - targetQuality) ? curr : prev;
      });
    }

    // Build response
    const thumbnails = info.videoDetails.thumbnails;
    const thumbnail = thumbnails[thumbnails.length - 1]?.url || '';

    return {
      success: true,
      platform: 'youtube',
      title: info.videoDetails.title,
      description: info.videoDetails.description?.substring(0, 200) || '',
      author: info.videoDetails.author?.name || 'Unknown',
      authorId: info.videoDetails.author?.id || '',
      duration: parseInt(info.videoDetails.lengthSeconds) || 0,
      views: parseInt(info.videoDetails.viewCount) || 0,
      thumbnail: thumbnail,
      videoId: videoId,
      media: {
        video: type === 'video' ? {
          url: selectedFormat?.url || '',
          quality: selectedFormat?.qualityLabel || 'unknown',
          height: selectedFormat?.height || 0,
          width: selectedFormat?.width || 0,
          fps: selectedFormat?.fps || 30,
          format: selectedFormat?.container || 'mp4',
          size: formatSize(selectedFormat?.contentLength || 0)
        } : null,
        audio: type === 'audio' || type === 'both' ? {
          url: selectedFormat?.url || '',
          bitrate: selectedFormat?.audioBitrate || 128,
          format: selectedFormat?.container || 'mp3'
        } : null
      },
      availableQualities: formats.map(f => ({
        quality: f.qualityLabel,
        height: f.height,
        fps: f.fps,
        hasAudio: f.hasAudio,
        hasVideo: f.hasVideo,
        url: f.url
      })),
      downloadUrl: selectedFormat?.url || ''
    };

  } catch (error) {
    console.error('YouTube download error:', error);
    // Fallback to API method
    return await downloadFromAPI(url, options.quality, options.type);
  }
}

/**
 * Fallback API method
 */
async function downloadFromAPI(url, quality = '720p', type = 'video') {
  try {
    // Using RapidAPI YouTube downloader or similar
    const videoId = extractVideoId(url);
    
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    // Construct download URL
    const baseUrl = 'https://www.youtube.com/watch?v=' + videoId;
    
    return {
      success: true,
      platform: 'youtube',
      title: 'YouTube Video',
      videoId: videoId,
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      media: {
        video: type !== 'audio' ? {
          url: baseUrl,
          quality: quality,
          format: 'mp4'
        } : null,
        audio: type === 'audio' || type === 'both' ? {
          url: baseUrl,
          bitrate: 128,
          format: 'mp3'
        } : null
      },
      note: 'Using direct URL. For actual download, install ytdl-core: npm install @distube/ytdl-core'
    };
  } catch (error) {
    console.error('API fallback error:', error);
    throw error;
  }
}

/**
 * Express route handlers
 */
router.get('/download', async (req, res) => {
  try {
    const { url, quality, type } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL parameter is required'
      });
    }

    // Validate YouTube URL
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL'
      });
    }

    const result = await downloadYouTube(url, { quality, type });
    res.json(result);

  } catch (error) {
    console.error('YouTube download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download YouTube video',
      message: error.message
    });
  }
});

router.post('/download', async (req, res) => {
  try {
    const { url, quality, type } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const result = await downloadYouTube(url, { quality, type });
    res.json(result);

  } catch (error) {
    console.error('YouTube download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download YouTube video',
      message: error.message
    });
  }
});

// Get available formats
router.get('/formats', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL parameter is required'
      });
    }

    if (!ytdl) {
      return res.status(503).json({
        success: false,
        error: 'ytdl-core not installed',
        installCommand: 'npm install @distube/ytdl-core'
      });
    }

    const info = await getVideoInfo(url);
    const formats = info.formats.filter(f => f.hasVideo);
    
    // Group by quality
    const qualities = [...new Set(formats.map(f => f.qualityLabel))].filter(Boolean);

    res.json({
      success: true,
      title: info.videoDetails.title,
      qualities: qualities,
      formats: formats.map(f => ({
        quality: f.qualityLabel,
        container: f.container,
        hasAudio: f.hasAudio,
        fps: f.fps,
        height: f.height,
        width: f.width
      }))
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.download = downloadYouTube;
