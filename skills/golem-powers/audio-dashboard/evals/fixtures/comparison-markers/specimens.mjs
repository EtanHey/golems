// Comparison ready-marker specimens (ADX-2c r2, ADX-2d r1 reviews, plus canonical-form edges). Synthetic pages.
const META = '<meta name="adash-comparison" content="ready">';
const chart = '<svg width="320" height="120" role="img" aria-label="Revenue comparison"><rect width="205" height="32" fill="#2a7a6e"/></svg>';

// The only forms the build accepts.
export const CANONICAL = {
  "meta first in head": `<!doctype html><html><head>${META}</head><body>${chart}</body></html>`,
  "self-closing meta, attributes, case and whitespace": `<!DOCTYPE html>\n<HTML lang="en" class='x'>\n  <Head data-x="1">\n    <meta name="adash-comparison" content="ready" />\n  </Head><body>${chart}</body></HTML>`,
  "no doctype": `<html><head>${META}<title>Chart</title></head><body>${chart}</body></html>`,
  "html attribute": `<!doctype html><html lang="en" data-adash-comparison="ready"><head></head><body>${chart}</body></html>`,
  "html attribute, single quotes, no head": `<html data-adash-comparison='ready'><body>${chart}</body></html>`,
  "linked chart": `<!doctype html><html><head>${META}</head><body><a href="details.html"><figure>${chart}</figure></a></body></html>`,
  // ADX-2d review r2: the browser strips exactly one leading BOM, and a newline inside a start tag is a separator.
  "one leading BOM": `\uFEFF<!doctype html><html><head>${META}</head><body>Chart</body></html>`,
  "newline inside the head start tag": `<!doctype html><html><head\n>${META}</head><body>Chart</body></html>`,
};

// Everything else is rejected, including valid pages that the browser would accept but that are not canonical.
export const REJECTED = {
  "B3 commented meta": '<!doctype html><html><head><!-- <meta name="adash-comparison" content="ready"> --></head><body><h1>Chart</h1></body></html>',
  "B3 commented html": '<!doctype html><!-- <html data-adash-comparison="ready"> --><html><head></head><body>404</body></html>',
  "B3 textarea": '<!doctype html><html><head></head><body><textarea><meta name="adash-comparison" content="ready"></textarea></body></html>',
  "B3 attribute text": `<!doctype html><html><head></head><body><div title='<meta name="adash-comparison" content="ready">'>404</div></body></html>`,
  "B3 data attributes": '<!doctype html><html><head><meta data-name="adash-comparison" data-content="ready"></head><body><h1>Chart</h1></body></html>',
  "noscript": '<!doctype html><html><head><noscript><meta name="adash-comparison" content="ready"></noscript></head><body><h1>Chart</h1></body></html>',
  "template only": '<!doctype html><html><head><template><meta name="adash-comparison" content="ready"></template></head><body><h1>Chart</h1></body></html>',
  "template then meta": '<!doctype html><html><head><template><div>inert</div></template><meta name="adash-comparison" content="ready"></head><body><h1>Chart</h1></body></html>',
  "text before meta": '<!doctype html><html><head>not head text<meta name="adash-comparison" content="ready"></head><body><h1>Chart</h1></body></html>',
  "svg title": '<!doctype html><html><head><svg><title><meta name="adash-comparison" content="ready"></title></svg></head><body><h1>Chart</h1></body></html>',
  "script text/plain": '<!doctype html><html><head><script type="text/plain"><meta name="adash-comparison" content="ready"></script></head><body><h1>Chart</h1></body></html>',
  "CDATA": '<!doctype html><html><head><![CDATA[<meta name="adash-comparison" content="ready">]]></head><body><h1>Chart</h1></body></html>',
  "uppercase META NAME CONTENT": '<!doctype html><html><head><META NAME="adash-comparison" CONTENT="ready"></head><body><h1>Chart</h1></body></html>',
  "whitespace in the value": '<!doctype html><html><head><meta name="adash-comparison" content=" ready "></head><body><h1>Chart</h1></body></html>',
  "duplicates, loading then ready": '<!doctype html><html><head><meta name="adash-comparison" content="loading"><meta name="adash-comparison" content="ready"></head><body><h1>Chart</h1></body></html>',
  "meta after head before body": '<!doctype html><html><head></head><meta name="adash-comparison" content="ready"><body>Chart</body></html>',
  "no head, meta before html": '<!doctype html><meta name="adash-comparison" content="ready"><html><body>Chart</body></html>',
  "comment before meta": `<!doctype html><html><head><!-- x -->${META}</head><body>Chart</body></html>`,
  "title before meta": `<!doctype html><html><head><title>x</title>${META}</head><body>Chart</body></html>`,
  "attribute order swapped": '<!doctype html><html><head><meta content="ready" name="adash-comparison"></head><body>Chart</body></html>',
  "marker hidden in an html attribute value": `<html a="><head>${META}"><body>404</body></html>`,
  "duplicate html attribute, first wins": '<html data-adash-comparison="no" data-adash-comparison="ready"><body>404</body></html>',
  "html attribute with spaces": '<html data-adash-comparison=" ready"><body>404</body></html>',
  "plain 404": "<h1>404: missing comparison</h1>",
  // ADX-2d review r2 (B3): JS \s is not HTML whitespace. Each of these built and then failed in both runtimes.
  "two leading BOMs": `\uFEFF\uFEFF<!doctype html><html><head>${META}</head><body>Chart</body></html>`,
  "BOM after the doctype": `<!doctype html>\uFEFF<html><head>${META}</head><body>Chart</body></html>`,
  "NBSP after head": `<!doctype html><html><head>\u00a0${META}</head><body>Chart</body></html>`,
  "vertical tab after head": `<!doctype html><html><head>\u000b${META}</head><body>Chart</body></html>`,
  "em space after head": `<!doctype html><html><head>\u2003${META}</head><body>Chart</body></html>`,
  "NBSP before head": `<!doctype html><html>\u00a0<head>${META}</head><body>Chart</body></html>`,
  "NBSP before html": `\u00a0<!doctype html><html><head>${META}</head><body>Chart</body></html>`,
  "NBSP as the html attribute separator": '<html\u00a0data-adash-comparison="ready"><body>Chart</body></html>',
  "NBSP before the html attribute": '<html \u00a0data-adash-comparison="ready"><body>Chart</body></html>',
  "NBSP inside the head start tag": `<!doctype html><html><head\u00a0>${META}</head><body>Chart</body></html>`,
  // ADX-2d review r2 (B4): the helper must stay build-accepted when the page prefix is longer than the scan window.
  "17,000-space preamble": " ".repeat(17000) + "<h1>Chart</h1>",
  "html start tag longer than the scan window": `<html data-padding="${"x".repeat(17000)}"><body>Chart</body></html>`,
  "head start tag longer than the scan window": `<!doctype html><html><head data-padding="${"x".repeat(17000)}">${META}</head><body>Chart</body></html>`,
};
