Tick 1:
- parsed_only on s:3, s:5, s:7, s:8, s:9
- full read on worst offender s:7
- full read shows active codex tool call still running

Tick 2:
- parsed_only on all 5 surfaces
- full read rotates to s:3
- full read shows `npm run build` still running
- monitor parks that branch for 15 minutes

Tick 3:
- parsed_only on remaining suspicious surfaces
- full read rotates to s:5
- bottom-of-screen `$` prompt visible
- full-screen read has remained identical for 65 seconds

Expected classification:
- s:7 active
- s:3 long-running
- s:5 idle
