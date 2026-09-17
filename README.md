# voiceboard

Voice taskboard: speak → board → agent → shipped. Hono service: phone/Telegram voice ingest, gpt-4o-transcribe STT, GLM extraction, review board, taskrunner dispatch

Deployed at https://voiceboard.asikmydeen.com

Mid-task ask: a running coding agent POSTs `{task_id, question}` to `/ingest/ask` (bearer INGEST_TOKEN) — the question is parked on its card as awaiting an answer and the owner is notified immediately; QUESTION.md on the PR remains the fallback.
