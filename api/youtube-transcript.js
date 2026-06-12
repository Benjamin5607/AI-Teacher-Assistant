import { CORS_HEADERS, fetchYouTubeTranscript, getGroqApiKeyFromRequest } from '../lib/youtube-transcript-core.js';

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (statusCode === 204) {
        res.end();
        return;
    }
    res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return sendJson(res, 204, {});
    }

    const videoId = (req.query?.videoId || '').trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return sendJson(res, 400, { error: 'Invalid YouTube videoId' });
    }

    try {
        const result = await fetchYouTubeTranscript(videoId, getGroqApiKeyFromRequest(req));
        return sendJson(res, 200, result);
    } catch (error) {
        return sendJson(res, 502, { error: error.message || 'Transcript fetch failed' });
    }
}
