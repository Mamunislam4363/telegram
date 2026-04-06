/**
 * Instagram Video/Photo Downloader Module
 * Supports: Posts, Reels, Stories, IGTV
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

/**
 * Extract post ID from Instagram URL
 */
function extractPostId(url) {
  const patterns = [
    /instagram\.com\/p\/([a-zA-Z0-9_-]+)/,
    /instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
    /instagram\.com\/tv\/([a-zA-Z0-9_-]+)/,
    /instagram\.com\/stories\/[^\/]+\/(\d+)/,
    /instagr\.am\/p\/([a-zA-Z0-9_-]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Download Instagram content
 */
async function downloadInstagram(url) {
  try {
    const postId = extractPostId(url);
    
    if (!postId) {
      throw new Error('Invalid Instagram URL');
    }

    // Method 1: Using instasave API
    const instasaveResult = await downloadFromInstasave(url);
    if (instasaveResult.success) {
      return instasaveResult;
    }

    // Method 2: Using snapx API
    const snapxResult = await downloadFromSnapx(url);
    if (snapxResult.success) {
      return snapxResult;
    }

    // Method 3: Using igram API
    const igramResult = await downloadFromIgram(url);
    if (igramResult.success) {
      return igramResult;
    }

    throw new Error('Unable to download from Instagram');
  } catch (error) {
    console.error('Instagram download error:', error);
    throw error;
  }
}

/**
 * Download using instasave API
 */
async function downloadFromInstasave(url) {
  try {
    const apiUrl = `https://instasave.website/api`;
    
    const response = await axios.post(apiUrl, {
      url: url
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    if (response.data && response.data.result) {
      const data = response.data.result;
      
      return {
        success: true,
        platform: 'instagram',
        type: data.type || 'post',
        title: data.title || 'Instagram Post',
        caption: data.caption || '',
        thumbnail: data.thumbnail || '',
        author: data.username || 'Unknown',
        media: {
          videos: data.videos || [],
          images: data.images || [],
          all_media: data.medias || []
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Instasave API error:', error.message);
    return { success: false };
  }
}

/**
 * Download using snapx API
 */
async function downloadFromSnapx(url) {
  try {
    const apiUrl = `https://snapsave.app/api/convert`;
    
    const response = await axios.post(apiUrl, {
      url: url
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
        platform: 'instagram',
        title: response.data.title || 'Instagram Post',
        type: response.data.type || 'post',
        media: {
          video: response.data.type === 'video' ? {
            url: response.data.url,
            hd_url: response.data.url,
            thumbnail: response.data.thumbnail || ''
          } : null,
          image: response.data.type === 'image' ? {
            url: response.data.url,
            hd_url: response.data.url
          } : null
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Snapx API error:', error.message);
    return { success: false };
  }
}

/**
 * Download using igram API
 */
async function downloadFromIgram(url) {
  try {
    const apiUrl = `https://igram.world/api`;
    
    const formData = new URLSearchParams();
    formData.append('url', url);

    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    if (response.data && response.data.download) {
      return {
        success: true,
        platform: 'instagram',
        title: response.data.title || 'Instagram Post',
        author: response.data.username || 'Unknown',
        media: {
          video: response.data.download.find(d => d.type === 'video')?.url || '',
          image: response.data.download.find(d => d.type === 'image')?.url || '',
          all: response.data.download || []
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Igram API error:', error.message);
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

    // Validate Instagram URL
    if (!url.includes('instagram.com') && !url.includes('instagr.am')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Instagram URL'
      });
    }

    const result = await downloadInstagram(url);
    res.json(result);

  } catch (error) {
    console.error('Instagram download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download from Instagram',
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

    const result = await downloadInstagram(url);
    res.json(result);

  } catch (error) {
    console.error('Instagram download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download from Instagram',
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

    const postId = extractPostId(url);
    
    if (!postId) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract post ID from URL'
      });
    }

    res.json({
      success: true,
      platform: 'instagram',
      postId: postId,
      shortcode: postId,
      url: `https://instagram.com/p/${postId}`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.download = downloadInstagram;
