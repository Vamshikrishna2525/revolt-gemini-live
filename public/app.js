let ws;
let audioCtx;
let micStream;
let workletNode;
let playingQueue = Promise.resolve(); // chain to keep playback in order

const logEl = document.getElementById('log');
function log(...args){ const line=document.createElement('div'); line.textContent=args.join(' '); logEl.appendChild(line); logEl.scrollTop=logEl.scrollHeight; }

function setStatus(connected){
  const p = document.getElementById('ws-status');
  p.innerHTML = `<span class="status-dot" style="background:${connected ? '#22c55e' : '#ef4444'}"></span> ${connected ? 'connected' : 'disconnected'}`;
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  }
  return audioCtx;
}

async function startMic() {
  if (workletNode) return;
  await ensureAudio();
  await audioCtx.audioWorklet.addModule('pcm-worklet.js');
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const src = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture', { processorOptions: { targetRate: 16000 }});
  workletNode.port.onmessage = (event) => {
    const { type, payload } = event.data || {};
    if (type === 'pcm') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  };
  src.connect(workletNode).connect(audioCtx.destination);
  log('🎙️ mic started');
}

function stopMic() {
  if (workletNode) { workletNode.disconnect(); workletNode = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true }}));
  }
  log('🛑 mic stopped');
}

async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
  setStatus(false);
  ws.addEventListener('open', () => { setStatus(true); log('🔌 connected'); });
  ws.addEventListener('close', () => { setStatus(false); log('🔌 closed'); });
  ws.addEventListener('error', (e) => { log('⚠️ ws error', e.message || e); });
  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'interrupted') {
      playingQueue = Promise.resolve();
      return;
    }
    if (msg.type === 'gemini') {
      const data = msg.data;
      const inTx = data?.serverContent?.inputTranscription?.text;
      if (inTx) log('👤', inTx);
      const outTx = data?.serverContent?.outputTranscription?.text;
      if (outTx) log('🤖', outTx);
      const parts = data?.serverContent?.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType && part.inlineData.data) {
          const mime = part.inlineData.mimeType;
          const b64 = part.inlineData.data;
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
          schedulePCMPlayback(bytes, 24000);
        }
      }
    }
  });
}

function schedulePCMPlayback(arrayBuffer, sampleRate) {
  playingQueue = playingQueue.then(async () => {
    await ensureAudio();
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const frameCount = float32.length;
    const audioBuffer = audioCtx.createBuffer(1, frameCount, sampleRate);
    audioBuffer.copyToChannel(float32, 0);
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(audioCtx.destination);
    await new Promise(res => {
      src.onended = res;
      src.start();
    });
  }).catch(() => {});
}

document.getElementById('btnConnect').onclick = () => connect();
document.getElementById('btnMic').onclick = async () => {
  await connect();
  await startMic();
};
document.getElementById('btnStop').onclick = () => {
  stopMic();
};
document.getElementById('quickAsk').onchange = (e) => {
  const text = e.target.value;
  if (!text) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
  }
  e.target.selectedIndex = 0;
};
