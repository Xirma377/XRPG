'use strict';

// Optional server-side transcription via OpenAI Whisper-compatible API.
// This is a convenience backend for the "AI transcription" path; the app also
// supports live browser speech-to-text and manual paste/import with no key.

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

// audioBuffer: Buffer of the recorded audio. filename hints the format.
// responseFormat: 'json' (default) or 'verbose_json' (adds .segments with timestamps).
async function whisper({ apiKey, audioBuffer, filename = 'session.webm', model = 'whisper-1', baseUrl, responseFormat = 'json' }) {
  if (!apiKey) throw new Error('No transcription API key set.');
  const url = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : OPENAI_URL;

  const form = new FormData();
  const type = guessType(filename);
  const blob = new Blob([audioBuffer], { type });
  form.append('file', blob, filename);
  form.append('model', model);
  form.append('response_format', responseFormat === 'verbose_json' ? 'verbose_json' : 'json');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Transcription API ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return { text: data.text || '', segments: Array.isArray(data.segments) ? data.segments : null, raw: data };
}

function guessType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return {
    webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac',
  }[ext] || 'application/octet-stream';
}

module.exports = { whisper };
