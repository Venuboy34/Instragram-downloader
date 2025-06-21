// Instagram Media Downloader API for Cloudflare Workers
// Uses proxy methods for better reliability

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

    // Try multiple methods with proxy approach
    const methods = [
      () => getDataViaOembed(cleanUrl),
      () => getDataViaProxy(cleanUrl),
      () => getDataViaDirect(cleanUrl)
    ];

    let lastError;
    for (const method of methods) {
      try {
        const result = await method();
        if (result && result.media && result.media.length > 0) {
          return { success: true, data: result };
        }
      } catch (error) {
        lastError = error;
        console.log(`Method failed: ${error.message}`);
      }
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
        error: lastError?.message || 'Could not extract media URLs'
      }
    };
    
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
}

// Method 1: Instagram oEmbed API
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

// Method 2: Using a proxy service to bypass restrictions
async function getDataViaProxy(url) {
  // Use a public proxy service
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
  
  return parseInstagramHTML(data.contents, url);
}

// Method 3: Direct fetch with better headers
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
  
  return parseInstagramHTML(html, url);
}

function parseOembedData(oembedData, originalUrl) {
  const media = [];
  
  if (oembedData.thumbnail_url) {
    // For reels/videos, try to get the actual video URL
    if (detectMediaType(originalUrl) === 'reel') {
      media.push({
        type: 'video',
        url: oembedData.thumbnail_url.replace('_n.jpg', '_n.mp4'),
        quality: 'hd',
        thumbnail: oembedData.thumbnail_url
      });
    }
    
    // Always include the thumbnail
    media.push({
      type: 'image',
      url: oembedData.thumbnail_url,
      quality: 'standard'
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

function parseInstagramHTML(html, url) {
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

    // Look for video URLs
    const videoPatterns = [
      /"video_url":"([^"]+)"/g,
      /<meta property="og:video" content="([^"]+)"/g,
      /<meta property="og:video:secure_url" content="([^"]+)"/g,
      /"playback_url":"([^"]+)"/g
    ];

    videoPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let videoUrl = match[1];
        if (videoUrl.includes('\\u0026')) {
          videoUrl = videoUrl.replace(/\\u0026/g, '&');
        }
        if (videoUrl.includes('\\/')) {
          videoUrl = videoUrl.replace(/\\\//g, '/');
        }
        
        if (videoUrl && !media.some(m => m.url === videoUrl)) {
          media.push({
            type: 'video',
            url: videoUrl,
            quality: 'hd'
          });
        }
      }
    });

    // Look for image URLs
    const imagePatterns = [
      /"display_url":"([^"]+)"/g,
      /<meta property="og:image" content="([^"]+)"/g,
      /"thumbnail_url":"([^"]+)"/g
    ];

    imagePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let imageUrl = match[1];
        if (imageUrl.includes('\\u0026')) {
          imageUrl = imageUrl.replace(/\\u0026/g, '&');
        }
        if (imageUrl.includes('\\/')) {
          imageUrl = imageUrl.replace(/\\\//g, '/');
        }
        
        if (imageUrl && !media.some(m => m.url === imageUrl)) {
          media.push({
            type: 'image',
            url: imageUrl,
            quality: 'hd'
          });
        }
      }
    });

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
    <title>Instagram Media Downloader API</title>
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
            max-height: 300px;
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
            padding: 10px;
            background: rgba(255,255,255,0.8);
            border-radius: 8px;
        }
        .media-url {
            word-break: break-all;
            color: #007bff;
            text-decoration: none;
        }
        .media-url:hover {
            text-decoration: underline;
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
    </style>
</head>
<body>
    <div class="container">
        <h1>📸 Instagram Media Downloader</h1>
        <p class="subtitle">Download Instagram posts, reels, and stories in HD quality</p>
        
        <div class="input-group">
            <label for="url">Instagram URL:</label>
            <input type="url" id="url" placeholder="https://www.instagram.com/p/..." />
        </div>
        
        <button onclick="downloadMedia()" id="downloadBtn">Download Media</button>
        <div class="loading" id="loading">Processing... Please wait</div>
        
        <div id="result" class="result"></div>
        
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

            <h4 style="margin-top: 20px;">✨ Features:</h4>
            <ul style="margin-left: 20px; color: #666;">
                <li>Multiple extraction methods with proxy support</li>
                <li>HD quality video and image downloads</li>
                <li>Works with posts, reels, IGTV, and stories</li>
                <li>Automatic fallback if one method fails</li>
            </ul>
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
                data.media.forEach((item, index) => {
                    html += \`
                        <div class="media-item">
                            <strong>\${item.type.toUpperCase()} (\${item.quality})</strong><br>
                            <a href="\${item.url}" target="_blank" class="media-url">\${item.url}</a>
                        </div>
                    \`;
                });
            } else {
                html += '<p style="color: orange;">⚠️ No media URLs found. This might be a private post or Instagram blocked the request.</p>';
                if (data.error) {
                    html += \`<p style="color: #666; font-size: 14px;">Error: \${data.error}</p>\`;
                }
            }
            
            resultDiv.innerHTML = html;
            resultDiv.className = 'result success';
            resultDiv.style.display = 'block';
        }
        
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = message;
            resultDiv.className = \`result \${type}\`;
            resultDiv.style.display = 'block';
        }
        
        // Allow Enter key to submit
        document.getElementById('url').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                downloadMedia();
            }
        });
    </script>
</body>
</html>
  `;
}
