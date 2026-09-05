# RAG vs Fine-Tuning: When to Use Which

> Interview topic — AI/ML system design questions

## One-Line Answer
**Fine-tuning teaches style. RAG teaches facts.**

## RAG (Retrieval-Augmented Generation)

**What it is:** The model stays stock. At query time, you search a knowledge base for relevant documents, stuff them into the prompt as context, and the model answers from that context.

**When to use:**
- Factual lookups ("why did we choose X?", "what's the API for Y?")
- Knowledge that changes frequently (docs, architecture decisions)
- When you need citations/sources
- When accuracy > creativity
- Budget-conscious (just embedding cost, no training)

**How it works:**
```
Query → Embed → Search vector DB → Top-K results → Stuff into prompt → LLM answers
```

**Trade-offs:**
- (+) Always up-to-date, just re-index
- (+) Auditable — you see which chunks were used
- (+) Cheap — embeddings are one-time
- (-) Limited by context window size
- (-) Retrieval quality depends on chunking + embedding model
- (-) Adds latency (search step before generation)

## Fine-Tuning

**What it is:** You modify the model's weights by training on your data. The model "learns" patterns from your examples and applies them without needing context.

**When to use:**
- Style/tone ("write like our docs", "respond like our support team")
- Consistent formatting (JSON output, specific templates)
- Reducing prompt size (behavior is baked in, not prompted)
- Domain-specific language that the base model handles poorly

**How it works:**
```
Training data (prompt/completion pairs) → Fine-tune base model → New model checkpoint
```

**Trade-offs:**
- (+) No retrieval step, lower latency
- (+) Consistent behavior without long prompts
- (+) Can learn style/patterns that are hard to prompt for
- (-) Expensive ($50-500+ per run)
- (-) Stale — needs retraining for new knowledge
- (-) Hallucinations — confidently wrong about things it half-learned
- (-) Not available for all models (no Claude fine-tuning API)

## Interview Answer Framework

When asked "Would you use RAG or fine-tuning for X?":

1. **What kind of knowledge?** Facts/docs → RAG. Style/format → Fine-tuning.
2. **How often does it change?** Frequently → RAG. Stable → Either.
3. **Need citations?** Yes → RAG. No → Either.
4. **Budget?** Tight → RAG. Flexible → Consider fine-tuning for style.
5. **Hybrid?** Many real systems use both — fine-tune for style, RAG for facts.

## Real Example: Golems Architecture

We needed the wizard/doctor to understand architecture decisions. Options:
- **Fine-tune:** Train a model on our decision transcripts. Expensive, stale after each change, no Claude fine-tuning API.
- **RAG (chose this):** Index findings + transcripts into Zikaron, search at query time. Free, always current, shows exact source passage.

Winner: RAG — because architecture decisions are *facts* that change over time, not *style* that needs to be baked in.
