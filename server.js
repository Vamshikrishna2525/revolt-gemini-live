// @ts-check
import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || 'models/gemini-2.5-flash-preview-native-audio-dialog';

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Serve static client
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// WebSocket proxy: /ws
const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

/**
 * Send JSON safely
 * @param {WebSocket} ws
 * @param {any} obj
 */
function sendJSON(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) { console.error('sendJSON error', e); }
}

wss.on('connection', (clientWS) => {
  // Upstream Gemini Live websocket
  const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const upstream = new WebSocket(url, {
    headers: { 'x-goog-api-key': GEMINI_API_KEY },
    perMessageDeflate: false
  });

  let upstreamReady = false;
  let clientClosed = false;
  let upstreamClosed = false;

  const closeBoth = (code = 1000, reason = 'closing') => {
    if (!clientClosed) { clientClosed = true; try { clientWS.close(code, reason); } catch {} }
    if (!upstreamClosed) { upstreamClosed = true; try { upstream.close(code, reason); } catch {} }
  };

  upstream.on('open', () => {
    upstreamReady = true;
    // Initial setup
    const setup = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO']
        },
        systemInstruction: {
          parts: [{
            text: `You are "Rev", a helpful voice assistant for Revolt Motors (revoltmotors.com).
Only answer questions about Revolt products, services, EV bikes, charging, service, dealer locations, test rides, pricing, financing, offers, and website/app support.
If a user asks about anything outside Revolt or requests personal/financial advice, politely decline and steer the user back to Revolt topics.
Match the user's language automatically (English, Hindi, Marathi, etc.). Keep responses concise (1-2 sentences) unless asked for details.`
          }]
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {}
      }
    };
    upstream.send(JSON.stringify(setup));
  });

  // upstream -> client
  upstream.on('message', (data, isBinary) => {
    if (isBinary) {
      clientWS.send(data, { binary: true });
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      sendJSON(clientWS, { type: 'gemini', data: msg });
      if (msg?.serverContent?.interrupted) {
        sendJSON(clientWS, { type: 'interrupted' });
      }
    } catch (e) {
      console.error('parse upstream', e);
    }
  });

  upstream.on('close', (code, reason) => {
    upstreamClosed = true;
    if (!clientClosed) clientWS.close(code, reason.toString());
  });
  upstream.on('error', (err) => {
    console.error('Upstream error', err);
    if (!clientClosed) sendJSON(clientWS, { type: 'error', error: 'Upstream error' });
  });

  // client -> upstream
  clientWS.on('message', (data, isBinary) => {
    if (!upstreamReady) return;
    try {
      if (isBinary) {
        const base64 = Buffer.from(data).toString('base64');
        const msg = {
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: base64
            }
          }
        };
        upstream.send(JSON.stringify(msg));
      } else {
        const obj = JSON.parse(data.toString());
        upstream.send(JSON.stringify(obj));
      }
    } catch (e) {
      console.error('client->upstream parse error', e);
    }
  });

  clientWS.on('close', (code, reason) => {
    clientClosed = true;
    if (!upstreamClosed) upstream.close(code, reason.toString());
  });
  clientWS.on('error', (err) => {
    console.error('Client WS error', err);
    closeBoth(1011, 'Client error');
  });

  const interval = setInterval(() => {
    if (clientWS.readyState === WebSocket.OPEN) clientWS.ping();
    if (upstream.readyState === WebSocket.OPEN) upstream.ping();
    if (clientClosed && upstreamClosed) { clearInterval(interval); }
  }, 15000);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
