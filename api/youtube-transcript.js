const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';

function decodeXml(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n/g, ' ')
        .trim();
}

function parseCaptionXml(xml) {
    const textMatches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXml(match[1]));
    if (textMatches.length) return textMatches.join(' ');

    const paragraphMatches = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(match => decodeXml(match[1]));
    return paragraphMatches.join(' ');
}

async function fetchAndroidTranscript(videoId) {
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': ANDROID_UA
        },
        body: JSON.stringify({
            context: {
                client: {
                    clientName: 'ANDROID',
                    clientVersion: '20.10.38',
                    androidSdkVersion: 30,
                    hl: 'en',
                    gl: 'US'
                }
            },
            videoId
        })
    });

    if (!playerRes.ok) {
        throw new Error(`YouTube player request failed (${playerRes.status})`);
    }

    const player = await playerRes.json();
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) {
        const status = player?.playabilityStatus?.status || 'UNKNOWN';
        throw new Error(`No captions available for this video (${status})`);
    }

    const preferred = ['ko', 'vi', 'en'];
    const track = preferred
        .map(code => tracks.find(item => item.languageCode === code))
        .find(Boolean) || tracks[0];

    const captionRes = await fetch(track.baseUrl, { headers: { 'User-Agent': ANDROID_UA } });
    if (!captionRes.ok) {
        throw new Error(`Caption download failed (${captionRes.status})`);
    }

    const xml = await captionRes.text();
    const transcript = parseCaptionXml(xml);
    if (transcript.trim().length < 20) {
        throw new Error('Caption track was empty');
    }

    return {
        videoId,
        title: player?.videoDetails?.title || '',
        channel: player?.videoDetails?.author || '',
        language: track.languageCode || 'unknown',
        transcript
    };
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return sendJson(res, 204, {});
    }

    const videoId = (req.query?.videoId || '').trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return sendJson(res, 400, { error: 'Invalid YouTube videoId' });
    }

    try {
        const result = await fetchAndroidTranscript(videoId);
        return sendJson(res, 200, result);
    } catch (error) {
        return sendJson(res, 502, { error: error.message || 'Transcript fetch failed' });
    }
};
