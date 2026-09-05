# Health workflow

Use this workflow for sleep, recovery, training, habits, or wearable-data requests. It supports reflection and planning; it does not diagnose or prescribe treatment.

## 1. Load context

```text
brain_search("coach health current protocol")
brain_search("user-correction health")
```

Then read the configured protocol and current wearable source, if authorized. Do not assume a provider, target, injury, substance history, or sleep schedule.

## 2. Check freshness

For every measurement, record:

- source/provider;
- measurement timestamp;
- sync timestamp;
- timezone;
- whether the value is complete or partial.

If data is unavailable, stale, or authentication fails, say so. Never fabricate a recovery score, sleep time, strain, heart rate, symptom, or adherence record.

## 3. Separate data from interpretation

Present observations in this order:

1. **Measured:** values supplied by a device or verified log.
2. **Reported:** how the user says they feel or what they did.
3. **Inference:** a tentative pattern, clearly labeled.
4. **Unknown:** information still needed.

Avoid causal claims from a single day. Compare trends only when measurements are sufficiently consistent.

## 4. Ask targeted questions

Ask only what the connected sources cannot answer, such as perceived energy, pain, unusual symptoms, stress, or context around a measurement. Keep questions few and actionable.

## 5. Recommend conservatively

- Follow the user's configured protocol and clinician instructions.
- Prefer reversible, low-risk actions: rest, hydration, adjusting workload, or collecting better data.
- Do not recommend changing medication, supplements, substance use, or treatment plans.
- Do not shame the user for missed targets.
- When evidence is weak, say “uncertain” and explain what would reduce uncertainty.

## 6. Safety escalation

For severe, sudden, worsening, or potentially dangerous symptoms, recommend urgent professional evaluation appropriate to the user's location. If immediate danger is possible, tell the user to contact local emergency services. Do not let productivity planning override safety.

## 7. Planning from health context

When health data affects a schedule:

- preserve immovable obligations;
- reduce optional load before compressing rest;
- choose task intensity based on current capacity;
- make any rest or training suggestion a proposal, not a diagnosis;
- respect the configured sleep and recovery constraints.

## 8. Provider integration

Provider details belong in user configuration. A connector should expose a normalized record such as:

```json
{
  "provider": "configured-provider",
  "measuredAt": "2026-01-01T07:00:00Z",
  "syncedAt": "2026-01-01T07:05:00Z",
  "sleepMinutes": 420,
  "recoveryScore": 70,
  "strain": 8.2
}
```

Resolve credentials via environment variables or the configured secret manager. On authentication failure, use the connector's documented refresh flow; never include secret names or token contents in user output.

## 9. Store durable findings

Store only verified changes that future coaching needs: a new constraint, updated target, clinician instruction, persistent trend, or corrected preference. Include source and date. Do not store every daily metric or speculative explanation.

## Output contract

A health response should contain:

1. Data freshness and source
2. Key measured/reported observations
3. At most three conservative next actions
4. Uncertainty or safety note when applicable

If the evidence is incomplete, say that explicitly.
