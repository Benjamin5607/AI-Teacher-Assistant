const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3-turbo';

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

async function fetchAndroidPlayer(videoId) {
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

    return playerRes.json();
}

function getVideoBasics(player, videoId) {
    return {
        videoId,
        title: player?.videoDetails?.title || '',
        channel: player?.videoDetails?.author || '',
        durationSeconds: Number(player?.videoDetails?.lengthSeconds || 0)
    };
}

async function fetchCaptionTranscript(player) {
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return null;

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
    if (transcript.trim().length < 20) return null;

    return {
        transcript,
        language: track.languageCode || 'unknown',
        extractionMethod: 'captions'
    };
}

function pickAudioFormat(player) {
    const formats = player?.streamingData?.adaptiveFormats || [];
    return formats
        .filter(format => format.url && (format.mimeType || '').startsWith('audio/'))
        .map(format => ({
            url: format.url,
            mimeType: format.mimeType,
            size: Number(format.contentLength || 0)
        }))
        .filter(format => format.size > 0)
        .sort((a, b) => a.size - b.size)
        .find(format => format.size <= MAX_AUDIO_BYTES) || null;
}

function getAudioExtension(mimeType) {
    if ((mimeType || '').includes('webm')) return 'webm';
    if ((mimeType || '').includes('mp4')) return 'm4a';
    return 'audio';
}

async function transcribeAudioWithGroq(audioBuffer, mimeType, groqApiKey) {
    const blob = new Blob([audioBuffer], { type: mimeType || 'audio/mp4' });
    const form = new FormData();
    form.append('file', blob, `youtube-audio.${getAudioExtension(mimeType)}`);
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'text');
    form.append('temperature', '0');

    const response = await fetch(GROQ_TRANSCRIBE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqApiKey}` },
        body: form
    });

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 240);
        throw new Error(`Groq speech recognition failed (${response.status}): ${detail}`);
    }

    const transcript = (await response.text()).trim();
    if (transcript.length < 20) {
        throw new Error('Speech recognition returned empty text');
    }

    return transcript;
}

async function fetchSpeechTranscript(player, groqApiKey) {
    if (!groqApiKey) {
        throw new Error('No captions found. Groq API key is required for automatic speech recognition.');
    }

    const audioFormat = pickAudioFormat(player);
    if (!audioFormat) {
        const durationSeconds = Number(player?.videoDetails?.lengthSeconds || 0);
        if (durationSeconds > 45 * 60) {
            throw new Error('No captions found and the video is too long for automatic speech recognition (max ~45 min).');
        }
        throw new Error('No captions found and no downloadable audio stream was available for this video.');
    }

    const audioRes = await fetch(audioFormat.url, { headers: { 'User-Agent': ANDROID_UA } });
    if (!audioRes.ok) {
        throw new Error(`Audio download failed (${audioRes.status})`);
    }

    const audioBuffer = await audioRes.arrayBuffer();
    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
        throw new Error('Audio file is too large for speech recognition. Try a shorter video or one with captions.');
    }

    const transcript = await transcribeAudioWithGroq(audioBuffer, audioFormat.mimeType, groqApiKey);
    return {
        transcript,
        language: 'auto',
        extractionMethod: 'speech'
    };
}

async function fetchYouTubeTranscript(videoId, groqApiKey = '') {
    const player = await fetchAndroidPlayer(videoId);
    const basics = getVideoBasics(player, videoId);
    const playability = player?.playabilityStatus?.status || 'UNKNOWN';
    const hasStreams = Boolean(player?.streamingData?.adaptiveFormats?.length);
    const hasCaptions = Boolean(player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length);

    if (!hasStreams && !hasCaptions) {
        throw new Error(`Video is not available for extraction (${playability})`);
    }

    let extracted = null;
    try {
        extracted = await fetchCaptionTranscript(player);
    } catch (error) {
        if (!groqApiKey) throw error;
    }

    if (!extracted) {
        extracted = await fetchSpeechTranscript(player, groqApiKey);
    }

    return {
        ...basics,
        ...extracted
    };
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Groq-Api-Key');
    res.end(JSON.stringify(payload));
}

function getGroqApiKey(req) {
    const headerKey = req.headers?.['x-groq-api-key'] || req.headers?.['X-Groq-Api-Key'];
    const queryKey = req.query?.groqKey;
    return String(headerKey || queryKey || '').trim();
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
        const result = await fetchYouTubeTranscript(videoId, getGroqApiKey(req));
        return sendJson(res, 200, result);
    } catch (error) {
        return sendJson(res, 502, { error: error.message || 'Transcript fetch failed' });
    }
};
