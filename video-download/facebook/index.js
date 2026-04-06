/**
 * Facebook Video Downloader Module
 * Supports: Public videos, Reels, Stories
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

/**
 * Extract video ID from Facebook URL
 */
function extractVideoId(url) {
  const patterns = [
    /facebook\.com\/.*\/videos\/(\d+)/,
    /facebook\.com\/.*\/videos\/vb\.\d+\/(\d+)/,
    /facebook\.com\/watch\/?\?v=(\d+)/,
    /fb\.watch\/(\w+)/,
    /facebook\.com\/reel\/(\d+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Download Facebook video
 */
async function downloadFacebook(url) {
  try {
    // Method 1: Using fbvideos API
    const fbvideosResult = await downloadFromFbvideos(url);
    if (fbvideosResult.success) {
      return fbvideosResult;
    }

    // Method 2: Using scraping method
    const scrapeResult = await downloadFromScrape(url);
    if (scrapeResult.success) {
      return scrapeResult;
    }

    // Method 3: Using snapx API
    const snapxResult = await downloadFromSnapx(url);
    if (snapxResult.success) {
      return snapxResult;
    }

    throw new Error('Unable to download video from Facebook');
  } catch (error) {
    console.error('Facebook download error:', error);
    throw error;
  }
}

/**
 * Download using fbvideos library method
 */
async function downloadFromFbvideos(url) {
  try {
    // Use a third-party API
    const apiUrl = `https://fdown.net/download.php`;
    
    const formData = new URLSearchParams();
    formData.append('URLz', url);

    const response = await axios.post(apiUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    
    // Extract video links
    const links = [];
    $('.btn-group a').each((i, elem) => {
      const href = $(elem).attr('href');
      const text = $(elem).text().trim();
      if (href && href.includes('http')) {
        links.push({
          quality: text.includes('HD') ? 'HD' : 'SD',
          url: href
        });
      }
    });

    if (links.length > 0) {
      return {
        success: true,
        platform: 'facebook',
        title: $('.card-title').text().trim() || 'Facebook Video',
        thumbnail: $('.img-fluid').attr('src') || '',
        media: {
          video: {
            sd_url: links.find(l => l.quality === 'SD')?.url || links[0]?.url,
            hd_url: links.find(l => l.quality === 'HD')?.url || links[0]?.url,
            links: links
          }
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Fbvideos API error:', error.message);
    return { success: false };
  }
}

/**
 * Download using scraping method
 */
async function downloadFromScrape(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 30000
    });

    const html = response.data;
    
    // Try to find video URL in the page
    const videoUrlMatch = html.match(/"video_url":"([^"]+)"/);
    const hdUrlMatch = html.match(/"hd_src":"([^"]+)"/);
    const sdUrlMatch = html.match(/"sd_src":"([^"]+)"/);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);

    if (videoUrlMatch || hdUrlMatch || sdUrlMatch) {
      return {
        success: true,
        platform: 'facebook',
        title: titleMatch ? titleMatch[1].replace(' | Facebook', '').trim() : 'Facebook Video',
        media: {
          video: {
            hd_url: hdUrlMatch ? hdUrlMatch[1].replace(/\\/g, '') : null,
            sd_url: sdUrlMatch ? sdUrlMatch[1].replace(/\\/g, '') : null,
            url: videoUrlMatch ? videoUrlMatch[1].replace(/\\/g, '') : (hdUrlMatch || sdUrlMatch)?.[1].replace(/\\/g, '')
          }
        }
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Scraping error:', error.message);
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
        platform: 'facebook',
        title: response.data.title || 'Facebook Video',
        thumbnail: response.data.thumbnail || '',
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

    // Validate Facebook URL
    if (!url.includes('facebook.com') && !url.includes('fb.watch')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Facebook URL'
      });
    }

    const result = await downloadFacebook(url);
    res.json(result);

  } catch (error) {
    console.error('Facebook download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download Facebook video',
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

    const result = await downloadFacebook(url);
    res.json(result);

  } catch (error) {
    console.error('Facebook download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download Facebook video',
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

    const videoId = extractVideoId(url);
    
    res.json({
      success: true,
      platform: 'facebook',
      videoId: videoId,
      note: 'Facebook video metadata extraction requires cookies for private videos'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.download = downloadFacebook;
