// Instagram Video Downloader API for Cloudflare Workers
// Video-only extraction with clean JSON responses

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
          message: 'Please provide an Instagram URL'
        }), {
          status: 400,
          headers: corsHeaders
        });
      }
      return handleDownloadGet(instagramUrl, corsHeaders);
    }
  }

  // Root endpoint - API info
  if (url.pathname === '/') {
    return new Response(JSON.stringify({
      success: true,
      service: 'Instagram Video Downloader API',
      version: '2.0',
      description: 'Extract HD video URLs from Instagram posts, reels, and IGTV',
      endpoints: {
        'POST /api/download': {
          description: 'Download Instagram videos',
          body: { url: 'instagram_url_here' }
        },
        'GET /api/download': {
          description: 'Download Instagram videos via URL parameter',
          parameter: 'url=instagram_url_here'
        }
      },
      features: [
        'HD video extraction only',
        'Multiple extraction methods',
        'Clean JSON responses',
        'Supports posts, reels, IGTV'
      ]
    }), {
      headers: corsHeaders
    });
  }

  return new Response(JSON.stringify({
    success: false,
    error: 'Endpoint not found',
    message: 'Available endpoints: GET|POST /api/download'
  }), { 
    status: 404, 
    headers: corsHeaders 
  });
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

    // Try multiple methods in order of reliability for HD video content
    const methods = [
      () => getVideoViaDirect(cleanUrl),
      () => getVideoViaGraphQL(cleanUrl),
      () => getVideoViaProxy(cleanUrl),
      () => getVideoViaOembed(cleanUrl)
    ];

    let lastError;
    let bestResult = null;

    for (const method of methods) {
      try {
        const result = await method();
        if (result && result.videos && result.videos.length > 0) {
          // Check if this method found HD video content
          const hasHDVideo = result.videos.some(v => 
            v.quality === 'hd' || v.quality === 'high'
          );
          
          if (hasHDVideo) {
            return {
              success: true,
              data: result,
              timestamp: new Date().toISOString()
            };
          } else if (!bestResult) {
            bestResult = result;
          }
        }
      } catch (error) {
        lastError = error;
        console.log(`Method failed: ${error.message}`);
      }
    }

    // Return best result found
    if (bestResult && bestResult.videos && bestResult.videos.length > 0) {
      return {
        success: true,
        data: bestResult,
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

// Enhanced direct fetch with mobile user agent for better results
async function getVideoViaDirect(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
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
  
  return parseInstagramHTMLForVideo(html, url);
}

// GraphQL method for video extraction
async function getVideoViaGraphQL(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Could not extract shortcode');
  }

  const graphqlUrl = `https://www.instagram.com/graphql/query/`;
  
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    body: `variables={"shortcode":"${shortcode}"}&query_hash=b3055c01b4b222b8a47dc12b090e4e64`
  });

  if (response.ok) {
    const data = await response.json();
    if (data.data && data.data.shortcode_media) {
      return parseGraphQLDataForVideo(data.data.shortcode_media, url);
    }
  }

  throw new Error('GraphQL method failed');
}

// Proxy method for video extraction
async function getVideoViaProxy(url) {
  const proxyServices = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    `https://cors-anywhere.herokuapp.com/${url}`
  ];

  for (const proxyUrl of proxyServices) {
    try {
      const response = await fetch(proxyUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
        }
      });
      
      if (!response.ok) continue;
      
      const data = await response.json();
      const html = data.contents || data.text || data;
      
      if (typeof html === 'string' && html.length > 1000) {
        return parseInstagramHTMLForVideo(html, url);
      }
    } catch (error) {
      continue;
    }
  }
  
  throw new Error('All proxy services failed');
}

// oEmbed method for video extraction
async function getVideoViaOembed(url) {
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
  return parseOembedDataForVideo(data, url);
}

function parseGraphQLDataForVideo(mediaData, originalUrl) {
  const videos = [];
  let title = 'Instagram Video';
  let author = 'Unknown';
  let description = '';

  if (mediaData.owner && mediaData.owner.username) {
    author = mediaData.owner.username;
  }

  if (mediaData.edge_media_to_caption && mediaData.edge_media_to_caption.edges[0]) {
    const caption = mediaData.edge_media_to_caption.edges[0].node.text;
    description = caption.substring(0, 200) + (caption.length > 200 ? '...' : '');
    title = `${author}'s Instagram ${detectMediaType(originalUrl)}`;
  }

  // Extract video URLs (highest quality first)
  if (mediaData.is_video && mediaData.video_url) {
    videos.push({
      url: mediaData.video_url,
      quality: 'hd',
      width: mediaData.dimensions?.width,
      height: mediaData.dimensions?.height,
      duration: mediaData.video_duration || null
    });
  }

  // Handle carousel posts with videos
  if (mediaData.edge_sidecar_to_children) {
    mediaData.edge_sidecar_to_children.edges.forEach(edge => {
      const child = edge.node;
      if (child.is_video && child.video_url) {
        videos.push({
          url: child.video_url,
          quality: 'hd',
          width: child.dimensions?.width,
          height: child.dimensions?.height,
          duration: child.video_duration || null
        });
      }
    });
  }

  return {
    title,
    description,
    author,
    post_type: detectMediaType(originalUrl),
    original_url: originalUrl,
    videos: videos,
    video_count: videos.length
  };
}

function parseInstagramHTMLForVideo(html, url) {
  try {
    const videos = [];
    let title = 'Instagram Video';
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

    // Enhanced video URL extraction patterns - only for videos
    const videoPatterns = [
      /"video_url":"([^"]+)"/g,
      /"playback_url":"([^"]+)"/g,
      /"src":"([^"]+\.mp4[^"]*)"/g,
      /<meta property="og:video" content="([^"]+)"/g,
      /<meta property="og:video:secure_url" content="([^"]+)"/g,
      /"video_versions":\[{"type":"[^"]+","url":"([^"]+)"/g,
      /"video_dash_manifest":"([^"]+)"/g
    ];

    // Look for HD video URLs
    videoPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let videoUrl = match[1];
        
        // Clean up the URL
        videoUrl = videoUrl.replace(/\\u0026/g, '&');
        videoUrl = videoUrl.replace(/\\\//g, '/');
        videoUrl = videoUrl.replace(/\\"/g, '"');
        
        // Skip thumbnail URLs and non-video content
        if (videoUrl.includes('thumbnail') || 
            videoUrl.includes('_n.jpg') || 
            videoUrl.includes('.jpg') ||
            videoUrl.includes('.jpeg') ||
            videoUrl.includes('.png')) {
          continue;
        }
        
        // Only include actual video files
        if (!videoUrl.includes('.mp4') && !videoUrl.includes('video')) {
          continue;
        }
        
        // Determine quality based on URL patterns
        let quality = 'standard';
        if (videoUrl.includes('_hd.mp4') || 
            videoUrl.includes('720p') || 
            videoUrl.includes('1080p') ||
            videoUrl.includes('high')) {
          quality = 'hd';
        }
        
        if (videoUrl && !videos.some(v => v.url === videoUrl)) {
          videos.push({
            url: videoUrl,
            quality: quality,
            format: 'mp4'
          });
        }
      }
    });

    // Sort videos by quality (HD first)
    videos.sort((a, b) => {
      if (a.quality === 'hd' && b.quality !== 'hd') return -1;
      if (a.quality !== 'hd' && b.quality === 'hd') return 1;
      return 0;
    });

    return {
      title,
      description,
      author,
      post_type: detectMediaType(url),
      original_url: url,
      videos: videos,
      video_count: videos.length
    };
    
  } catch (error) {
    throw new Error(`Failed to parse HTML: ${error.message}`);
  }
}

function parseOembedDataForVideo(oembedData, originalUrl) {
  const videos = [];
  
  // For reels/videos, try to construct HD video URL from thumbnail
  if (oembedData.thumbnail_url) {
    const mediaType = detectMediaType(originalUrl);
    if (mediaType === 'reel' || mediaType === 'igtv' || mediaType === 'post') {
      // Try different HD video URL patterns
      const possibleVideoUrls = [
        oembedData.thumbnail_url.replace('_n.jpg', '_hd.mp4'),
        oembedData.thumbnail_url.replace('_n.jpg', '.mp4'),
        oembedData.thumbnail_url.replace('.jpg', '.mp4'),
        oembedData.thumbnail_url.replace('/s150x150/', '/').replace('.jpg', '.mp4')
      ];
      
      possibleVideoUrls.forEach(videoUrl => {
        if (videoUrl.includes('.mp4')) {
          videos.push({
            url: videoUrl,
            quality: videoUrl.includes('_hd') ? 'hd' : 'standard',
            format: 'mp4',
            source: 'oembed_constructed'
          });
        }
      });
    }
  }

  return {
    title: oembedData.title || 'Instagram Video',
    author: oembedData.author_name || 'Unknown',
    description: oembedData.title || '',
    post_type: detectMediaType(originalUrl),
    original_url: originalUrl,
    videos: videos,
    video_count: videos.length
  };
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
  const match = description.match(/^([^:]+):/);
  return match ? match[1].trim() : 'Unknown';
}
