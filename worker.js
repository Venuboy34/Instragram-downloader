export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url || !url.includes("instagram.com")) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing or invalid Instagram URL",
          join: "https://t.me/zerocreations"
        }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const formBody = `url=${encodeURIComponent(url)}&lang=en`;
      const res = await fetch("https://snapinsta.to/action.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        body: formBody
      });

      const html = await res.text();
      const videoMatch = html.match(/href="(https:\/\/[^"]+\.mp4)"/);
      const thumbMatch = html.match(/<img[^>]+src="(https:\/\/[^"]+\.jpg)"/);

      if (!videoMatch) {
        throw new Error("HD video URL not found");
      }

      return new Response(
        JSON.stringify({
          success: true,
          video_url: videoMatch[1],
          thumbnail: thumbMatch ? thumbMatch[1] : null,
          join: "https://t.me/zerocreations"
        }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to scrape video",
          message: err.message,
          join: "https://t.me/zerocreations"
        }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  }
};
