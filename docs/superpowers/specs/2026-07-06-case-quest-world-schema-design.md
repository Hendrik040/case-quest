# Case Quest — `world.json` v0.1 Schema Design (Milestone 1)

- **Status:** Draft for review
- **Date:** 2026-07-06
- **Scope:** Milestone 1 only — the `world.json` v0.1 contract, its validator, and two hand-authored example worlds. No engine or pipeline code.
- **Working title:** Case Quest

---

## 1. Purpose & scope

Case Quest turns a written business case study into a playable, top-down 2D adventure game. A student loads a case, plays as one actor in it (e.g. the CEO), explores a world, talks to NPCs, gathers information, makes the case's key decisions, and experiences the consequences.

The system is **two decoupled halves joined by one contract**:

1. **The Case Pipeline (ETL)** — ingests a case document and *emits* a validated `world.json`.
2. **The Game Engine (runtime)** — *consumes* any valid `world.json` and renders it as a playable game, knowing nothing about specific cases.

`world.json` is that contract. **This spec defines it.** Everything else in the project depends on it, so it is designed and reviewed first.

**Milestone 1 deliverables** (all inside `packages/schema/`):
- The `world.json` v0.1 schema as annotated TypeScript types with JSDoc (this document's §6).
- A two-layer validator, `validateWorld()` (§7).
- Two example worlds as committed test fixtures: the **toy** world in §8, plus a larger **realistic** one authored during implementation.
- Tests: each validator rule has a fixture that trips it; both example worlds validate clean.

Out of scope for Milestone 1: the engine, the pipeline, the backend, and any art. Those are Milestones 2–5.

---

## 2. Design decisions (resolved)

These forks were settled during brainstorming and are load-bearing for the schema.

| # | Decision | Choice | Why it matters to the schema |
|---|----------|--------|------------------------------|
| D1 | **Map representation** | **Abstract locations + engine templates.** The schema describes each location semantically (type, NPCs present, fact spots, exits). The engine owns a library of hand-authored tilemap templates per location type and assembles maps. The pipeline never emits tile grids. | Keeps the pipeline's output small and reliable, and the engine fully deterministic. Art is maximally reusable. |
| D2 | **Consequence model** | **Full branching, multiple endings**, modeled as a graph of story nodes. A decision's chosen option transitions to another node; terminal nodes are endings. | The schema is a directed acyclic graph of nodes, not a flat list of scenes. |
| D3 | **Protagonist** | **One designated protagonist per case.** Other actors are NPCs. Schema keeps an `is_playable` flag so multi-protagonist is an additive change later. | One coherent story graph to author and validate. |
| D4 | **Relationship to n-aible platform** | **Standalone project**, harvesting the existing LlamaParse layer and ETL architecture by copying, not coupling. | The schema is a package both future halves import. Not entangled with the existing codebase's churn. |
| D5 | **Schema orientation** | **Producer-first: the schema is the ETL's output contract**, not a hand-authoring format. The toy world is only a fixture that conforms to the same contract the pipeline targets. | The schema must carry everything the ETL extracts — the storyline *and* the per-scene agents. |

---

## 3. Architecture principles

- **The schema is the contract.** Engine and pipeline never work around it. Changes to the schema are deliberate and versioned (`schema_version`).
- **Deterministic engine, probabilistic pipeline.** All LLM calls happen at build time (pipeline) or behind constrained runtime dialogue. Game logic is fully deterministic and testable without API access. "Sufficient facts to unlock a decision" is therefore an **explicit set** of fact IDs, never a fuzzy count.
- **Producer-first.** The schema is designed as the output of the ETL. Fields exist because the pipeline extracts them and the engine needs them — not because a human found them convenient to hand-write.
- **Offline-after-load.** Everything a student sees works offline once the world is loaded, except live NPC dialogue. Pre-generated dialogue can be embedded in the world so it plays fully offline.

---

## 4. Designed as the ETL output contract

The existing n-aible platform already has a proven ETL that extracts a business case and builds a storyline plus per-scene agents. **Case Quest preserves that architecture and ports it**, modernizing only the model-call implementation (OpenAI-with-regex-JSON-scraping → Anthropic schema-constrained tool use). The schema below is built to be the target that ETL emits.

| Existing ETL (`backend/modules/pdf_processing`) | Case Quest `packages/pipeline` stage |
|---|---|
| `parser_service.py` — LlamaParse → markdown | **Extract** — harvested largely as-is (provider-agnostic) |
| `ai_extraction_service.py` — multi-pass persona then scene extraction | **Extract** — same multi-pass strategy, re-implemented on Claude structured output. Pass 1: `actors`, `locations`, timeline skeleton (`nodes`). Pass 2: `facts`, `decisions`, branches, `endings`, `learning_objectives`. |
| (transform implicit in extraction) | **Transform** — normalize to the world model: assign IDs, wire references, build the **node graph (the storyline)**, and build per-actor **agent configs (the "agents for each scene")**. |
| `repository.py` — persist domain rows | **Load** — emit `world.json`, gate on `validateWorld()`, log token usage into `meta.provenance`. |
| `pipeline.py` + `progress_service.py` + Redis queue | Orchestration, progress tracking, queued jobs — pattern reused. |

**Two consequences of producer-first design that shape the schema:**

1. **The validator is the pipeline's Load-stage acceptance gate.** Building the schema + `validateWorld()` in Milestone 1 means the ETL has its quality gate ready the day Milestone 3 begins. A pipeline run that produces an invalid world is rejected with the same actionable errors a hand-authored world would be.
2. **Actors are full agent build-specs.** For "agents for each scene" to work, each actor carries everything needed to instantiate a constrained live-dialogue NPC: persona (background, personality, communication style), goals, and a `knowledge` whitelist of fact IDs it may reveal. The engine's live-dialogue mode builds each NPC's system prompt from exactly these fields plus the current node's context. The `knowledge` whitelist is the hard guardrail against an NPC leaking facts it doesn't hold or inventing case details.

---

## 5. The world model

### 5.1 Entities

The world is a graph of **story nodes**, plus reusable content the nodes switch on and off.

**Stable content (defined once per case):**
- `meta` — case identity, protagonist, start node, and ETL provenance (including token cost).
- `learning_objectives[]` — what the student should understand; the spine the debrief measures against.
- `actors[]` — people/roles. Exactly one is the protagonist (playable); the rest are NPCs. Each is a full agent build-spec.
- `locations[]` — abstract settings that become map zones (type + exits), assembled by the engine from templates.
- `facts[]` — discoverable information items, each tagged with the actor(s) and/or location(s) that reveal it.
- `decisions[]` — the case's key decision points; each gated on a required set of facts, with options that carry consequences and transition the story.

**The story graph:**
- `nodes[]` — story beats. Each node defines which locations are accessible, which NPCs are present, which facts are discoverable, and which decisions are live *at that beat*. This subsumes a separate `timeline[]`: the beats **are** the timeline.
- `endings[]` — terminal nodes. Each carries a summary, the real-case comparison, and per-objective debrief outcomes.

### 5.2 Gameplay loop the model produces

1. Player enters a node (starting at `meta.start_node_id`).
2. They explore the node's `accessible_locations`, talk to its `present_actors`, and collect its `available_facts`.
3. When a live decision's `requires_facts` are all discovered, that decision unlocks.
4. The player picks an option (the engine captures their free-text reasoning), sees `consequence_text`, and the option's `leads_to` advances the story to the next node — or to an ending.
5. Repeat until an ending is reached. The debrief screen maps the path taken against `learning_objectives` using the ending's `lo_outcomes`.

---

## 6. The schema — annotated TypeScript

> **Implementation note.** For review this is presented as TypeScript interfaces with JSDoc — the readable form of the contract. In implementation these types will be **derived from Zod schemas** (`type World = z.infer<typeof WorldSchema>`) so the runtime validator and the type definitions cannot drift apart (see §7). The interface shapes below are exactly that inferred shape.

```typescript
/**
 * world.json v0.1 — the ETL output contract for Case Quest.
 * Produced by the Case Pipeline, consumed by the Game Engine.
 */
export interface World {
  /** Schema version. Pinned so engine and pipeline can gate on compatibility. */
  schema_version: "0.1";
  meta: WorldMeta;
  /** What the student should understand by the end. Referenced by decision options and endings. */
  learning_objectives: LearningObjective[];
  /** People/roles in the case. Exactly one has role "protagonist". */
  actors: Actor[];
  /** Abstract settings that become map zones, assembled by the engine from templates. */
  locations: Location[];
  /** Discoverable information items, each tagged with what reveals it. */
  facts: Fact[];
  /** The case's key decision points. */
  decisions: Decision[];
  /** Story beats. The directed acyclic graph of the storyline. */
  nodes: StoryNode[];
  /** Terminal nodes. Reaching one triggers the debrief. */
  endings: Ending[];
}

export interface WorldMeta {
  /** Stable slug identifying this case, e.g. "wholesale-offer". */
  case_id: string;
  /** Human-readable title shown on the title screen. */
  title: string;
  /** One-paragraph setup shown before play. */
  synopsis: string;
  /** Must reference an actor whose role is "protagonist". */
  protagonist_actor_id: string;
  /** The node the game begins at. Must reference a node in `nodes`. */
  start_node_id: string;
  /** Origin/citation of the case (title, author, source). Optional. */
  source_ref?: string;
  /** ETL run metadata, including token cost. Absent on hand-authored worlds. */
  provenance?: Provenance;
}

/** Metadata about the pipeline run that produced this world. Powers cost visibility. */
export interface Provenance {
  /** Version of the pipeline that generated this world. */
  pipeline_version?: string;
  /** Model used for extraction, e.g. "claude-fable-5". */
  extraction_model?: string;
  /** ISO 8601 timestamp of generation. */
  generated_at?: string;
  /** Token usage for the whole pipeline run. */
  token_usage?: { input: number; output: number; total?: number };
}

export interface LearningObjective {
  /** Unique within the world. */
  id: string;
  /** The objective, phrased as something the student should understand. */
  text: string;
}

export type ActorRole = "protagonist" | "npc";

/**
 * An actor is a full agent build-spec: everything the engine needs to
 * instantiate a constrained live-dialogue NPC, or to render a static one.
 */
export interface Actor {
  id: string;
  /** Display name. */
  name: string;
  role: ActorRole;
  /** v0.1: exactly one actor (the protagonist) is playable. Kept as a flag so
   *  multi-protagonist is an additive change later. */
  is_playable: boolean;
  persona: Persona;
  /** What this actor wants — motivates in-character behavior. */
  goals: string[];
  /**
   * Fact IDs this actor may reveal or discuss. The hard whitelist for live
   * dialogue: an NPC must never surface a fact outside this list, nor invent
   * case details. Empty for the protagonist (the player).
   */
  knowledge: string[];
  /** Optional pre-generated dialogue so the world plays offline-after-load. */
  dialogue?: ActorDialogue;
  /** Hints for the engine's shared sprite set (palette swap, name label). */
  sprite?: SpriteHints;
}

export interface Persona {
  /** Who they are and their relationship to the case. */
  background: string;
  /** Free-form personality notes (Big-Five-style prose is fine). */
  personality: string;
  /** How they talk — tone, verbosity, quirks. */
  communication_style: string;
}

/** Pre-generated dialogue content the ETL may emit. Live mode fills open-ended gaps. */
export interface ActorDialogue {
  /** Shown the first time the player talks to this actor. */
  greeting?: string;
  /** Pre-written lines that reveal specific facts, keyed by fact ID. */
  topics?: { fact_id: string; line: string }[];
}

export interface SpriteHints {
  /** Palette-swap key into the shared sprite set. */
  palette?: string;
  /** Name label shown above the sprite. */
  label?: string;
}

/**
 * Abstract location type. Must be a key the engine has a tilemap template for —
 * the point where the schema meets engine capability. Extend deliberately.
 */
export type LocationType =
  | "office"
  | "boardroom"
  | "factory_floor"
  | "shopfront"
  | "warehouse"
  | "client_site"
  | "street"
  | "home";

export interface Location {
  id: string;
  /** Display name shown on the map / on entry. */
  name: string;
  type: LocationType;
  /** Location IDs reachable from here. Enables player movement between zones. */
  exits: string[];
  /** Optional palette-swap hint for the template. */
  art?: { palette?: string };
}

export interface Fact {
  id: string;
  /** Short name for the quest/knowledge log. */
  label: string;
  /** The actual information revealed to the player. */
  content: string;
  /** Where/who reveals this fact. At least one source is required. */
  sources: FactSource[];
}

/** At least one of `actor_id` / `location_id` must be present (validator-enforced). */
export interface FactSource {
  /** Revealed by talking to this actor (must also list the fact in `knowledge`). */
  actor_id?: string;
  /** Revealed by investigating this location. */
  location_id?: string;
}

export interface Decision {
  id: string;
  /** The question posed to the player. */
  prompt: string;
  /** ALL of these facts must be discovered before the decision unlocks. */
  requires_facts: string[];
  options: DecisionOption[];
}

export interface DecisionOption {
  id: string;
  /** The choice as shown to the player. */
  label: string;
  /** Narrative shown when this option is chosen. */
  consequence_text: string;
  /** Learning objective IDs this choice sheds light on. */
  illuminates: string[];
  /** Node ID or ending ID to transition to. Must resolve to one of them. */
  leads_to: string;
}

export interface StoryNode {
  id: string;
  /** Beat title, e.g. "The Offer on the Table". */
  title: string;
  /** Location IDs explorable in this beat. */
  accessible_locations: string[];
  /** Actor IDs present as NPCs in this beat (the protagonist is the player and
   *  is implicitly present; do not list them here). */
  present_actors: string[];
  /** Fact IDs discoverable in this beat. */
  available_facts: string[];
  /** Decision IDs that can be taken in this beat. */
  live_decisions: string[];
}

export interface Ending {
  id: string;
  title: string;
  /** What results from reaching this ending. */
  summary: string;
  /** What actually happened in the real case — the teaching contrast. */
  real_case_comparison: string;
  /** Per-objective debrief: how this path fared against each objective. */
  lo_outcomes: { lo_id: string; verdict: string }[];
}
```

---

## 7. Validation

`validateWorld(input: unknown): { ok: boolean; errors: Issue[]; warnings: Issue[] }` where an `Issue` is `{ code: string; message: string; path?: string }`. Validation is two layers.

**Layer 1 — shape (structural).** Types, enums, required fields, `schema_version === "0.1"`. Built with **Zod as the single source of truth**; the TS types in §6 are `z.infer`'d from these Zod schemas so the contract and the validator cannot drift. (If preferred, hand-written interfaces plus a mirrored Zod schema is possible, but single-source is recommended — it directly serves "the schema is the contract".)

**Layer 2 — semantics (graph).** Custom TypeScript over the parsed object; no library does these.

### Errors — the world is rejected

| Code | Rule |
|---|---|
| `duplicate_id` | A duplicate `id` within any entity collection (actors, locations, facts, decisions, learning objectives, options within a decision). Nodes and endings share one reference namespace (both are `leads_to` targets), so their IDs must be unique across the combined set. |
| `dangling_ref` | Any `fact_id`, `actor_id`, `location_id`, `node_id`, `ending_id`, or `lo_id` that doesn't resolve (covers `exits`, `present_actors`, `leads_to`, `requires_facts`, actor `knowledge`, `sources`, `illuminates`, `lo_outcomes`, `meta.protagonist_actor_id`, `meta.start_node_id`). |
| `protagonist_invalid` | `meta.protagonist_actor_id` must reference exactly one actor whose `role` is `"protagonist"`; there must be exactly one protagonist; it must have `is_playable: true`. |
| `fact_source_empty` | A `FactSource` with neither `actor_id` nor `location_id`. |
| `knowledge_mismatch` | A fact lists an `actor_id` source, but that actor's `knowledge` doesn't include the fact (an NPC that can't actually reveal what it's said to). |
| `start_missing` | `meta.start_node_id` doesn't resolve to a node. |
| `no_ending` | Zero endings defined. |
| `graph_cyclic` | The node/ending graph (edges = option `leads_to`) contains a cycle. Beats move forward in time. |
| `unreachable_node` | A node or ending not reachable from `start_node_id`. |
| `dead_end_node` | A non-ending node with no live decision whose options lead onward (the story can't continue). |
| `fact_unsolvable` | For a live decision in node N, a required fact must be discoverable in N itself or in a node the player is *guaranteed* to have passed through to reach N — i.e. a node on **every** path from the start to N (a dominator of N). If a required fact is only available on *some* routes to N, a player arriving by another route faces a decision that can never unlock (a soft-lock), which is an error. Message names the decision, fact, and node. (For v0.1's typically shallow graphs this is cheap to compute; the toy world's single node satisfies it trivially.) |
| `unknown_location_type` | A `location.type` outside the engine's template enum — the engine has no tileset to render it. |

### Warnings — playable but suspect

| Code | Rule |
|---|---|
| `objective_unused` | A learning objective that no option or ending `illuminates`/references. |
| `actor_reveals_nothing` | A `present_actor` in a node that can't reveal any of that node's `available_facts`. |
| `fact_unused` | A fact discoverable but required by no decision (unreachable content). |

Every rule above ships with a fixture in the test suite that trips exactly it.

---

## 8. Toy example world — "The Wholesale Offer"

The smallest world that still exercises the full branch structure, fact-gating, the live-dialogue knowledge whitelist, and the debrief. You play **Maya, founder of a small coffee roastery**, deciding whether to accept a large wholesale contract that would strain capacity. Three NPCs each hold one fact; the single decision is gated on all three and branches to two endings.

This world validates clean (no errors, no warnings).

```json
{
  "schema_version": "0.1",
  "meta": {
    "case_id": "wholesale-offer",
    "title": "The Wholesale Offer",
    "synopsis": "You are Maya, founder of Ember & Oak, a small specialty coffee roastery. A regional grocery chain has offered a large wholesale contract. It could double your revenue — or break your operation. Find out what you're really signing up for, then decide.",
    "protagonist_actor_id": "owner",
    "start_node_id": "node_the_offer",
    "source_ref": "Original teaching case authored for Case Quest fixtures."
  },
  "learning_objectives": [
    {
      "id": "lo_capacity_vs_growth",
      "text": "Understand the tradeoff between seizing a growth opportunity and the operational capacity and cash required to deliver on it, and why capacity must lead growth rather than follow it."
    }
  ],
  "actors": [
    {
      "id": "owner",
      "name": "Maya",
      "role": "protagonist",
      "is_playable": true,
      "persona": {
        "background": "Founder and owner of Ember & Oak, which she started five years ago. She knows coffee and her customers, less so operations at scale.",
        "personality": "Ambitious and relationship-driven, prone to optimism about growth.",
        "communication_style": "Warm and direct."
      },
      "goals": ["Keep the roastery alive", "Grow, but without betting the company"],
      "knowledge": []
    },
    {
      "id": "roaster",
      "name": "Sam",
      "role": "npc",
      "is_playable": false,
      "persona": {
        "background": "Head roaster; runs the roasting floor day to day and knows exactly what the equipment can do.",
        "personality": "Practical, protective of quality, wary of overpromising.",
        "communication_style": "Blunt, concrete, talks in numbers."
      },
      "goals": ["Protect roast quality", "Not be asked to do the impossible"],
      "knowledge": ["fact_capacity"],
      "dialogue": {
        "greeting": "Maya. If this is about the grocery deal, we should talk about what these machines can actually handle.",
        "topics": [
          {
            "fact_id": "fact_capacity",
            "line": "Flat out, we can roast about 500 kilos a week without dropping quality. The contract wants 900. That's not a stretch, that's a different factory."
          }
        ]
      }
    },
    {
      "id": "bookkeeper",
      "name": "Dev",
      "role": "npc",
      "is_playable": false,
      "persona": {
        "background": "Part-time bookkeeper who manages the roastery's cash and books.",
        "personality": "Careful, risk-aware, allergic to surprises.",
        "communication_style": "Measured, hedges with caveats."
      },
      "goals": ["Keep the business solvent"],
      "knowledge": ["fact_cash"],
      "dialogue": {
        "greeting": "Before you sign anything — do you want the good news or the cash-flow news?",
        "topics": [
          {
            "fact_id": "fact_cash",
            "line": "We have about three months of runway. Expanding capacity to hit 900 kilos would eat two of those months up front, before the contract pays a cent."
          }
        ]
      }
    },
    {
      "id": "buyer",
      "name": "Ana",
      "role": "npc",
      "is_playable": false,
      "persona": {
        "background": "Procurement lead for the grocery chain, visiting to close the deal.",
        "personality": "Friendly but firm; she has targets to hit.",
        "communication_style": "Polished, persuasive, precise on terms."
      },
      "goals": ["Secure reliable supply at a good price"],
      "knowledge": ["fact_contract"],
      "dialogue": {
        "greeting": "Maya! We're excited about Ember & Oak. Let me walk you through the terms.",
        "topics": [
          {
            "fact_id": "fact_contract",
            "line": "It's 900 kilos a week, twelve months, at 30 percent below your retail price. Standard for us — but there's a cancellation penalty if you can't deliver."
          }
        ]
      }
    }
  ],
  "locations": [
    {
      "id": "roastery_floor",
      "name": "Roastery Floor",
      "type": "factory_floor",
      "exits": ["back_office"]
    },
    {
      "id": "back_office",
      "name": "Back Office",
      "type": "office",
      "exits": ["roastery_floor"]
    }
  ],
  "facts": [
    {
      "id": "fact_capacity",
      "label": "Roasting capacity",
      "content": "The roastery can process about 500 kg/week at quality; the contract requires 900 kg/week — a capacity gap that needs a real expansion.",
      "sources": [{ "actor_id": "roaster", "location_id": "roastery_floor" }]
    },
    {
      "id": "fact_cash",
      "label": "Cash runway",
      "content": "The business has ~3 months of cash runway; expanding capacity would consume ~2 months of it up front, before contract revenue arrives.",
      "sources": [{ "actor_id": "bookkeeper", "location_id": "back_office" }]
    },
    {
      "id": "fact_contract",
      "label": "Contract terms",
      "content": "900 kg/week for 12 months at 30% below retail price, with a cancellation penalty for non-delivery.",
      "sources": [{ "actor_id": "buyer" }]
    }
  ],
  "decisions": [
    {
      "id": "decide_contract",
      "prompt": "Do you accept the grocery chain's wholesale contract?",
      "requires_facts": ["fact_capacity", "fact_cash", "fact_contract"],
      "options": [
        {
          "id": "accept",
          "label": "Accept the contract",
          "consequence_text": "You sign. Demand immediately outstrips what the floor can produce. You rush an expansion, burning most of your cash runway, and quality slips under the pressure of volume you weren't built for.",
          "illuminates": ["lo_capacity_vs_growth"],
          "leads_to": "end_overextended"
        },
        {
          "id": "decline",
          "label": "Decline the contract, for now",
          "consequence_text": "You pass, explaining you'd need to expand capacity first. The chain signs a competitor. Ember & Oak stays stable and profitable — but you watch a rival take the growth you turned down.",
          "illuminates": ["lo_capacity_vs_growth"],
          "leads_to": "end_stable"
        }
      ]
    }
  ],
  "nodes": [
    {
      "id": "node_the_offer",
      "title": "The Offer on the Table",
      "accessible_locations": ["roastery_floor", "back_office"],
      "present_actors": ["roaster", "bookkeeper", "buyer"],
      "available_facts": ["fact_capacity", "fact_cash", "fact_contract"],
      "live_decisions": ["decide_contract"]
    }
  ],
  "endings": [
    {
      "id": "end_overextended",
      "title": "Overextended",
      "summary": "Ember & Oak wins the contract but cannot deliver at quality or price. Cash dries up during the rushed expansion and the relationship sours under missed deliveries.",
      "real_case_comparison": "In the real case this fixture is modeled on, a small roaster that accepted a similar deal defaulted within a year — the cancellation penalty and quality complaints compounded faster than the new revenue arrived.",
      "lo_outcomes": [
        {
          "lo_id": "lo_capacity_vs_growth",
          "verdict": "You prioritized growth over capacity. The outcome shows why capacity and cash must lead a growth commitment, not scramble to catch up to it."
        }
      ]
    },
    {
      "id": "end_stable",
      "title": "Stable, but Watching Rivals",
      "summary": "Ember & Oak stays solvent and keeps its quality, but forgoes the growth — and a competitor captures the account.",
      "real_case_comparison": "Firms that declined similar deals to protect capacity typically survived comfortably; the strongest instead negotiated a phased ramp (smaller initial volume with staged expansion) to capture growth without betting the company.",
      "lo_outcomes": [
        {
          "lo_id": "lo_capacity_vs_growth",
          "verdict": "You protected capacity and cash. The debrief highlights the real cost of foregone growth — and how a phased ramp could have captured it safely."
        }
      ]
    }
  ]
}
```

---

## 9. Milestone 1 deliverables & test plan

**Package layout** (`case-quest/packages/schema/`):
- `src/types.ts` — the TS types (derived from Zod; §6).
- `src/schema.ts` — the Zod schemas (Layer 1, single source of truth).
- `src/validate.ts` — `validateWorld()` (Layer 1 + Layer 2 graph checks; §7).
- `fixtures/wholesale-offer.world.json` — the toy world (§8).
- `fixtures/realistic-case.world.json` — a larger hand-authored world (authored during implementation).
- `fixtures/invalid/*.world.json` — one fixture per error/warning code.
- `test/validate.test.ts` — the test suite.

**Test plan:**
- Both example worlds validate with zero errors and zero warnings.
- Each error code in §7 has a fixture in `fixtures/invalid/` that produces exactly that error and no others.
- Each warning code has a fixture that produces exactly that warning.
- `validateWorld` returns actionable messages (asserted on the `fact_unsolvable` and `dangling_ref` cases, which name the offending IDs).

**Definition of done for Milestone 1:** the schema package builds, both example worlds validate clean, every validator rule is covered by a passing test, and this spec is committed. No engine or pipeline work.

---

## 10. Out of scope for v0.1 (additive later)

These are deliberately excluded now and designed to be non-breaking additions:
- **Per-node actor disposition/knowledge overrides** — an NPC who thaws or learns across beats. v0.1 keeps actor persona and knowledge global.
- **Multiple playable protagonists** — the `is_playable` flag already reserves space; no schema break needed to add later.
- **Live-dialogue runtime** (Milestone 4), the **engine** (Milestone 2), the **pipeline** (Milestone 3), and **art**.
- **Timeline as a distinct entity** — intentionally folded into the node graph.
- **Deep relational persistence** of worlds — the backend (Milestone 4+) will store each validated `world.json` as a JSON/JSONB document plus a thin index and a student-progress table, rather than normalizing the nine entities into tables.

---

## 11. Open questions

None blocking Milestone 1. The realistic second example world's source case will be chosen during implementation; it does not affect the schema.
