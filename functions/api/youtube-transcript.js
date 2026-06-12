import { CORS_HEADERS, fetchYouTubeTranscript, getGroqApiKeyFromRequest } from '../../lib/youtube-transcript-core.js';

function jsonResponse(status, payload) {
    return new Response(status === 204 ? null : JSON.stringify(payload), {
        status,
        headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8'
        }
    });
}

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return jsonResponse(204, {});
    }

    if (request.method !== 'GET') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const url = new URL(request.url);
    const videoId = (url.searchParams.get('videoId') || '').trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return jsonResponse(400, { error: 'Invalid YouTube videoId' });
    }

    try {
        const result = await fetchYouTubeTranscript(videoId, getGroqApiKeyFromRequest(request));
        return jsonResponse(200, result);
    } catch (error) {
        return jsonResponse(502, { error: error.message || 'Transcript fetch failed' });
    }
}
