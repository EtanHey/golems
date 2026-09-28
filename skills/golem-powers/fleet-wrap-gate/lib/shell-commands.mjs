// Minimal POSIX-shell lexer for fleet-wrap-gate's cleanup-receipt check.
// It answers two questions about a Bash tool command without running it:
// which simple commands would EXECUTE (so `echo gh pr merge 88` is an echo,
// not a merge), and what text a command WRITES to a file (a `>`/`>>`
// redirect, a here-document into `cat > f` / `tee f`).
//
// parseShell(src) → [{ argv, redirects: [{op, target}], heredocs: [body],
//                      pipeTo: next simple command | null }]
//
// Handled: '…' and "…" quoting, backslash escapes, `#` comments, the
// separators ; & && || | ( ) and newline, n>/n>> redirects, <<, <<- and
// <<< (here-doc bodies are consumed as data, never as commands). Not handled:
// $(…) / backtick substitution and `bash -c "…"` (their inner commands are not
// seen). Stated in SKILL.md § Stated Limits.

const WRAPPERS = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_LEXER_WORK = 1_000_000;
const MAX_LEXER_MS = 350;

function newCommand() {
  return { argv: [], redirects: [], heredocs: [], pipeTo: null };
}

// A null result means the work bound was reached. Callers must discard
// partial receipt evidence; the independent cron/loop verdict still applies.
export function parseShell(src, { maxWork = MAX_LEXER_WORK, maxMs = MAX_LEXER_MS } = {}) {
  const text = typeof src === "string" ? src : "";
  const deadline = performance.now() + maxMs;
  let work = 0;
  const overBudget = () => ++work > maxWork || ((work & 1023) === 0 && performance.now() > deadline);
  const commands = [];
  const pendingHeredocs = [];
  let cmd = newCommand();
  let cmdHasHeredoc = false;
  let word = null;
  let expect = null; // { kind: "redirect" | "heredoc" | "herestring", op, strip }
  let pipeFrom = null;

  const endWord = () => {
    if (word === null) return;
    if (expect?.kind === "redirect") cmd.redirects.push({ op: expect.op, target: word });
    else if (expect?.kind === "heredoc") {
      pendingHeredocs.push({ cmd, delim: word, strip: expect.strip });
      cmdHasHeredoc = true;
    }
    else if (expect?.kind === "herestring") cmd.heredocs.push(word);
    else cmd.argv.push(word);
    word = null;
    expect = null;
  };
  const endCommand = (sep) => {
    endWord();
    if (pipeFrom) pipeFrom.pipeTo = cmd;
    pipeFrom = null;
    if (cmd.argv.length || cmd.redirects.length || cmd.heredocs.length || cmdHasHeredoc) {
      commands.push(cmd);
      if (sep === "|") pipeFrom = cmd;
    }
    cmd = newCommand();
    cmdHasHeredoc = false;
  };

  let i = 0;
  while (i < text.length) {
    if (overBudget()) return null;
    const c = text[i];
    if (c === "\\") {
      if (text[i + 1] !== "\n") word = (word ?? "") + (text[i + 1] ?? "");
      i += 2;
    } else if (c === "'") {
      let end = text.indexOf("'", i + 1);
      if (end < 0) end = text.length;
      word = (word ?? "") + text.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let out = "";
      while (j < text.length && text[j] !== '"') {
        if (overBudget()) return null;
        if (text[j] === "\\" && j + 1 < text.length && '"\\$`'.includes(text[j + 1])) j += 1;
        out += text[j];
        j += 1;
      }
      word = (word ?? "") + out;
      i = j + 1;
    } else if (c === "#" && word === null) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
    } else if (c === " " || c === "\t") {
      endWord();
      i += 1;
    } else if (c === "\n") {
      endCommand("\n");
      i += 1;
      // Here-document bodies follow the line that opened them, in order.
      for (let pendingIndex = 0; pendingIndex < pendingHeredocs.length; pendingIndex++) {
        if (overBudget()) return null;
        const { cmd: owner, delim, strip } = pendingHeredocs[pendingIndex];
        const lines = [];
        while (i < text.length) {
          if (overBudget()) return null;
          const nl = text.indexOf("\n", i);
          const raw = text.slice(i, nl < 0 ? text.length : nl);
          i = nl < 0 ? text.length : nl + 1;
          const line = strip ? raw.replace(/^\t+/, "") : raw;
          if (line === delim) break;
          lines.push(line);
        }
        owner.heredocs.push(lines.join("\n"));
      }
      pendingHeredocs.length = 0;
    } else if (c === "&" && text[i + 1] === ">") {
      endWord(); // &> and &>> send stdout+stderr to a file
      expect = { kind: "redirect", op: text[i + 2] === ">" ? ">>" : ">" };
      i += text[i + 2] === ">" ? 3 : 2;
    } else if (c === ";" || c === "|" || c === "&" || ((c === "(" || c === ")") && word === null)) {
      const doubled = (c === "|" || c === "&") && text[i + 1] === c;
      endCommand(c === "|" && !doubled ? "|" : c);
      i += doubled ? 2 : 1;
    } else if (c === ">" || c === "<") {
      if (word !== null && /^\d+$/.test(word)) word = null; // 2>, 1>> fd prefix
      endWord();
      if (text.startsWith("<<<", i)) {
        expect = { kind: "herestring" };
        i += 3;
      } else if (text.startsWith("<<-", i)) {
        expect = { kind: "heredoc", strip: true };
        i += 3;
      } else if (text.startsWith("<<", i)) {
        expect = { kind: "heredoc", strip: false };
        i += 2;
      } else if (text.startsWith(">>", i)) {
        expect = { kind: "redirect", op: ">>" };
        i += 2;
      } else {
        expect = { kind: "redirect", op: c };
        i += text[i + 1] === "|" || text[i + 1] === "&" ? 2 : 1;
      }
    } else {
      word = (word ?? "") + c;
      i += 1;
    }
  }
  endCommand("\n");
  for (const { cmd: owner } of pendingHeredocs) {
    if (overBudget()) return null;
    owner.heredocs.push("");
  }
  return commands;
}

// The argv a simple command actually runs: leading VAR=value assignments and
// transparent wrappers (`sudo`, `env`, `command`, …) are skipped.
export function effectiveArgv(command) {
  const argv = command?.argv ?? [];
  let first = 0;
  while (first < argv.length && (ASSIGNMENT_RE.test(argv[first]) || WRAPPERS.has(argv[first]))) first++;
  return argv.slice(first);
}

export function isGhPrMerge(command) {
  const argv = effectiveArgv(command);
  if (argv.length < 3 || argv[0].split("/").pop() !== "gh") return false;
  if (argv[1] !== "pr" || argv[2] !== "merge") return false;
  return !argv.includes("--help") && !argv.includes("-h");
}

// Text a simple command writes to a file: here-doc/here-string bodies of a
// command with an output redirect (or `tee`), and echo/printf arguments that
// are redirected or piped into `tee`. Output to the terminal is not a write.
export function writtenText(command) {
  const argv = effectiveArgv(command);
  const name = argv[0]?.split("/").pop();
  const redirected = command.redirects.some((r) => r.op !== "<");
  const intoTee = effectiveArgv(command.pipeTo ?? {})[0]?.split("/").pop() === "tee";
  const parts = [];
  if (command.heredocs.length && (redirected || name === "tee")) {
    for (const body of command.heredocs) parts.push(body);
  }
  if ((name === "echo" || name === "printf") && (redirected || intoTee)) {
    parts.push(argv.slice(1).filter((a) => !/^-[neE]+$/.test(a)).join(" ").replace(/\\n/g, "\n"));
  }
  return parts.join("\n");
}

export function writeTargets(command) {
  return command.redirects.filter((r) => r.op !== "<").map((r) => r.target);
}
