/**
 * AI Service API Endpoints
 * OpenRouter and Bytez providers for Photo/Video Generation and Watermark Removal
 */

const aiService = require('../services/ai-service-manager');

// AI Provider Configuration endpoint
app.get('/api/ai/providers', (req, res) => {
    res.json({
        success: true,
        providers: ['openrouter', 'bytez'],
        default: 'bytez'
    });
});

// Get available models for a provider
app.get('/api/ai/models/:provider/:type', (req, res) => {
    const { provider, type } = req.params;
    try {
        const models = aiService.getAvailableModels(provider, type);
        res.json({
            success: true,
            provider,
            type,
            models
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Generate Photo
app.post('/api/ai/generate-photo', async (req, res) => {
    const { prompt, provider, model, size, style, userId } = req.body;
    
    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: 'Prompt is required'
        });
    }
    
    try {
        const result = await aiService.generatePhoto(prompt, {
            provider,
            model,
            size,
            style
        });
        
        if (result.success) {
            // Log usage if userId provided
            if (userId) {
                console.log(`[AI Photo] User ${userId} generated image with ${result.provider}`);
            }
            
            res.json({
                success: true,
                provider: result.provider,
                data: {
                    url: result.url,
                    urls: result.urls,
                    jobId: result.jobId,
                    status: result.status
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Generation failed'
            });
        }
    } catch (error) {
        console.error('Photo generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Generate Video
app.post('/api/ai/generate-video', async (req, res) => {
    const { prompt, provider, model, duration, fps, userId } = req.body;
    
    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: 'Prompt is required'
        });
    }
    
    try {
        const result = await aiService.generateVideo(prompt, {
            provider,
            model,
            duration,
            fps
        });
        
        if (result.success) {
            if (userId) {
                console.log(`[AI Video] User ${userId} generated video with ${result.provider}`);
            }
            
            res.json({
                success: true,
                provider: result.provider,
                data: {
                    url: result.url,
                    thumbnail: result.thumbnail,
                    jobId: result.jobId,
                    status: result.status
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Generation failed'
            });
        }
    } catch (error) {
        console.error('Video generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Remove Watermark from Image
app.post('/api/ai/remove-watermark', async (req, res) => {
    const { fileUrl, type, provider, model, userId } = req.body;
    
    if (!fileUrl) {
        return res.status(400).json({
            success: false,
            error: 'File URL is required'
        });
    }
    
    try {
        const result = await aiService.removeWatermark(fileUrl, type || 'image', {
            provider,
            model
        });
        
        if (result.success) {
            if (userId) {
                console.log(`[AI Watermark] User ${userId} removed watermark with ${result.provider}`);
            }
            
            res.json({
                success: true,
                provider: result.provider,
                type: result.type,
                data: {
                    url: result.url,
                    jobId: result.jobId,
                    status: result.status
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Watermark removal failed'
            });
        }
    } catch (error) {
        console.error('Watermark removal error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Check job status (for async operations)
app.get('/api/ai/job-status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { provider } = req.query;
    
    try {
        const result = await aiService.checkJobStatus(jobId, provider || 'bytez');
        res.json({
            success: true,
            jobId,
            status: result.status,
            progress: result.progress,
            url: result.url
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get job result
app.get('/api/ai/job-result/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { provider } = req.query;
    
    try {
        const result = await aiService.getJobResult(jobId, provider || 'bytez');
        res.json({
            success: true,
            jobId,
            url: result.url,
            urls: result.urls,
            metadata: result.metadata
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

console.log('[AI Services] OpenRouter and Bytez API endpoints registered');
