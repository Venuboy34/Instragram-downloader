// Instagram Media Downloader API for Cloudflare Workers
// Supports Instagram posts, reels, and stories

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

    // Get post data
    const postData = await getInstagramPostData(cleanUrl);
    
    if (!postData) {
      throw new Error('Could not fetch post data');
    }

    return {
      success: true,
      data: postData
    };
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
}

function cleanInstagramUrl(url) {
  // Remove tracking parameters and clean URL
  let cleanUrl = url.trim();
  
  // Handle different Instagram URL formats
  if (cleanUrl.includes('instagram.com')) {
    // Remove query parameters
    cleanUrl = cleanUrl.split('?')[0];
    // Ensure it ends with /
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

async function getInstagramPostData(url) {
  try {
    // Method 1: Try Instagram's oembed API first
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`;
    
    try {
      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        const parsedData = parseOembedData(oembedData, url);
        
        // If oembed worked but no media, try scraping
        if (!parsedData.media || parsedData.media.length === 0) {
          const scrapedData = await scrapeInstagramPage(url);
          if (scrapedData && scrapedData.media) {
            parsedData.media = scrapedData.media;
            parsedData.author = scrapedData.author || parsedData.author;
            parsedData.title = scrapedData.title || parsedData.title;
          }
        }
        
        return parsedData;
      }
    } catch (e) {
      console.log('Oembed failed, trying scraping method');
    }

    // Method 2: Scrape the page directly
    return await scrapeInstagramPage(url);
    
  } catch (error) {
    throw new Error(`Failed to fetch Instagram data: ${error.message}`);
  }
}

async function scrapeInstagramPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseInstagramHTML(html, url);

function parseOembedData(oembedData, originalUrl) {
  const media = [];
  
  // Try to extract high-quality media URLs from thumbnail or other fields
  if (oembedData.thumbnail_url) {
    // For videos, thumbnail is usually available but we need the video URL
    if (detectMediaType(originalUrl) === 'reel' || originalUrl.includes('/tv/')) {
      // Try to get video URL by modifying thumbnail URL
      const videoUrl = oembedData.thumbnail_url.replace(/\/s\d+x\d+\//, '/').replace(/\?.*/, '');
      media.push({
        type: 'video',
        url: videoUrl,
        quality: 'hd',
        thumbnail: oembedData.thumbnail_url
      });
    }
    
    // Always add the thumbnail as an image option
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
    thumbnail: oembedData.thumbnail_url || null,
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

    // Method 1: Extract from script tags containing JSON data
    const scriptRegex = /<script[^>]*>window\._sharedData\s*=\s*({.+?});<\/script>/;
    const scriptMatch = html.match(scriptRegex);
    
    if (scriptMatch) {
      try {
        const data = JSON.parse(scriptMatch[1]);
        const parsedData = parseSharedData(data, url);
        if (parsedData && parsedData.media && parsedData.media.length > 0) {
          return parsedData;
        }
      } catch (e) {
        console.log('Failed to parse _sharedData:', e.message);
      }
    }

    // Method 2: Look for newer script tags with different patterns
    const additionalDataRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g;
    let match;
    while ((match = additionalDataRegex.exec(html)) !== null) {
      try {
        const jsonData = JSON.parse(match[1]);
        if (jsonData['@type'] === 'ImageObject' || jsonData['@type'] === 'VideoObject') {
          if (jsonData.contentUrl) {
            media.push({
              type: jsonData['@type'] === 'VideoObject' ? 'video' : 'image',
              url: jsonData.contentUrl,
              quality: 'hd'
            });
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Method 3: Extract from meta tags
    const metaTags = {
      'og:image': [],
      'og:video': [],
      'og:video:secure_url': [],
      'og:title': null,
      'og:description': null,
      'twitter:image': [],
      'twitter:player:stream': []
    };

    // Extract all meta tags
    const metaRegex = /<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]+)"/g;
    let metaMatch;
    while ((metaMatch = metaRegex.exec(html)) !== null) {
      const [, property, content] = metaMatch;
      if (metaTags.hasOwnProperty(property)) {
        if (Array.isArray(metaTags[property])) {
          metaTags[property].push(content);
        } else {
          metaTags[property] = content;
        }
      }
    }

    // Process meta tag data
    title = metaTags['og:title'] || title;
    description = metaTags['og:description'] || description;
    author = extractAuthorFromDescription(description) || author;

    // Add videos first (higher priority)
    [...metaTags['og:video'], ...metaTags['og:video:secure_url'], ...metaTags['twitter:player:stream']]
      .filter(Boolean)
      .forEach(videoUrl => {
        if (!media.some(m => m.url === videoUrl)) {
          media.push({
            type: 'video',
            url: videoUrl,
            quality: 'hd'
          });
        }
      });

    // Add images
    [...metaTags['og:image'], ...metaTags['twitter:image']]
      .filter(Boolean)
      .forEach(imageUrl => {
        if (!media.some(m => m.url === imageUrl)) {
          media.push({
            type: 'image',
            url: imageUrl,
            quality: 'hd'
          });
        }
      });

    // Method 4: Look for direct video/image URLs in the HTML
    const directVideoRegex = /"video_url":"([^"]+)"/g;
    let videoMatch;
    while ((videoMatch = directVideoRegex.exec(html)) !== null) {
      const videoUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      if (!media.some(m => m.url === videoUrl)) {
        media.push({
          type: 'video',
          url: videoUrl,
          quality: 'hd'
        });
      }
    }

    const directImageRegex = /"display_url":"([^"]+)"/g;
    let imageMatch;
    while ((imageMatch = directImageRegex.exec(html)) !== null) {
      const imageUrl = imageMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      if (!media.some(m => m.url === imageUrl)) {
        media.push({
          type: 'image',
          url: imageUrl,
          quality: 'hd'
        });
      }
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
    throw new Error(`Failed to parse Instagram data: ${error.message}`);
  }
}

function parseSharedData(data, url) {
  try {
    const posts = data?.entry_data?.PostPage || data?.entry_data?.ProfilePage;
    if (!posts || !posts[0]) {
      throw new Error('No post data found');
    }

    const post = posts[0]?.graphql?.shortcode_media;
    if (!post) {
      throw new Error('No media data found');
    }

    const media = [];
    
    // Handle carousel posts (multiple images/videos)
    if (post.edge_sidecar_to_children) {
      post.edge_sidecar_to_children.edges.forEach(edge => {
        const node = edge.node;
        if (node.is_video) {
          media.push({
            type: 'video',
            url: node.video_url,
            quality: 'hd',
            thumbnail: node.display_url
          });
        } else {
          media.push({
            type: 'image',
            url: node.display_url,
            quality: 'hd'
          });
        }
      });
    } else {
      // Single media post
      if (post.is_video) {
        media.push({
          type: 'video',
          url: post.video_url,
          quality: 'hd',
          thumbnail: post.display_url
        });
      } else {
        media.push({
          type: 'image',
          url: post.display_url,
          quality: 'hd'
        });
      }
    }

    return {
      title: post.edge_media_to_caption?.edges?.[0]?.node?.text?.substring(0, 100) || 'Instagram Post',
      author: post.owner?.username || 'Unknown',
      type: detectMediaType(url),
      url: url,
      timestamp: new Date(post.taken_at_timestamp * 1000).toISOString(),
      media: media
    };
    
  } catch (error) {
    throw new Error(`Failed to parse shared data: ${error.message}`);
  }
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
        .result {
            margin-top: 20px;
            padding: 20px;
            border-radius: 8px;
            display: none;
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
        
        <button onclick="downloadMedia()">Download Media</button>
        
        <div id="result" class="result"></div>
        
        <div class="endpoints">
            <h3>API Endpoints:</h3>
            
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
            
            if (!url) {
                showResult('Please enter an Instagram URL', 'error');
                return;
            }
            
            try {
                const response = await fetch('/api/download', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: url })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showResult('Media found successfully! Check the console for details.', 'success');
                    console.log('Instagram Media Data:', data.data);
                } else {
                    showResult(\`Error: \${data.error}\`, 'error');
                }
            } catch (error) {
                showResult(\`Network error: \${error.message}\`, 'error');
            }
        }
        
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = message;
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
