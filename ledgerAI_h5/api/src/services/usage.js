import { query } from '../db.js';

// Best-effort logging of an AI call; never lets a logging failure break the request.
// `meta` is filled in by the Gemini helper: { model, inputTokens, outputTokens }
export async function recordUsage({ userId, kind, ok, meta = {}, startedAt, error }) {
  try {
    await query(
      `INSERT INTO usage_events (user_id, kind, ok, model, duration_ms, input_tokens, output_tokens, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId, kind, ok, meta.model ?? null, startedAt ? Date.now() - startedAt : null,
        meta.inputTokens ?? null, meta.outputTokens ?? null, error ? String(error).slice(0, 300) : null,
      ],
    );
  } catch (err) {
    console.error('usage log failed:', err.message);
  }
}
