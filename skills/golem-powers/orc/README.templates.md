# Rendered agent templates

These prompts use repoGolem's existing `agentTemplates` renderer and sibling
`<name>.values.json` manifests. They are not inputs to the direct-link installer.

For `orc`, configure its absolute template path under `agentTemplates.orc` and
declare each manifest name under `values` with `sensitive: false`:
`ORCHESTRATOR_AGENT`, `AGENT_LAUNCHER`, `PRIVATE_HANDOFF_DIR`, `PRIVATE_COLLAB_DIR`.
The manifest records names and purposes only. Put actual values in the private
values/secrets layer, never in this public directory. `REPOGOLEM_*` names are
reserved by the config schema; the launcher value is `AGENT_LAUNCHER`.

For `entity-grill`, configure its absolute template path under
`agentTemplates.entity-grill` and declare `GRILL_SEED_DIR` under `values` with
`sensitive: false`. Seed contents stay private and are read only at runtime.

After private configuration is ready, the owner runs `repogolem generate` with
Touch ID if its backend requires it. Then `repogolem generate --check` verifies
the cached render; `repogolem install --apply` links the private generated prompt.
An unresolved or sensitive value refuses generation. Installation refuses an
unrendered, stale, or changed prompt. Hand-placed originals must be backed up in
a private location by the owner before installing managed links.

Source and scratch-home tests do not authorize real secret-provider calls or
installation into the owner's home. See the managed-agent section in
`scripts/repogolem/README.md` for renderer and installer guarantees.
