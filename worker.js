export default {
  async fetch(request) {
    const url = new URL(request.url);
    const message = url.searchParams.get("q");

    if (!message) {
      return new Response(JSON.stringify({ 
        error: "Missing query parameter 'q'", 
        status: 400, 
        successful: "failed" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const timestamp = Date.now();
    const sign = await generateSHA256(`${timestamp}:${message}:`);

    const data = {
      messages: [{ role: "user", content: message }],
      time: timestamp,
      pass: null,
      sign: sign,
    };

    const headers = {
      "User-Agent": getUserAgent(),
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.google.com/",
      "Origin": "https://api.ashlynn-repo.tech/",
      "Connection": "keep-alive",
    };

    try {
      const response = await fetch("https://chat10.free2gpt.xyz/api/generate", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(data),
      });

      const textResponse = await response.text();

      let ashlynn;
      try {
        const jsonResponse = JSON.parse(textResponse);
        ashlynn = jsonResponse?.choices?.[0]?.message || textResponse;
      } catch (error) {
        ashlynn = textResponse; 
      }

      return new Response(JSON.stringify({
        "Join": "https://t.me/Ashlynn_Repository",
        "response": ashlynn,
        "status": 200,
        "successful": "success"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      return new Response(JSON.stringify({ 
        "Join": "https://t.me/Ashlynn_Repository",
        "response": error.message,
        "status": 500,
        "successful": "failed"
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};

async function generateSHA256(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getUserAgent() {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/537.36",
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}
