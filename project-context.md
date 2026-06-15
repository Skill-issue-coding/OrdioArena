# Project Context

**Act as an expert Full-Stack Developer, Game Designer, and NLP Engineer.**

Below is the core context and architecture for OrdioArena — a real-time multiplayer word-based party game in Swedish. Keep this context in mind for all future queries.

## 1. Core Architecture & Lobby System

Standard multiplayer lobby system: create rooms, invite friends, select game mode, start match.

- **State Management:** Real-time sync via WebSocket for lobbies, timers, player states, and voting.
- **Language:** Game and all NLP calculations are strictly in Swedish.

## 2. Tech Stack

### 1. Preprocessing (Python)

Main entry points: staged scripts `preprocessing/stage_1.py` ... `preprocessing/stage_7.py`

Pipeline behavior:

- Uses **Wikipedia2Vec** (`svwiki-w2v-300d`, 300-dim) trained on Swedish Wikipedia.
- Entity vectors harvested directly from model; nearest words per entity form the vocabulary.
- Builds Swedish vocabulary from Korp frequency data + Kelly dictionary + spaCy POS filtering.
- Writes compact binary embeddings for fast Go startup (no CSV float parsing).
- Produces curated target list for Contexto-style modes, including per-word `AntiHiveThreshold` for Anti-Match validation.

Generated files consumed by Go backend:

- `server/wordfiles/vocab.bin` (float32, little-endian)
- `server/wordfiles/vocab.json` (word list)
- `server/wordfiles/meta.json` ({n, dims})
- `server/wordfiles/targets.json` (Contexto + Anti-Match target words with thresholds)

Data sources:

- Kelly XML word list
- Korp frequency CSVs + stopword filtering
- Wikidata SPARQL entity seeds
- Swedish Wikipedia summaries
- Maktbarometern influencer lists (cleaned)

Notes:

- Stage state passed via `preprocessing/intermediate/` (git-ignored).
- `preprocessing/colly-crawler/` — Go-based scraper/formatter for Maktbarometern data.

### 2. Server (Go)

Entry point: `server/main.go` — uses **Gin** HTTP router.

Active routes:

- `GET /api/status` — health check.
- `POST /api/game/username` — generate/validate username.
- `GET /ws/game` — WebSocket upgrade, registers client in hub.

Architecture:

- `session.GameHub` — tracks all connected clients and active lobbies.
- `session.GameLobby` — room with register/unregister/broadcast channels; owns the active `Game`.
- `game.Game` interface — all modes implement `Run()`, `HandleInput()`, `Stop()`, `PlayerLeft()`, `IsPlayerActive()`, `StartTime()`, `EndTime()`.
- `game.GameBase` — embedded struct providing default `HandleInput`, `Stop`, `Broadcast`, `Send`, `PlayerLeft` via internal channels.
- `words.Dictionary` — in-memory map loaded from **binary** wordfiles (`words/readbinary.go`); provides cosine distance calculation.
- `util.CosineDistance` — similarity primitive.

WebSocket event protocol (`server/events/`):

**Client → Server:**

- `create_lobby`, `join_lobby`, `leave_lobby`
- `update_user` (username + background)
- `send_chatmessage`
- `change_mode`, `update_setting`
- `start_game`, `sync_request`
- `game_submit_word`, `game_submit_guess`, `game_submit_vote`

**Server → Client:**

- `connected_to_hub`, `joined_lobby`, `left_lobby`, `join_error`
- `sync_gamestate` — primary state broadcast (player list, settings, phase changes)
- `chat_message`, `error`, `success`
- `game_started`
- Impostor-specific: `impostor_game_started`, `impostor_input_phase`, `impostor_submission_update`, `impostor_discussion_phase`, `impostor_vote_phase`, `impostor_vote_update`, `impostor_intermediate`, `impostor_round_update`
- Anti-Match-specific: `antimatch_input_phase`, `antimatch_submission_update`, `antimatch_round_result`
- `game_result` — final result for any mode

Game mode implementation status (`server/game/`):

- `impostor.go` — **fully implemented** (phase chain: show_word → input → discussion → vote → intermediate → loop/result)
- `antimatch.go` — **fully implemented** (phase chain: input → round_result → loop/result)
- `contexto.go` — settings + types defined, Run logic **not yet implemented**
- `synonym.go` — settings + types defined, Run logic **not yet implemented**

### 3. Client (Next.js)

App routes:

- `/` — home view (`client/components/home/HomeView.tsx`)
- `/lobby/[lobbyCode]` — lobby view (`client/components/lobby/LobbyView.tsx`)
- `/lobby/[lobbyCode]/game` — active game view (`client/components/game/GameView.tsx`)
- `/lobby/[lobbyCode]/game/result` — post-game result screen

Context providers (`client/hooks/`):

- `websocketcontext.tsx` — WebSocket connection, typed `sendEvent`, `subscribe` per event type
- `lobbycontext.tsx` — lobby state (player list, settings, mode, chat)
- `gamecontext.tsx` — active game state (phases, submissions, votes)
- `newgamecontext.tsx` — game orchestration context
- `usercontext.tsx` — local user profile (username, background)
- `timers.tsx` — countdown timer utilities

Frontend stack:

- Tailwind v4 + custom theme tokens + shadcn/ui primitives
- Game mode UI components under `client/components/game/`
- Per-mode websocket type definitions in `client/lib/websocket/game/`

## 3. NLP and Language Constraints

- Swedish-first semantics throughout.
- Vector distance: Wikipedia2Vec (300-dim, Swedish Wikipedia), cosine distance.
- Anti-Match word validation uses a per-word cosine-distance threshold (`AntiHiveThreshold`) set by the preprocessing pipeline; fallback is `0.5` if not enriched.
- POS filtering and vocabulary curation part of preprocessing pipeline.

## 4. Game Modes

Four distinct Swedish word-based game modes. All similarity calculations use Wikipedia2Vec cosine distance.

### Mode 1: Hitta Impostern (`impostor`)

- **Players:** 3–12 (min 3). At least 1 impostor.
- **Mechanic:** Normal players get a secret word; impostors get a semantically similar but different word.
- **Phases:** Show word → Input (configurable 10–60 s) → Discussion (30–150 s) → Vote (10–60 s) → Intermediate (5 s) → repeat or Result.
- **Resolution:** Players discuss and vote to eliminate the suspected impostor each cycle. Game ends when impostors are found or normals are outvoted.
- **Settings:** impostor count (1–4), input/discussion/vote durations.
- **Status:** Fully implemented on server and client.

### Mode 2: Kontext Strid (`contexto_battle`)

- **Players:** 2–12.
- **Mechanic:** Competitive Contexto under time pressure. Players continuously guess words to approach a hidden target word.
- **Resolution:** When timer expires, player whose last guess is semantically closest to the target wins the round.
- **Settings:** word type (Vanliga/Kreativa), round duration (60–600 s), rounds (1–5).
- **Status:** Settings defined; server Run logic not yet implemented.

### Mode 3: Synonym Duell (`synonym_duel`)

- **Players:** 3–12.
- **Mechanic:** Each round all players submit a synonym for a given target word. The player whose submission is semantically _furthest_ from the target is eliminated.
- **Resolution:** Last player standing wins.
- **Settings:** word type (Vanliga/Kreativa), round duration (10–60 s), rounds (1–5).
- **Status:** Settings defined; server Run logic not yet implemented.

### Mode 4: Anti-matchning (`anti_match`)

- **Players:** 3–12.
- **Mechanic:** All players submit a word related to the target. Words that exceed the cosine-distance threshold are rejected as too random. If two or more players submit the exact same word, all receive 0 points. Among remaining unique words, closest to target wins.
- **Settings:** round duration (10–60 s), rounds (1–5).
- **Status:** Fully implemented on server and client.

## 5. How to Assist

Specify which layer (Next.js, Go, Python) or which game mode you are working on. Provide code, architecture advice, or solutions optimized for real-time performance and scalable multiplayer architecture.
