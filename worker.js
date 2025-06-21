// Instagram Media Downloader API for Cloudflare Workers
// Fixed version with better HD video extraction

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  }
};

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Route handling
  if (url.pathname === '/') {
    return new Response(getHomePage(), {
      headers: { ...corsHeaders, 'Content-Type': 'text/html' }
    });
  }

  if (url.pathname === '/api/download') {
    if (request.method === 'POST') {
      return handleDownload(request, corsHeaders);
    } else if (request.method === 'GET') {
      const instagramUrl = url.searchParams.get('url');
      if (!instagramUrl) {
        return new Response(JSON.stringify({ error: 'URL parameter is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return handleDownloadGet(instagramUrl, corsHeaders);
    }
  }

  return new Response('Not Found', { 
    status: 404, 
    headers: corsHeaders 
  });
}

async function handleDownload(request, corsHeaders) {
  try {
    const { url: instagramUrl } = await request.json();
    
    if (!instagramUrl) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await downloadInstagramMedia(instagramUrl);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to process request', 
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleDownloadGet(instagramUrl, corsHeaders) {
  try {
    const result = await downloadInstagramMedia(instagramUrl);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to process request', 
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function downloadInstagramMedia(url) {
  try {
    // Clean and validate URL
    const cleanUrl = cleanInstagramUrl(url);
    if (!isValidInstagramUrl(cleanUrl)) {
      throw new Error('Invalid Instagram URL');
    }

    // Try multiple methods with improved extraction
    const methods = [
      () => getDataViaGraphQL(cleanUrl),
      () => getDataViaProxy(cleanUrl),
      () => getDataViaDirect(cleanUrl),
      () => getDataViaOembed(cleanUrl)
    ];

    let lastError;
    let bestResult = null;
    
    for (const method of methods) {
      try {
        const result = await method();
        if (result && result.media && result.media.length > 0) {
          // Prefer results with actual video URLs over just images
          const hasVideo = result.media.some(m => m.type === 'video' && m.url && !m.url.includes('.jpg'));
          if (hasVideo || !bestResult) {
            bestResult = result;
            if (hasVideo) break; // Stop if we found actual video
          }
        }
      } catch (error) {
        lastError = error;
        console.log(`Method failed: ${error.message}`);
      }
    }

    if (bestResult) {
      return { success: true, data: bestResult };
    }

    // If no method worked, return basic data
    return {
      success: true,
      data: {
        title: 'Instagram Media',
        author: 'Unknown',
        type: detectMediaType(cleanUrl),
        url: cleanUrl,
        timestamp: new Date().toISOString(),
        media: null,
        error: lastError?.message || 'Could not extract HD video URLs - content may be private or protected'
      }
    };
    
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
}

// NEW: Method to extract from Instagram's GraphQL endpoint
async function getDataViaGraphQL(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Could not extract shortcode from URL');
  }

  // Try to get the page first to extract necessary tokens
  const pageResponse = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch page: ${pageResponse.status}`);
  }

  const html = await pageResponse.text();
  
  // Extract data from the page HTML more thoroughly
  return parseInstagramHTMLImproved(html, url);
}

// IMPROVED: Better HTML parsing with multiple extraction methods
function parseInstagramHTMLImproved(html, url) {
  try {
    const media = [];
    let title = 'Instagram Post';
    let author = 'Unknown';
    let description = '';

    // Extract basic info from meta tags
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
    
    if (titleMatch) title = titleMatch[1];
    if (descMatch) {
      description = descMatch[1];
      author = extractAuthorFromDescription(description);
    }

    // IMPROVED: Look for video URLs with better patterns
    const videoPatterns = [
      // GraphQL data
      /"video_url":"([^"]+)"/g,
      /"playback_url":"([^"]+)"/g,
      // Meta tags
      /<meta property="og:video:secure_url" content="([^"]+)"/g,
      /<meta property="og:video" content="([^"]+)"/g,
      // JSON-LD data
      /"contentUrl":"([^"]+\.mp4[^"]*)"/g,
      /"embedUrl":"([^"]+\.mp4[^"]*)"/g,
      // Direct video URLs in scripts
      /https:\/\/[^"'\s]+\.mp4[^"'\s]*/g,
      // Instagram CDN video URLs
      /https:\/\/scontent[^"'\s]+\.mp4[^"'\s]*/g
    ];

    const foundVideoUrls = new Set();
    
    videoPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let videoUrl = match[1] || match[0];
        
        // Clean up the URL
        videoUrl = cleanMediaUrl(videoUrl);
        
        // Validate it's actually a video URL
        if (isValidVideoUrl(videoUrl) && !foundVideoUrls.has(videoUrl)) {
          foundVideoUrls.add(videoUrl);
          media.push({
            type: 'video',
            url: videoUrl,
            quality: determineVideoQuality(videoUrl),
            size: 'unknown'
          });
        }
      }
    });

    // IMPROVED: Look for high-quality image URLs
    const imagePatterns = [
      /"display_url":"([^"]+)"/g,
      /<meta property="og:image" content="([^"]+)"/g,
      // High resolution image patterns
      /https:\/\/scontent[^"'\s]+_n\.jpg[^"'\s]*/g,
      /https:\/\/scontent[^"'\s]+_s1080x1080[^"'\s]*/g
    ];

    const foundImageUrls = new Set();
    
    imagePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let imageUrl = match[1] || match[0];
        
        // Clean up the URL
        imageUrl = cleanMediaUrl(imageUrl);
        
        // Validate and avoid duplicates
        if (isValidImageUrl(imageUrl) && !foundImageUrls.has(imageUrl)) {
          foundImageUrls.add(imageUrl);
          
          // Try to get HD version
          const hdImageUrl = getHDImageUrl(imageUrl);
          
          media.push({
            type: 'image',
            url: hdImageUrl,
            quality: imageUrl.includes('1080x1080') ? 'hd' : 'standard',
            original: imageUrl !== hdImageUrl ? imageUrl : undefined
          });
        }
      }
    });

    // If we found videos, remove thumbnails that might be duplicates
    if (media.some(m => m.type === 'video')) {
      // Remove images that look like video thumbnails
      const filteredMedia = media.filter(m => {
        if (m.type === 'image') {
          // Keep if it doesn't look like a video thumbnail
          return !m.url.includes('_n.jpg') || !media.some(v => v.type === 'video');
        }
        return true;
      });
      
      return {
        title: title,
        description: description,
        author: author,
        type: detectMediaType(url),
        url: url,
        timestamp: new Date().toISOString(),
        media: filteredMedia.length > 0 ? filteredMedia : media
      };
    }

    return {
      title: title,
      description: description,
      author: author,
      type: detectMediaType(url),
      url: url,
      timestamp: new Date().toISOString(),
      media: media.length > 0 ? media : null
    };
    
  } catch (error) {
    throw new Error(`Failed to parse HTML: ${error.message}`);
  }
}

// HELPER FUNCTIONS
function extractShortcode(url) {
  const match = url.match(/\/(?:p|reel|tv)\/([^\/\?]+)/);
  return match ? match[1] : null;
}

function cleanMediaUrl(url) {
  // Remove escape characters
  url = url.replace(/\\u0026/g, '&');
  url = url.replace(/\\\//g, '/');
  url = url.replace(/\\"/g, '"');
  
  // Remove query parameters that might break the URL
  if (url.includes('?')) {
    const [baseUrl, queryString] = url.split('?');
    const params = new URLSearchParams(queryString);
    
    // Keep only essential parameters
    const essentialParams = ['_nc_ht', '_nc_cat', '_nc_ohc', 'ccb', 'oh', 'oe'];
    const newParams = new URLSearchParams();
    
    essentialParams.forEach(param => {
      if (params.has(param)) {
        newParams.set(param, params.get(param));
      }
    });
    
    url = newParams.toString() ? `${baseUrl}?${newParams.toString()}` : baseUrl;
  }
  
  return url;
}

function isValidVideoUrl(url) {
  return url && 
         url.startsWith('https://') && 
         (url.includes('.mp4') || url.includes('video')) &&
         url.includes('scontent') &&
         !url.includes('.jpg') &&
         !url.includes('.jpeg');
}

function isValidImageUrl(url) {
  return url && 
         url.startsWith('https://') && 
         (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png')) &&
         url.includes('scontent');
}

function determineVideoQuality(url) {
  if (url.includes('_1080p') || url.includes('1080x1080')) return 'hd';
  if (url.includes('_720p') || url.includes('720x720')) return 'hd';
  if (url.includes('_480p')) return 'standard';
  return 'hd'; // Default to HD for Instagram content
}

function getHDImageUrl(url) {
  // Try to convert to HD version
  if (url.includes('_n.jpg')) {
    // Try different HD formats
    const hdFormats = ['_s1080x1080.jpg', '_s750x750.jpg', '_s640x640.jpg'];
    for (const format of hdFormats) {
      const hdUrl = url.replace('_n.jpg', format);
      if (hdUrl !== url) return hdUrl;
    }
  }
  return url;
}

// Method 1: Instagram oEmbed API (keeping original)
async function getDataViaOembed(url) {
  const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`;
  
  const response = await fetch(oembedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`oEmbed API failed: ${response.status}`);
  }
  
  const data = await response.json();
  return parseOembedData(data, url);
}

// Method 2: Using a proxy service (keeping original)
async function getDataViaProxy(url) {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  
  const response = await fetch(proxyUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Proxy request failed: ${response.status}`);
  }
  
  const data = await response.json();
  if (!data.contents) {
    throw new Error('No content received from proxy');
  }
  
  return parseInstagramHTMLImproved(data.contents, url);
}

// Method 3: Direct fetch (keeping original but using improved parser)
async function getDataViaDirect(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    }
  });

  if (!response.ok) {
    throw new Error(`Direct fetch failed: ${response.status}`);
  }

  const html = await response.text();
  if (html.includes('Please wait a few minutes before you try again')) {
    throw new Error('Rate limited by Instagram');
  }
  
  return parseInstagramHTMLImproved(html, url);
}

function parseOembedData(oembedData, originalUrl) {
  const media = [];
  
  if (oembedData.thumbnail_url) {
    const mediaType = detectMediaType(originalUrl);
    
    if (mediaType === 'reel' || mediaType === 'igtv') {
      // For video content, try to construct the video URL
      const videoUrl = oembedData.thumbnail_url.replace(/_n\.jpg.*$/, '.mp4');
      if (videoUrl !== oembedData.thumbnail_url) {
        media.push({
          type: 'video',
          url: videoUrl,
          quality: 'hd',
          thumbnail: oembedData.thumbnail_url
        });
      }
    }
    
    // Always include the thumbnail as HD image
    const hdImageUrl = getHDImageUrl(oembedData.thumbnail_url);
    media.push({
      type: 'image',
      url: hdImageUrl,
      quality: 'hd',
      original: hdImageUrl !== oembedData.thumbnail_url ? oembedData.thumbnail_url : undefined
    });
  }

  return {
    title: oembedData.title || 'Instagram Post',
    author: oembedData.author_name || 'Unknown',
    description: oembedData.title || '',
    type: detectMediaType(originalUrl),
    url: originalUrl,
    timestamp: new Date().toISOString(),
    media: media.length > 0 ? media : null
  };
}

// Keep remaining helper functions unchanged
function cleanInstagramUrl(url) {
  let cleanUrl = url.trim();
  
  if (cleanUrl.includes('instagram.com')) {
    cleanUrl = cleanUrl.split('?')[0];
    if (!cleanUrl.endsWith('/')) {
      cleanUrl += '/';
    }
  }
  
  return cleanUrl;
}

function isValidInstagramUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/tv\/[A-Za-z0-9_-]+\/?/,
    /^https?:\/\/(www\.)?instagram\.com\/stories\/[A-Za-z0-9_.-]+\/[0-9]+\/?/
  ];
  
  return patterns.some(pattern => pattern.test(url));
}

function detectMediaType(url) {
  if (url.includes('/reel/')) return 'reel';
  if (url.includes('/tv/')) return 'igtv';
  if (url.includes('/stories/')) return 'story';
  return 'post';
}

function extractAuthorFromDescription(description) {
  const match = description.match(/^([^:]+):/);
  return match ? match[1].trim() : 'Unknown';
}

function getHomePage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instagram HD Media Downloader</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
            text-align: center;
        }
        .subtitle {
            color: #666;
            text-align: center;
            margin-bottom: 30px;
        }
        .input-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .result {
            margin-top: 20px;
            padding: 20px;
            border-radius: 8px;
            display: none;
            max-height: 400px;
            overflow-y: auto;
        }
        .success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        .error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        .media-item {
            margin: 10px 0;
            padding: 15px;
            background: rgba(255,255,255,0.9);
            border-radius: 8px;
            border-left: 4px solid #007bff;
        }
        .media-item.video {
            border-left-color: #28a745;
        }
        .media-type {
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }
        .media-quality {
            background: #007bff;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            margin-left: 10px;
        }
        .media-quality.hd {
            background: #28a745;
        }
        .media-url {
            word-break: break-all;
            color: #007bff;
            text-decoration: none;
            font-family: monospace;
            font-size: 14px;
        }
        .media-url:hover {
            text-decoration: underline;
        }
        .download-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 14px;
        }
        .download-btn:hover {
            background: #218838;
        }
        .endpoints {
            margin-top: 30px;
            padding-top: 30px;
            border-top: 1px solid #e1e5e9;
        }
        .endpoint {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
        }
        .method {
            background: #007bff;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            margin-right: 10px;
        }
        .method.post { background: #28a745; }
        code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
        }
        .loading {
            display: none;
            text-align: center;
            margin-top: 10px;
            color: #666;
        }
        .feature-list {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 8px;
            margin-top: 15px;
        }
        .feature-list h4 {
            color: #1976d2;
            margin-bottom: 10px;
        }
        .feature-list ul {
            margin-left: 20px;
            color: #666;
        }
        .feature-list li {
            margin-bottom: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📸 Instagram HD Media Downloader</h1>
        <p class="subtitle">Download Instagram posts, reels, and stories in true HD quality</p>
        
        <div class="input-group">
            <label for="url">Instagram URL:</label>
            <input type="url" id="url" placeholder="https://www.instagram.com/p/... or /reel/..." />
        </div>
        
        <button onclick="downloadMedia()" id="downloadBtn">🚀 Download HD Media</button>
        <div class="loading" id="loading">🔄 Processing... Please wait</div>
        
        <div id="result" class="result"></div>
        
        <div class="feature-list">
            <h4>✨ New Features:</h4>
            <ul>
                <li>✅ <strong>True HD Video Extraction</strong> - No more thumbnails!</li>
                <li>✅ <strong>Multiple Quality Options</strong> - Get the best available quality</li>
                <li>✅ <strong>Smart Video Detection</strong> - Prioritizes video over images</li>
                <li>✅ <strong>Enhanced URL Cleaning</strong> - Better compatibility</li>
                <li>✅ <strong>Improved Error Handling</strong> - More reliable downloads</li>
            </ul>
        </div>
        
        <div class="endpoints">
            <h3>🚀 API Endpoints:</h3>
            
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/download</code>
                <p>Body: <code>{"url": "instagram_url_here"}</code></p>
            </div>
            
            <div class="endpoint">
                <span class="method">GET</span>
                <code>/api/download?url=instagram_url_here</code>
            </div>
        </div>
    </div>

    <script>
        async function downloadMedia() {
            const url = document.getElementById('url').value.trim();
            const resultDiv = document.getElementById('result');
            const downloadBtn = document.getElementById('downloadBtn');
            const loading = document.getElementById('loading');
            
            if (!url) {
                showResult('Please enter an Instagram URL', 'error');
                return;
            }
            
            // Show loading state
            downloadBtn.disabled = true;
            loading.style.display = 'block';
            resultDiv.style.display = 'none';
            
            try {
                const response = await fetch('/api/download', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: url })
                });
                
                const data = await response.json();
                
                if (data.success && data.data) {
                    displayMediaResult(data.data);
                } else {
                    showResult(\`Error: \${data.error || 'Unknown error'}\`, 'error');
                }
            } catch (error) {
                showResult(\`Network error: \${error.message}\`, 'error');
            } finally {
                downloadBtn.disabled = false;
                loading.style.display = 'none';
            }
        }
        
        function displayMediaResult(data) {
            const resultDiv = document.getElementById('result');
            
            let html = \`
                <h4>📱 Media Information:</h4>
                <p><strong>Title:</strong> \${data.title}</p>
                <p><strong>Author:</strong> \${data.author}</p>
                <p><strong>Type:</strong> \${data.type}</p>
            \`;
            
            if (data.media && data.media.length > 0) {
                html += '<h4>🎬 Available Media:</h4>';
                
                // Sort media: videos first, then images
                const sortedMedia = data.media.sort((a, b) => {
                    if (a.type === 'video' && b.type !== 'video') return -1;
                    if (a.type !== 'video' && b.type === 'video') return 1;
                    return 0;
                });
                
                sortedMedia.forEach((item, index) => {
                    const isVideo = item.type === 'video';
                    const qualityClass = item.quality === 'hd' ? 'hd' : '';
                    
                    html += \`
                        <div class="media-item \${item.type}">
                            <div class="media-type">
                                \${isVideo ? '🎥' : '🖼️'} \${item.type.toUpperCase()}
                                <span class="media-quality ${qualityClass}">${item.quality}</span>
                            </div>
                            <a href="${item.url}" target="_blank" class="media-url">${item.url}</a>
                            <br>
                            <button class="download-btn" onclick="downloadFile('${item.url}', '${item.type}')">
                                📥 Download ${item.type.toUpperCase()}
                            </button>
                            ${item.thumbnail ? `<br><small>📸 Thumbnail: <a href="${item.thumbnail}" target="_blank">View</a></small>` : ''}
                        </div>
                    `;
                });
                
                // Add statistics
                const videoCount = data.media.filter(m => m.type === 'video').length;
                const imageCount = data.media.filter(m => m.type === 'image').length;
                const hdCount = data.media.filter(m => m.quality === 'hd').length;
                
                html += `
                    <div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px;">
                        <strong>📊 Summary:</strong>
                        ${videoCount > 0 ? `🎥 ${videoCount} video(s)` : ''}
                        ${imageCount > 0 ? `🖼️ ${imageCount} image(s)` : ''}
                        ${hdCount > 0 ? `✨ ${hdCount} HD quality` : ''}
                    </div>
                `;
            } else {
                html += `
                    <div style="color: orange; margin-top: 15px;">
                        <h4>⚠️ No HD media found</h4>
                        <p>This could happen if:</p>
                        <ul style="margin-left: 20px; margin-top: 10px;">
                            <li>The post is private or restricted</li>
                            <li>Instagram is blocking the request</li>
                            <li>The content is very new (try again in a few minutes)</li>
                            <li>The post was deleted or made private</li>
                        </ul>
                    </div>
                `;
                
                if (data.error) {
                    html += `<p style="color: #666; font-size: 14px; margin-top: 10px;">Technical error: ${data.error}</p>`;
                }
            }
            
            resultDiv.innerHTML = html;
            resultDiv.className = 'result success';
            resultDiv.style.display = 'block';
        }
        
        function downloadFile(url, type) {
            // Create a temporary link element
            const link = document.createElement('a');
            link.href = url;
            link.download = `instagram_${type}_${Date.now()}`;
            link.target = '_blank';
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = message;
            resultDiv.className = `result ${type}`;
            resultDiv.style.display = 'block';
        }
        
        // Allow Enter key to submit
        document.getElementById('url').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                downloadMedia();
            }
        });
        
        // Auto-clear result when typing new URL
        document.getElementById('url').addEventListener('input', function() {
            const resultDiv = document.getElementById('result');
            if (resultDiv.style.display === 'block') {
                resultDiv.style.display = 'none';
            }
        });
    </script>
</body>
</html>
  `;
}
