/**
 * Snapchat Video/Story Downloader Module
 * Supports: Stories, Spotlight, Public content
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

/**
 * Extract content ID from Snapchat URL
 */
function extractContentId(url) {
  const patterns = [
    /snapchat\.com\/add\/([a-zA-Z0-9_-]+)/,
    /snapchat\.com\/p\/([a-zA-Z0-9_-]+)/,
    /snapchat\.com\/spotlight\/([a-zA-Z0-9_-]+)/,
    /snapchat\.com\/story\/([a-zA-Z0-9_-]+)/,
    /snap\.com\/p\/([a-zA-Z0-9_-]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Download Snapchat content
 */
async function downloadSnapchat(url) {
  try {
    const contentId = extractContentId(url);
    
    if (!contentId) {
      throw new Error('Invalid Snapchat URL');
    }

    // Method 1: Using snapx API
    const snapxResult = await downloadFromSnapx(url);
    if (snapxResult.success) {
      return snapxResult;
    }

    // Method 2: Using snapsave API
    const snapsaveResult = await downloadFromSnapsave(url);
    if (snapsaveResult.success) {
      return snapsaveResult;
    }

    // Method 3: Using snapdownloader API
    const downloaderResult = await downloadFromDownloader(url);
    if (downloaderResult.success) {
      return downloaderResult;
    }

    throw new Error('Unable to download from Snapchat');
  } catch (error) {
    console.error('Snapchat download error:', error);
    throw error;
  }
}

/**
 * Download using snapx API (universal downloader)
 */
async function downloadFromSnapx(url) {
  try {
    const apiUrl = `https://snapsave.app/api/convert`;
    
    const response = await axios.post(apiUrl, {
      url: url
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://snapsave.app/'
      },
      timeout: 30000
    });

    if (response.data && response.data.url) {
      return {
        success: true,
        platform: 'snapchat',
        title: response.data.title || 'Snapchat Story',
        type: response.data.type || 'story',
        duration: response.data.duration || 0,
        thumbnail: response.data.thumbnail || '',
        media: {
          video: response.data.type === 'video' ? {
            url: response.data.url,
            hd_url: response.data.hd_url || response.data.url,
            sd_url: response.data.sd_url || response.data.url,
            format: 'mp4'
          } : null,
          image: response.data.type === 'image' ? {
            url: response.data.url,
            hd_url: response.data.url
          } : null
        },
        download_url: response.data.url
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Snapx API error:', error.message);
    return { success: false };
  }
}

/**
 * Download using snapsave API
 */
async function downloadFromSnapsave(url) {
  try {
    const apiUrl = `https://snapsave.io/api/convert`;
    
    const formData = new URLSearchParams();
    formData.append('url', url);

    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    if (response.data && (response.data.url || response.data.download)) {
      const data = response.data;
      
      return {
        success: true,
        platform: 'snapchat',
        title: data.title || 'Snapchat Story',
        type: data.type || 'story',
        author: data.author || 'Unknown',
        duration: data.duration || 0,
        thumbnail: data.thumbnail || '',
        media: {
          video: data.type === 'video' ? {
            url: data.url || data.download,
            hd_url: data.hd_url || data.url || data.download,
            sd_url: data.sd_url || data.url || data.download,
            format: 'mp4'
          } : null,
          image: data.type === 'image' ? {
            url: data.url || data.download,
            hd_url: data.url || data.download
          } : null
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Snapsave API error:', error.message);
    return { success: false };
  }
}

/**
 * Download using snapdownloader API
 */
async function downloadFromDownloader(url) {
  try {
    const apiUrl = `https://snapdownloader.io/api/download`;
    
    const response = await axios.post(apiUrl, {
      url: url,
      format: 'mp4'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    if (response.data && response.data.url) {
      return {
        success: true,
        platform: 'snapchat',
        title: 'Snapchat Story',
        media: {
          video: {
            url: response.data.url,
            hd_url: response.data.hd_url || response.data.url,
            sd_url: response.data.sd_url || response.data.url
          }
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Snapdownloader API error:', error.message);
    return { success: false };
  }
}

/**
 * Express route handlers
 */
router.get('/download', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL parameter is required'
      });
    }

    // Validate Snapchat URL
    if (!url.includes('snapchat.com') && !url.includes('snap.com')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Snapchat URL'
      });
    }

    const result = await downloadSnapchat(url);
    res.json(result);

  } catch (error) {
    console.error('Snapchat download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download from Snapchat',
      message: error.message
    });
  }
});

router.post('/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const result = await downloadSnapchat(url);
    res.json(result);

  } catch (error) {
    console.error('Snapchat download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download from Snapchat',
      message: error.message
    });
  }
});

// Info endpoint
router.get('/info', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL parameter is required'
      });
    }

    const contentId = extractContentId(url);
    
    res.json({
      success: true,
      platform: 'snapchat',
      contentId: contentId,
      note: 'Snapchat content must be public. Private stories cannot be downloaded.',
      supported_types: ['public_stories', 'spotlight', 'public_snaps']
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.download = downloadSnapchat;
