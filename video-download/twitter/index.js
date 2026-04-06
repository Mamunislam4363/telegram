/**
 * Twitter/X Video Downloader Module
 * Supports: Videos, GIFs, Images from tweets
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

/**
 * Extract tweet ID from Twitter/X URL
 */
function extractTweetId(url) {
  const patterns = [
    /twitter\.com\/\w+\/status\/(\d+)/,
    /x\.com\/\w+\/status\/(\d+)/,
    /t\.co\/(\w+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Download Twitter/X video
 */
async function downloadTwitter(url) {
  try {
    const tweetId = extractTweetId(url);
    
    if (!tweetId) {
      throw new Error('Invalid Twitter/X URL');
    }

    // Method 1: Using sssapis API
    const sssapisResult = await downloadFromSssapis(url, tweetId);
    if (sssapisResult.success) {
      return sssapisResult;
    }

    // Method 2: Using twitterdownloader.io
    const downloaderResult = await downloadFromDownloader(url, tweetId);
    if (downloaderResult.success) {
      return downloaderResult;
    }

    // Method 3: Using snapx API
    const snapxResult = await downloadFromSnapx(url);
    if (snapxResult.success) {
      return snapxResult;
    }

    throw new Error('Unable to download video from Twitter/X');
  } catch (error) {
    console.error('Twitter/X download error:', error);
    throw error;
  }
}

/**
 * Download using sssapis API
 */
async function downloadFromSssapis(url, tweetId) {
  try {
    const apiUrl = `https://sssapis.com/twitter.php`;
    
    const formData = new URLSearchParams();
    formData.append('url', url);

    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    if (response.data) {
      const data = response.data;
      
      return {
        success: true,
        platform: 'twitter',
        tweetId: tweetId,
        author: data.username || 'Unknown',
        text: data.text || '',
        created_at: data.created_at || '',
        media: {
          videos: data.videos || [],
          images: data.images || [],
          gifs: data.gifs || [],
          thumbnail: data.thumbnail || ''
        },
        download_links: data.downloads || []
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Sssapis API error:', error.message);
    return { success: false };
  }
}

/**
 * Download using twitterdownloader.io
 */
async function downloadFromDownloader(url, tweetId) {
  try {
    const apiUrl = `https://twitterdownloader.io/api/download`;
    
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
        platform: 'twitter',
        tweetId: tweetId,
        title: 'Twitter/X Video',
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
    console.error('Downloader API error:', error.message);
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
        platform: 'twitter',
        title: response.data.title || 'Twitter/X Video',
        media: {
          video: {
            url: response.data.url,
            hd_url: response.data.url,
            sd_url: response.data.url
          }
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

    // Validate Twitter/X URL
    if (!url.includes('twitter.com') && !url.includes('x.com') && !url.includes('t.co')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Twitter/X URL'
      });
    }

    const result = await downloadTwitter(url);
    res.json(result);

  } catch (error) {
    console.error('Twitter/X download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download Twitter/X video',
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

    const result = await downloadTwitter(url);
    res.json(result);

  } catch (error) {
    console.error('Twitter/X download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download Twitter/X video',
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

    const tweetId = extractTweetId(url);
    
    if (!tweetId) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract tweet ID from URL'
      });
    }

    res.json({
      success: true,
      platform: 'twitter',
      tweetId: tweetId,
      url: `https://twitter.com/i/status/${tweetId}`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.download = downloadTwitter;
