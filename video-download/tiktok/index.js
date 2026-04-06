/**
 * TikTok Video Downloader Module
 * Supports: Video without watermark, Audio extraction, Metadata
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

// TikTok API endpoint
const TIKTOK_API_BASE = 'https://api22-normal-c-useast2a.tiktokv.com';

/**
 * Extract video ID from TikTok URL
 */
function extractVideoId(url) {
  // Handle various TikTok URL formats
  const patterns = [
    /video\/(\d+)/,
    /\/v\/(\d+)/,
    /vm\.tiktok\.com\/(\w+)/,
    /vt\.tiktok\.com\/(\w+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Download TikTok video without watermark
 */
async function downloadTikTok(url) {
  try {
    // Method 1: Using TikWM API (reliable)
    const tikwmResult = await downloadFromTikWM(url);
    if (tikwmResult.success) {
      return tikwmResult;
    }

    // Method 2: Alternative API
    const alternativeResult = await downloadFromAlternative(url);
    if (alternativeResult.success) {
      return alternativeResult;
    }

    throw new Error('Unable to download video from TikTok');
  } catch (error) {
    console.error('TikTok download error:', error);
    throw error;
  }
}

/**
 * Download using TikWM API
 */
async function downloadFromTikWM(url) {
  try {
    const apiUrl = 'https://www.tikwm.com/api/';
    
    const response = await axios.post(apiUrl, {
      url: url,
      count: 12,
      cursor: 0,
      web: 1,
      hd: 1
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    if (response.data && response.data.data) {
      const data = response.data.data;
      
      return {
        success: true,
        platform: 'tiktok',
        title: data.title || 'TikTok Video',
        author: data.author?.nickname || 'Unknown',
        authorId: data.author?.unique_id || '',
        avatar: data.author?.avatar || '',
        duration: data.duration || 0,
        cover: data.cover || '',
        media: {
          video_no_watermark: {
            url: data.play || '',
            hd_url: data.hdplay || '',
            size: data.size || 0
          },
          video_with_watermark: {
            url: data.wmplay || ''
          },
          audio: {
            url: data.music || '',
            title: data.music_info?.title || '',
            author: data.music_info?.author || ''
          }
        },
        statistics: {
          plays: data.play_count || 0,
          likes: data.digg_count || 0,
          comments: data.comment_count || 0,
          shares: data.share_count || 0,
          downloads: data.download_count || 0
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('TikWM API error:', error.message);
    return { success: false };
  }
}

/**
 * Alternative download method
 */
async function downloadFromAlternative(url) {
  try {
    // Using ssstik.io API
    const apiUrl = 'https://ssstik.io/abc?url=dl';
    
    const formData = new URLSearchParams();
    formData.append('id', url);
    formData.append('locale', 'en');
    formData.append('tt', '');

    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const downloadLink = $('a[href*=".mp4"]').attr('href');
    
    if (downloadLink) {
      return {
        success: true,
        platform: 'tiktok',
        title: 'TikTok Video',
        media: {
          video_no_watermark: {
            url: downloadLink,
            hd_url: downloadLink
          }
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Alternative API error:', error.message);
    return { success: false };
  }
}

/**
 * Express route handler
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

    // Validate TikTok URL
    if (!url.includes('tiktok.com') && !url.includes('vm.tiktok.com')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid TikTok URL'
      });
    }

    const result = await downloadTikTok(url);
    
    res.json(result);

  } catch (error) {
    console.error('TikTok download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download TikTok video',
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

    const result = await downloadTikTok(url);
    
    res.json(result);

  } catch (error) {
    console.error('TikTok download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download TikTok video',
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

    const result = await downloadTikTok(url);
    
    // Return only metadata
    if (result.success) {
      res.json({
        success: true,
        platform: 'tiktok',
        title: result.title,
        author: result.author,
        duration: result.duration,
        cover: result.cover,
        statistics: result.statistics
      });
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export both router and download function
module.exports = router;
module.exports.download = downloadTikTok;
