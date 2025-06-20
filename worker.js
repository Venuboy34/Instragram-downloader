// worker.js
export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing 'url' parameter",
        usage: "https://instagram-downloader-api.workers.dev/?url=https://www.instagram.com/reel/xyz",
        join: "https://t.me/zerocreations"
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      const api = `https://media.fastdl.app/api/instagram?url=${encodeURIComponent(url)}`;
      const res = await fetch(api);
      const data = await res.json();

      if (!data || !data.video) {
        return new Response(JSON.stringify({
          success: false,
          error: "Invalid or unsupported Instagram URL",
          join: "https://t.me/zerocreations"
        }, null, 2), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        platform: "Instagram",
        username: data.username || null,
        caption: data.caption || null,
        duration: data.duration || null,
        thumbnail: data.thumbnail,
        video_url: data.video,
        hd_video: data.hd || data.video,
        join: "https://t.me/zerocreations"
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to fetch Instagram video",
        message: err.message,
        join: "https://t.me/zerocreations"
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
