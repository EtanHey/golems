// Bounded POSIX-shell lexer, vendored from fleet-wrap-gate for self-containment.
// Used here to distinguish direct git/gh execution from quoted examples.
// Handles quoting, comments and here-doc data; does not expand shell scripts
// or substitutions. Keep this copy aligned with the fleet-wrap lexer.

const WRAPPERS = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_LEXER_WORK = 1_000_000;
const MAX_LEXER_MS = 350;

function newCommand() {
  return { argv: [], redirects: [], heredocs: [], pipeTo: null };
}

// A null result cannot establish the absence of code activity.
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
