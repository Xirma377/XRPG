'use strict';

// Anthropic Messages API proxy, run from the main process so the API key
// never lives in the renderer and there are no CORS constraints.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
  { id: 'claude-fable-5', label: 'Fable 5 (creative)' },
];
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function buildHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

function normalizeMessages(messages) {
  // Accept [{role, content}] with string content; pass through structured content.
  return (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
}

// Non-streaming call. Returns { text, raw, usage, stop_reason }.
async function complete({ apiKey, model, system, messages, max_tokens = 2048, temperature = 0.8 }) {
  if (!apiKey) throw new Error('No Anthropic API key set.');
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens,
    temperature,
    messages: normalizeMessages(messages),
  };
  if (system) body.system = system;

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { text, raw: data, usage: data.usage, stop_reason: data.stop_reason };
}

// Streaming call. onEvent({type, ...}) receives:
//   {type:'delta', text}   incremental text
//   {type:'done', text, usage, stop_reason}
//   {type:'error', error}
async function stream({ apiKey, model, system, messages, max_tokens = 2048, temperature = 0.8, signal }, onEvent) {
  if (!apiKey) throw new Error('No Anthropic API key set.');
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens,
    temperature,
    stream: true,
    messages: normalizeMessages(messages),
  };
  if (system) body.system = system;

  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // A cancel during connection setup is a clean cancellation, not an error.
    if (e.name === 'AbortError') onEvent({ type: 'done', text: '', stop_reason: 'aborted', aborted: true });
    else onEvent({ type: 'error', error: e.message });
    return;
  }

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => '');
    onEvent({ type: 'error', error: `Anthropic API ${resp.status}: ${errText}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let usage = null;
  let stopReason = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
          full += evt.delta.text;
          onEvent({ type: 'delta', text: evt.delta.text });
        } else if (evt.type === 'message_delta') {
          if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
          if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
        } else if (evt.type === 'message_start' && evt.message && evt.message.usage) {
          usage = { ...(usage || {}), ...evt.message.usage };
        } else if (evt.type === 'error') {
          onEvent({ type: 'error', error: (evt.error && evt.error.message) || 'stream error' });
        }
      }
    }
    onEvent({ type: 'done', text: full, usage, stop_reason: stopReason });
  } catch (e) {
    if (e.name === 'AbortError') {
      onEvent({ type: 'done', text: full, usage, stop_reason: 'aborted', aborted: true });
    } else {
      onEvent({ type: 'error', error: e.message });
    }
  }
}

async function testConnection({ apiKey, model }) {
  const res = await complete({
    apiKey,
    model: model || DEFAULT_MODEL,
    max_tokens: 16,
    temperature: 0,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  });
  return { ok: /ok/i.test(res.text), text: res.text };
}

module.exports = { complete, stream, testConnection, MODELS, DEFAULT_MODEL };
