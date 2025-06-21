// Instagram Video Downloader API for Cloudflare Workers
// Enhanced version with video details only - no thumbnails

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
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Route handling - only API endpoints
  if (url.pathname === '/api/download') {
    if (request.method === 'POST') {
      return handleDownload(request, corsHeaders);
    } else if (request.method === 'GET') {
      const instagramUrl = url.searchParams.get('url');
      if (!instagramUrl) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'URL parameter is required',
          message: 'Please provide an Instagram URL',
          example: '/api/download?url=https://instagram.com/reel/ABC123/'
        }), {
          status: 400,
          headers: corsHeaders
        });
      }
      return handleDownloadGet(instagramUrl, corsHeaders);
    }
  }

  // Video proxy endpoint to handle signed URLs
  if (url.pathname === '/api/video-proxy') {
    if (request.method === 'GET') {
      const videoUrl = url.searchParams.get('url');
      const referer = url.searchParams.get('referer');
      
      if (!videoUrl) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Video URL parameter is required'
        }), {
          status: 400,
          headers: corsHeaders
        });
      }
      
      return handleVideoProxy(videoUrl, referer, corsHeaders);
    }
  }

  // Root endpoint - API info
  if (url.pathname === '/') {
    return new Response(JSON.stringify({
      success: true,
      service: 'Instagram Video Downloader API',
      version: '3.0',
      description: 'Extract HD videos and details from Instagram posts, reels, and IGTV',
      endpoints: {
        'POST /api/download': {
          description: 'Download Instagram videos with full details',
          body: { url: 'instagram_url_here' }
        },
        'GET /api/download': {
          description: 'Download Instagram videos via URL parameter',
          parameter: 'url=instagram_url_here'
        },
        'GET /api/video-proxy': {
          description: 'Proxy signed video URLs with proper headers',
          parameters: 'url=video_url_here&referer=instagram_post_url'
        }
      },
      features: [
        'HD video extraction with fallbacks',
        'Video metadata (duration, dimensions)',
        'Author and caption details',
        'Multiple extraction methods with retry logic',
        'Rate limit handling'
      ]
    }), {
      headers: corsHeaders
    });
  }

  return new Response(JSON.stringify({
    success: false,
    error: 'Endpoint not found',
    message: 'Available endpoints: GET|POST /api/download, GET /api/video-proxy'
  }), { 
    status: 404, 
    headers: corsHeaders 
  });
}

async function handleVideoProxy(videoUrl, referer, corsHeaders) {
  try {
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Instagram 302.0.0.23.103 Android (33/13; 420dpi; 1080x2400; samsung; SM-G998B; t2s; qcom; en_US; 302008103)',
        'Referer': referer || 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
        'Accept': 'video/mp4,video/*,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'DNT': '1',
        'Connection': 'keep-alive'
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to fetch video',
        status: response.status,
        statusText: response.statusText
      }), {
        status: response.status,
        headers: corsHeaders
      });
    }

    // Return the video with proper headers
    const videoHeaders = {
      'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
      'Content-Length': response.headers.get('Content-Length'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders
    };

    // Remove null headers
    Object.keys(videoHeaders).forEach(key => {
      if (videoHeaders[key] === null) {
        delete videoHeaders[key];
      }
    });

    return new Response(response.body, {
      headers: videoHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Video proxy failed',
      message: error.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleDownload(request, corsHeaders) {
  try {
    const { url: instagramUrl } = await request.json();
    
    if (!instagramUrl) {
      return new Response(JSON.stringify({
        success: false,
        error: 'URL is required',
        message: 'Please provide an Instagram URL in the request body'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const result = await downloadInstagramVideo(instagramUrl);
    
    return new Response(JSON.stringify(result), {
      headers: corsHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Failed to process request', 
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleDownloadGet(instagramUrl, corsHeaders) {
  try {
    const result = await downloadInstagramVideo(instagramUrl);
    
    return new Response(JSON.stringify(result), {
      headers: corsHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Failed to process request', 
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function downloadInstagramVideo(url) {
  try {
    // Clean and validate URL
    const cleanUrl = cleanInstagramUrl(url);
    if (!isValidInstagramUrl(cleanUrl)) {
      return {
        success: false,
        error: 'Invalid Instagram URL',
        message: 'Please provide a valid Instagram post, reel, or IGTV URL',
        provided_url: url
      };
    }

    // Try multiple methods with retry logic and delays
    const methods = [
      { name: 'Direct', func: () => getDataViaDirect(cleanUrl) },
      { name: 'Proxy', func: () => getDataViaProxy(cleanUrl) },
      { name: 'Alternative', func: () => getDataViaAlternative(cleanUrl) },
      { name: 'Embed', func: () => getDataViaEmbed(cleanUrl) }
    ];

    let lastError;
    let bestResult = null;

    for (const method of methods) {
      try {
        console.log(`Trying ${method.name} method...`);
        const result = await method.func();
        
        if (result && result.video_url) {
          // Validate and potentially proxy the video URL
          result.video_url = await validateAndProxyVideoUrl(result.video_url, cleanUrl);
          
          return {
            success: true,
            data: result,
            method_used: method.name,
            timestamp: new Date().toISOString()
          };
        } else if (!bestResult) {
          bestResult = result;
        }
      } catch (error) {
        lastError = error;
        console.log(`${method.name} method failed: ${error.message}`);
        
        // Add delay between methods to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Return best result found or basic data
    if (bestResult) {
      return {
        success: true,
        data: bestResult,
        method_used: 'fallback',
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: false,
      error: 'No video content found',
      message: 'Could not extract video URLs from this Instagram post',
      url: cleanUrl,
      details: lastError?.message || 'All extraction methods failed',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    return {
      success: false,
      error: 'Download failed',
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Enhanced direct fetch with better headers and retry logic
async function getDataViaDirect(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1 Instagram 302.0.0.23.103',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Direct fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  
  if (html.includes('Please wait a few minutes before you try again')) {
    throw new Error('Rate limited by Instagram');
  }
  
  if (html.includes('Page Not Found') || html.includes('Sorry, this page')) {
    throw new Error('Instagram post not found or private');
  }
  
  return parseInstagramHTML(html, url);
}

// Enhanced proxy method with multiple services
async function getDataViaProxy(url) {
  const proxyServices = [
    {
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      parseKey: 'contents'
    },
    {
      url: `https://corsproxy.io/?${encodeURIComponent(url)}`,
      parseKey: null
    },
    {
      url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      parseKey: null
    }
  ];

  for (const proxy of proxyServices) {
    try {
      const response = await fetch(proxy.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
        }
      });
      
      if (!response.ok) continue;
      
      let html;
      if (proxy.parseKey) {
        const data = await response.json();
        html = data[proxy.parseKey];
      } else {
        html = await response.text();
      }
      
      if (typeof html === 'string' && html.length > 1000 && html.includes('instagram')) {
        return parseInstagramHTML(html, url);
      }
    } catch (error) {
      continue;
    }
  }
  
  throw new Error('All proxy services failed');
}

// Alternative method using different approach
async function getDataViaAlternative(url) {
  // Extract shortcode and try different Instagram endpoints
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Could not extract shortcode');
  }

  // Try multiple Instagram endpoints
  const endpoints = [
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    `https://www.instagram.com/api/v1/media/${shortcode}/info/`,
    `https://i.instagram.com/api/v1/media/${shortcode}/info/`,
    `https://www.instagram.com/p/${shortcode}/?__a=1`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Instagram 302.0.0.23.103 Android (33/13; 420dpi; 1080x2400; samsung; SM-G998B; t2s; qcom; en_US; 302008103)',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Instagram-AJAX': '1',
          'X-CSRFToken': 'missing',
          'X-IG-App-ID': '936619743392459'
        }
      });

      if (response.ok) {
        try {
          const data = await response.json();
          if (data.items && data.items[0]) {
            return parseInstagramAPIData(data.items[0], url);
          } else if (data.graphql && data.graphql.shortcode_media) {
            return parseGraphQLData(data.graphql.shortcode_media, url);
          }
        } catch (e) {
          // Try parsing as HTML if JSON fails
          const html = await response.text();
          if (html.length > 1000) {
            return parseInstagramHTML(html, url);
          }
        }
      }
    } catch (error) {
      console.log(`Endpoint ${endpoint} failed: ${error.message}`);
      continue;
    }
  }

  throw new Error('All alternative endpoints failed');
}

// Embed method with better construction
async function getDataViaEmbed(url) {
  // Try direct embed URL construction
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Could not extract shortcode');
  }

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
  
  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Embed fetch failed: ${response.status}`);
  }
  
  const html = await response.text();
  return parseInstagramHTML(html, url);
}

function parseGraphQLData(media, originalUrl) {
  const result = {
    title: 'Instagram Video',
    author: 'Unknown',
    description: '',
    post_type: detectMediaType(originalUrl),
    original_url: originalUrl,
    video_url: null,
    video_details: null
  };

  // Extract user info
  if (media.owner) {
    result.author = media.owner.username || 'Unknown';
    result.title = `${result.author}'s Instagram ${result.post_type}`;
  }

  // Extract caption
  if (media.edge_media_to_caption && media.edge_media_to_caption.edges[0]) {
    const caption = media.edge_media_to_caption.edges[0].node.text;
    result.description = caption.substring(0, 300) + (caption.length > 300 ? '...' : '');
  }

  // Extract video data
  if (media.video_url) {
    result.video_url = media.video_url;
    result.video_details = {
      width: media.dimensions?.width || null,
      height: media.dimensions?.height || null,
      duration: media.video_duration || null,
      view_count: media.video_view_count || null
    };
  }

  return result;
}

function parseInstagramAPIData(apiData, originalUrl) {
  const result = {
    title: 'Instagram Video',
    author: 'Unknown',
    description: '',
    post_type: detectMediaType(originalUrl),
    original_url: originalUrl,
    video_url: null,
    video_details: null
  };

  // Extract user info
  if (apiData.user) {
    result.author = apiData.user.username || 'Unknown';
    result.title = `${result.author}'s Instagram ${result.post_type}`;
  }

  // Extract caption
  if (apiData.caption && apiData.caption.text) {
    result.description = apiData.caption.text.substring(0, 300) + 
                        (apiData.caption.text.length > 300 ? '...' : '');
  }

  // Extract video data
  if (apiData.video_versions && apiData.video_versions.length > 0) {
    // Get highest quality video
    const bestVideo = apiData.video_versions.reduce((best, current) => 
      (current.width * current.height) > (best.width * best.height) ? current : best
    );
    
    result.video_url = bestVideo.url;
    result.video_details = {
      width: bestVideo.width,
      height: bestVideo.height,
      duration: apiData.video_duration || null,
      view_count: apiData.view_count || null
    };
  }

  return result;
}

function parseInstagramHTML(html, url) {
  try {
    const result = {
      title: 'Instagram Video',
      author: 'Unknown',
      description: '',
      post_type: detectMediaType(url),
      original_url: url,
      video_url: null,
      video_details: null
    };

    // Extract basic info from meta tags
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);
    const videoMatch = html.match(/<meta property="og:video" content="([^"]+)"/i);
    
    if (titleMatch) {
      result.title = titleMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      result.author = extractAuthorFromTitle(result.title);
    }
    
    if (descMatch) {
      result.description = descMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      if (!result.author || result.author === 'Unknown') {
        result.author = extractAuthorFromDescription(result.description);
      }
    }

    // Extract video from og:video
    if (videoMatch) {
      result.video_url = videoMatch[1];
    }

    // Enhanced video URL extraction from script tags
    const videoPatterns = [
      /"video_url":"([^"]+)"/g,
      /"playback_url":"([^"]+)"/g,
      /"video_versions":\[.*?"url":"([^"]+)"/g,
      /"video_versions":\[{"type":"[^"]+","url":"([^"]+)"/g,
      /"src":"([^"]+\.mp4[^"]*)"/g,
      /video_url&quot;:&quot;([^&]+)/g,
      /"videoUrl":"([^"]+)"/g,
      /"contentUrl":"([^"]+\.mp4[^"]*)"/g,
      /https:\/\/[^"]*\.mp4[^"]*/g,
      /"dash_manifest":"([^"]+)"/g,
      /"hls_manifest":"([^"]+)"/g
    ];

    videoPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let videoUrl = match[1] || match[0];
        
        // Clean up the URL
        videoUrl = videoUrl.replace(/\\u0026/g, '&');
        videoUrl = videoUrl.replace(/\\\//g, '/');
        videoUrl = videoUrl.replace(/\\"/g, '"');
        videoUrl = videoUrl.replace(/&quot;/g, '"');
        videoUrl = videoUrl.replace(/&amp;/g, '&');
        
        // Skip non-video URLs
        if (!videoUrl.includes('.mp4') && !videoUrl.includes('video') && !videoUrl.includes('manifest')) continue;
        if (videoUrl.includes('thumbnail') || videoUrl.includes('_n.jpg') || videoUrl.includes('photo')) continue;
        
        // Prioritize .mp4 URLs
        if (videoUrl.includes('.mp4') && !result.video_url) {
          result.video_url = videoUrl;
        } else if (!result.video_url && (videoUrl.includes('video') || videoUrl.includes('manifest'))) {
          result.video_url = videoUrl;
        }
      }
    });

    // Additional fallback: Look for any video URLs in script content
    if (!result.video_url) {
      const scriptMatches = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
      for (const script of scriptMatches) {
        const videoUrlMatch = script.match(/https:\/\/[^"'\s]*video[^"'\s]*\.mp4[^"'\s]*/i) ||
                             script.match(/https:\/\/[^"'\s]*\.mp4[^"'\s]*/i);
        if (videoUrlMatch) {
          result.video_url = videoUrlMatch[0];
          break;
        }
      }
    }

    // Extract video dimensions and duration
    const dimensionMatch = html.match(/"dimensions":{"height":(\d+),"width":(\d+)}/);
    const durationMatch = html.match(/"video_duration":([0-9.]+)/);
    const viewCountMatch = html.match(/"video_view_count":(\d+)/);

    if (dimensionMatch || durationMatch || viewCountMatch) {
      result.video_details = {};
      if (dimensionMatch) {
        result.video_details.height = parseInt(dimensionMatch[1]);
        result.video_details.width = parseInt(dimensionMatch[2]);
      }
      if (durationMatch) {
        result.video_details.duration = parseFloat(durationMatch[1]);
      }
      if (viewCountMatch) {
        result.video_details.view_count = parseInt(viewCountMatch[1]);
      }
    }

    return result;
    
  } catch (error) {
    throw new Error(`Failed to parse HTML: ${error.message}`);
  }
}

function extractShortcode(url) {
  const match = url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
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
  // Handle the format "91K likes, 60 comments - username on April 7, 2025"
  let match = description.match(/- ([^:]+) on \w+ \d+, \d+/);
  if (match) return match[1].trim();
  
  // Handle the format "username: caption text"
  match = description.match(/^([^:•]+)[:•]/);
  if (match) return match[1].trim();
  
  // Handle format with likes and comments first
  match = description.match(/^\d+[KM]? likes, \d+ comments - ([^:]+):/);
  if (match) return match[1].trim();
  
  return 'Unknown';
}

function extractAuthorFromTitle(title) {
  // Handle the format "&#064;username on Instagram: "caption""
  let match = title.match(/&#064;([^:]+) on Instagram:/);
  if (match) return match[1].trim();
  
  // Handle the format "@username on Instagram: "caption""
  match = title.match(/@([^:]+) on Instagram:/);
  if (match) return match[1].trim();
  
  // Handle the format "username's Instagram"
  match = title.match(/^([^']+)'s?\s+Instagram/i);
  if (match) return match[1].trim();
  
  return 'Unknown';
}
