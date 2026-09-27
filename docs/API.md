# ProofMyAI ingestion API

All endpoints take JSON and authenticate with the project API key (Dashboard → **Settings → API key**):

```
Authorization: Bearer ap_live_xxxxxxxxxxxxxxxx
Content-Type: application/json
```

Limits: 600 requests per minute per project, 2 MB per request.

| Status | Meaning |
|---|---|
| 201 | Accepted |
| 400 | Invalid JSON or fields. The `error` message names the field |
| 401 | Missing or wrong API key |
| 409 | This `run_id` was already recorded (agent runs) |
| 413 | Payload too large |
| 429 | Rate limited |

---

## POST `/api/v1/agent-runs`

Send one record per finished agent run.

| Field | Type | Required | Notes |
|---|---|---|---|
| `run_id` | string | ✅ | Unique per project; duplicates return 409 |
| `agent_name` | string | ✅ | Groups runs per agent in the dashboard |
| `goal` | string | | Needed for the AI review (goal achieved / grounded) |
| `status` | `success` \| `error` \| `timeout` \| `cancelled` | | Default `success` |
| `final_output` | string | | The agent's answer or result |
| `steps` | array | | See below; max 2,000 |

Each step: `type` (`llm` \| `tool` \| `retrieval` \| `other`), `name`, `input`, `output`, `error`, `duration_ms`, `tokens`, `cost_usd`.

Response: `{ "id": 12, "score": 65, "issues": [{ "code": "LOOP_DETECTED", "severity": "high", "message": "…" }] }`

Issue codes: `RUN_FAILED`, `TOOL_ERRORS`, `LOOP_DETECTED` (same tool + same input ≥ 3 times), `TOO_MANY_STEPS`, `OVER_BUDGET`, `SLOW_RUN`, `EMPTY_OUTPUT`, `ENDED_ON_ERROR`, and from the AI review, `GOAL_NOT_MET` and `UNGROUNDED_OUTPUT`. Limits are set per project in Settings.

---

## POST `/api/v1/chat-events` (live chatbot tracking)

Send each conversation as it happens. Either send the whole history each time (only new bot replies are graded), or just the latest question and answer.

| Field | Type | Required | Notes |
|---|---|---|---|
| `conversation_id` | string | ✅ | Your chat/session id |
| `bot_name` | string | | Keeps conversations of different bots apart |
| `messages` | array of `{role, content}` | one of | Roles: user/customer and assistant/bot; system messages are ignored |
| `question` + `answer` | strings | one of | Single exchange |

Response: `202 { "accepted": 1 }`. Grading happens in the background, and results appear on the **Live tracking** page and in today's **Live chats** audit. Add `?wait=1` to get the verdicts back in the response: `{ "graded": 1, "results": [{ "verdict": "hallucination", "label": "Made up", "severity": "high", "reason": "…" }] }`.

High-severity answers open an incident and send an alert. If the AI judge is unavailable or over quota, the basic checks are used instead, so live tracking never stops.

---

## POST `/api/v1/workflow-runs`

Send one execution, or an array of up to 500.

| Field | Type | Required | Notes |
|---|---|---|---|
| `platform` | `n8n` \| `make` \| `zapier` \| `other` | | Default `other` |
| `workflow_id` | string | ✅ | |
| `workflow_name` | string | | |
| `execution_id` | string | ✅ | Duplicates are ignored |
| `status` | `success` \| `error` \| `warning` \| `running` \| `waiting` \| `cancelled` \| `crashed` | ✅ | |
| `started_at` | ISO 8601 date-time | | Default: now |
| `duration_ms` | number | | Enables slow-run detection |
| `output_items` | integer | | `0` on a success raises a *silent failure* |
| `error_message` | string | | Shown in the alert |

Response: `{ "received": 1, "created": 1, "duplicates": 0 }`

---

## GET `/api/cron`

Called by your scheduler every 15 minutes. It polls n8n/Make connections, runs the error-rate and stopped-workflow checks, and runs chatbot test suites that have not run in 24 hours.

```
Authorization: Bearer <CRON_SECRET>
```
(or `?secret=<CRON_SECRET>` for schedulers that cannot set headers)

## GET `/api/health`

Returns `{ "ok": true }`. Use it for uptime monitoring.
