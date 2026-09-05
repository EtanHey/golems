# Instruction-File Shape Gate: RED Record

- Observed: 2026-08-02 18:13:03 IDT
- Command: `scripts/check-instruction-shape.sh $HOME/Gits/golems $HOME/Gits/orchestrator`
- Redaction: the local home-directory prefix is shown as `$HOME`; verdicts, filenames, reasons, and exit status are verbatim.

```text
FAIL $HOME/Gits/golems — AGENTS.md is empty
FAIL $HOME/Gits/orchestrator — CLAUDE.md first nonblank line must be exactly @AGENTS.md
EXIT 1
```

The checker reports the first failure per repository. At the observation time, golems' zero-byte `AGENTS.md` was also untracked; after content is installed, the tracked-file check will still keep that repository red until the file is committed.
