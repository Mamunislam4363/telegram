/**
 * Pinterest Video/Image Downloader Module
 * Supports: Pins, Boards, Images, Videos
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

/**
 * Extract pin ID from Pinterest URL
 */
function extractPinId(url) {
  const patterns = [
    /pinterest\.com\/pin\/(\d+)/,
    /pinterest\.com\/[^/]+\/(\d+)/,
    /pin\.it\/(\w+)/,
    /pinterest\.com\/[^/]+\/[^/]+\/(.+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Download Pinterest content
 */
async function downloadPinterest(url) {
  try {
    const pinId = extractPinId(url);
    
    if (!pinId) {
      throw new Error('Invalid Pinterest URL');
    }

    // Method 1: Using expertsphp API
    const expertsphpResult = await downloadFromExpertsphp(url);
    if (expertsphpResult.success) {
      return expertsphpResult;
    }

    // Method 2: Using snapx API
    const snapxResult = await downloadFromSnapx(url);
    if (snapxResult.success) {
      return snapxResult;
    }

    // Method 3: Using scrape method
    const scrapeResult = await downloadFromScrape(url);
    if (scrapeResult.success) {
      return scrapeResult;
    }

    throw new Error('Unable to download from Pinterest');
  } catch (error) {
    console.error('Pinterest download error:', error);
    throw error;
  }
}

/**
 * Download using expertsphp API
 */
async function downloadFromExpertsphp(url) {
  try {
    const apiUrl = `https://www.expertsphp.com/pinterest-video-downloader/api`;
    
    const formData = new URLSearchParams();
    formData.append('url', url);

    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.expertsphp.com/'
      },
      timeout: 30000
    });

    if (response.data && response.data.url) {
      const data = response.data;
      
      return {
        success: true,
        platform: 'pinterest',
        title: data.title || 'Pinterest Pin',
        description: data.description || '',
        thumbnail: data.thumbnail || '',
        author: data.author || 'Unknown',
        media: {
          video: data.type === 'video' ? {
            url: data.url,
            hd_url: data.url,
            sd_url: data.url,
            format: 'mp4'
          } : null,
          image: data.type === 'image' ? {
            url: data.url,
            hd_url: data.hd_url || data.url,
            sd_url: data.url
          } : null
        },
        download_url: data.url
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Expertsphp API error:', error.message);
    return { success: false };
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://snapsave.app/'
      },
      timeout: 30000
    });

    if (response.data && response.data.url) {
      return {
        success: true,
        platform: 'pinterest',
        title: response.data.title || 'Pinterest Pin',
        type: response.data.type || 'image',
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
 * Download using scrape method
 */
async function downloadFromScrape(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 30000
    });

    const html = response.data;
    const $ = cheerio.load(html);
    
    // Try to find image/video in meta tags
    const ogImage = $('meta[property="og:image"]').attr('content');
    const ogVideo = $('meta[property="og:video"]').attr('content');
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDescription = $('meta[property="og:description"]').attr('content');

    if (ogVideo || ogImage) {
      return {
        success: true,
        platform: 'pinterest',
        title: ogTitle || 'Pinterest Pin',
        description: ogDescription || '',
        thumbnail: ogImage || '',
        media: {
          video: ogVideo ? {
            url: ogVideo,
            hd_url: ogVideo,
            format: 'mp4'
          } : null,
          image: ogImage ? {
            url: ogImage,
            hd_url: ogImage
          } : null
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Scrape error:', error.message);
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

    // Validate Pinterest URL
    if (!url.includes('pinterest.com') && !url.includes('pin.it')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Pinterest URL'
      });
    }

    const result = await downloadPinterest(url);
    res.json(result);

  } catch (error) {
    console.error('Pinterest download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download from Pinterest',
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

    const result = await downloadPinterest(url);
    res.json(result);

  } catch (error) {
    console.error('Pinterest download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download from Pinterest',
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

    const pinId = extractPinId(url);
    
    res.json({
      success: true,
      platform: 'pinterest',
      pinId: pinId,
      supported_types: ['images', 'videos', 'gifs'],
      note: 'Supports public pins only'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search pins endpoint
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    // Note: Pinterest search requires official API
    res.json({
      success: true,
      note: 'Pinterest search requires Pinterest API key. Register at https://developers.pinterest.com/',
      query: q,
      limit: parseInt(limit)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.download = downloadPinterest;
