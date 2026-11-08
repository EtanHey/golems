import { normalizeForSpeech, deriveSpeechAliases as deriveLegacyAliases } from "../vendor/narrationlayer/text-normalize.ts";

const SMALL = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

function cardinal(value) {
  const n = Number(value);
  if (n < 20) return SMALL[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${SMALL[n % 10]}` : "");
  if (n < 1000) return `${SMALL[Math.floor(n / 100)]} hundred${n % 100 ? ` ${cardinal(n % 100)}` : ""}`;
  return `${cardinal(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${cardinal(n % 1000)}` : ""}`;
}

function referenceNumber(value) {
  if (value.startsWith("0")) return [...value].map(digit => SMALL[Number(digit)]).join(" ");
  const n = Number(value);
  if (n >= 100 && n < 1000 && n % 100) {
    return `${SMALL[Math.floor(n / 100)]} ${n % 100 < 10 ? "oh " : ""}${cardinal(n % 100)}`;
  }
  return cardinal(n);
}

function clock(hour, minute, period) {
  const minutes = Number(minute || 0);
  return `${cardinal(Number(hour))}${minutes ? ` ${minutes < 10 ? "oh " : ""}${cardinal(minutes)}` : ""} ${period} m`;
}

// Protect complete code spans/fences and URLs before either speech layer runs.
// Compound PR references also bypass install overlays that expand standalone PR.
const PROTECTED =
  /(`+)[\s\S]*?\1(?!`)|(~{3,})[\s\S]*?\2|https?:\/\/[^\s<>`]+|\b(?:PR|pull[ \t]+request)[ \t]+#?\d[\w#.:/–—-]*[:/–—-][\w#.:/–—-]*/gi;
function mapProse(text, transform) {
  let output = "";
  let cursor = 0;
  for (const match of text.matchAll(PROTECTED)) {
    output += transform(text.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return output + transform(text.slice(cursor));
}

function normalizeProse(text, aliases = []) {
  const replace = (pattern, replacement) => {
    text = text.replace(pattern, (...args) => {
      const offset = args.at(-2), source = args.at(-1);
      if (/[\w:/–—-]$/.test(source.slice(0, offset)) || /^(?:[\w:/–—-]|\.\d)/.test(source.slice(offset + args[0].length))) return args[0];
      const spoken = typeof replacement === "function" ? replacement(...args) : replacement;
      aliases.push({ term: args[0], spoken });
      return spoken;
    });
  };
  replace(/(?<![\w:.])(1[0-2]|0?[1-9])(?::([0-5]\d))?[ \t]*([ap])(?:\.m\.?|m)(?!\w)/gi,
      (_, h, m, p) => clock(h, m, p.toLowerCase()));
  replace(/(?<![\w:.])([01]?\d|2[0-3]):([0-5]\d)(?![\w:]|[ \t]*[ap]\.?m)/gi,
      (_, h, m, offset, source) => /\b(?:at|by|until|from)[ \t]+$/i.test(source.slice(0, offset))
        ? clock(Number(h) % 12 || 12, m, Number(h) < 12 ? "a" : "p")
        : `${cardinal(h)} ${cardinal(m)}`);
  replace(/(?<!\w)PR(?=[ \t]+#?\d{1,6}(?!\w))/gi, "pull request");
  replace(/(?<=\bpull[ \t]+request[ \t]+)#?(\d{1,6})(?!\w)/gi,
      (_, n) => referenceNumber(n));
  replace(/(?<![\w#])#(\d{1,6})(?!\w)/g, (_, n) => `number ${referenceNumber(n)}`);
  replace(/\be\.g\./gi, "for example");
  replace(/\bi\.e\./gi, "that is");
  replace(/(?<![\w-])vs\b\.?(?!-)/gi, "versus");
  replace(/\bapprox\./gi, "approximately");
  replace(/(?<!\w)~(\d{1,6})(?!\w|\.\d)/g, (_, n) => `about ${cardinal(n)}`);
  replace(/(?<![\w.])(\d{1,6})(?:\.(\d+))?%/g,
      (_, n, fraction) => `${cardinal(n)}${fraction ? ` point ${[...fraction].map(d => SMALL[Number(d)]).join(" ")}` : ""} percent`);
  replace(/%/g, "percent");
  replace(/(?<![\w.])(\d{1,6})(?:\.(\d+))?x(?!\w)/gi,
      (_, n, fraction) => `${cardinal(n)}${fraction ? ` point ${[...fraction].map(d => SMALL[Number(d)]).join(" ")}` : ""} times`);
  replace(/(?<![\w.])v(\d{1,6}(?:\.\d{1,6})+)(?!\w|\.\d)/gi,
      (_, version) => `version ${version.split(".").map(cardinal).join(" point ")}`);
  return text;
}

/** B11: only synthInput enters the engine; displayText stays byte-for-byte authored. */
export function prepareSpeechChannels(displayText, rules = []) {
  return {
    displayText,
    synthInput: mapProse(displayText, text => normalizeForSpeech(normalizeProse(text), rules)),
  };
}

export function deriveSpeechAliases(displayText, synthInput) {
  const compare = text => text.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
  const explicit = [];
  mapProse(displayText, text => {
    normalizeProse(text, explicit);
    for (const term of text.match(/\S+/g) ?? []) {
      const spoken = normalizeForSpeech(term);
      if (spoken !== term) explicit.push({ term, spoken });
    }
    return text;
  });
  const accepted = explicit.filter(alias => synthInput.includes(alias.spoken));
  const legacy = deriveLegacyAliases(displayText, synthInput).filter(alias => {
    const key = compare(alias.term);
    // LCS gaps may split a clock at its shared digit or merge adjacent terms.
    return !/^\d$/.test(key) && (!/\s/.test(alias.term) || /^[A-Z](?:\s+[A-Z])+$/.test(alias.term)) && !explicit.some(known => {
      const term = compare(known.term);
      return key.includes(term) || term.includes(key);
    });
  });
  const aliases = new Map();
  for (const alias of [...accepted, ...legacy]) {
    const key = `${compare(alias.term)}\0${compare(alias.spoken)}`;
    if (!aliases.has(key)) aliases.set(key, alias);
  }
  return [...aliases.values()];
}
