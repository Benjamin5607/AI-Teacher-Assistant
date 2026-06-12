import http from 'node:http';
import handler from './api/youtube-transcript.js';

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/transcript') {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Use /transcript?videoId=VIDEO_ID' }));
        return;
    }

    await handler({ method: req.method, query: Object.fromEntries(url.searchParams) }, res);
});

server.listen(PORT, () => {
    console.log(`YouTube transcript proxy running on http://localhost:${PORT}/transcript`);
});
