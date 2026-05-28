const assert = require('node:assert/strict');

const {
  injectIntoHead,
  preparePreviewHtml,
  wrapBodyContent,
} = require('../dist/previewTransform.js');

const cspTag =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">';

function rewriteLocalUri(uri) {
  return `webview:${uri}`;
}

function runTest(name, fn) {
  // Keep these tests dependency-free so they can run after a plain TypeScript
  // build without bringing in a separate test runner.
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('injectIntoHead inserts tags into an existing head', () => {
  const html = '<html><head><title>Example</title></head><body></body></html>';
  const result = injectIntoHead(html, '<meta name="x" content="1">');

  assert.match(
    result,
    /<head><meta name="x" content="1"><title>Example<\/title><\/head>/,
  );
});

runTest('wrapBodyContent nests content inside the existing body', () => {
  const html = '<html><body><main>Hello</main></body></html>';
  const result = wrapBodyContent(html, '<div id="before">', '</div>');

  assert.match(
    result,
    /<body><div id="before"><main>Hello<\/main><\/div><\/body>/,
  );
});

runTest('preparePreviewHtml rewrites local href and src attributes', () => {
  const html = `
    <html>
      <head></head>
      <body>
        <link rel="stylesheet" href="./assets/site.css">
        <img src="images/chart.png">
      </body>
    </html>
  `;

  const result = preparePreviewHtml({
    cspTag,
    documentUrl: 'file:///workspace/docs/page.html',
    html,
    rewriteLocalUri,
  });

  assert.match(
    result,
    /href="webview:file:\/\/\/workspace\/docs\/assets\/site\.css"/,
  );
  assert.match(
    result,
    /src="webview:file:\/\/\/workspace\/docs\/images\/chart\.png"/,
  );
});

runTest(
  'preparePreviewHtml rewrites srcset candidates but preserves descriptors',
  () => {
    const html = '<img srcset="hero.png 1x, hero@2x.png 2x">';
    const result = preparePreviewHtml({
      cspTag,
      documentUrl: 'file:///workspace/docs/page.html',
      html,
      rewriteLocalUri,
    });

    assert.match(
      result,
      /srcset="webview:file:\/\/\/workspace\/docs\/hero\.png 1x, webview:file:\/\/\/workspace\/docs\/hero@2x\.png 2x"/,
    );
  },
);

runTest('preparePreviewHtml respects base href for relative assets', () => {
  const html = `
    <html>
      <head>
        <base href="./static/">
      </head>
      <body>
        <img src="plot.png">
      </body>
    </html>
  `;

  const result = preparePreviewHtml({
    cspTag,
    documentUrl: 'file:///workspace/docs/page.html',
    html,
    rewriteLocalUri,
  });

  assert.match(
    result,
    /src="webview:file:\/\/\/workspace\/docs\/static\/plot\.png"/,
  );
});

runTest('preparePreviewHtml leaves inline script strings untouched', () => {
  const html = `
    <html>
      <head></head>
      <body>
        <script>
          const template = '<img src="images/not-a-real-tag.png">';
        </script>
      </body>
    </html>
  `;

  const result = preparePreviewHtml({
    cspTag,
    documentUrl: 'file:///workspace/docs/page.html',
    html,
    rewriteLocalUri,
  });

  assert.match(
    result,
    /const template = '<img src="images\/not-a-real-tag\.png">';/,
  );
  assert.doesNotMatch(
    result,
    /webview:file:\/\/\/workspace\/docs\/images\/not-a-real-tag\.png/,
  );
});

runTest('preparePreviewHtml leaves comment text untouched', () => {
  const html =
    '<!-- <img src="images/comment-only.png"> --><img src="images/real.png">';
  const result = preparePreviewHtml({
    cspTag,
    documentUrl: 'file:///workspace/docs/page.html',
    html,
    rewriteLocalUri,
  });

  assert.match(result, /<!-- <img src="images\/comment-only\.png"> -->/);
  assert.match(
    result,
    /src="webview:file:\/\/\/workspace\/docs\/images\/real\.png"/,
  );
});

runTest(
  'preparePreviewHtml removes stale widget binding only from real widget classes',
  () => {
    const html = `
    <div class="html-widget html-widget-static-bound plotly"></div>
    <div class="html-widget-static-bound only"></div>
  `;

    const result = preparePreviewHtml({
      cspTag,
      documentUrl: 'file:///workspace/docs/page.html',
      html,
      rewriteLocalUri,
    });

    assert.match(result, /class="html-widget plotly"/);
    assert.match(result, /class="html-widget-static-bound only"/);
  },
);

runTest('preparePreviewHtml leaves remote and anchor URLs unchanged', () => {
  const html = `
    <a href="#section">Section</a>
    <script src="https://cdn.example.com/widget.js"></script>
    <img src="data:image/png;base64,AAAA">
  `;

  const result = preparePreviewHtml({
    cspTag,
    documentUrl: 'file:///workspace/docs/page.html',
    html,
    rewriteLocalUri,
  });

  assert.match(result, /href="#section"/);
  assert.match(result, /src="https:\/\/cdn\.example\.com\/widget\.js"/);
  assert.match(result, /src="data:image\/png;base64,AAAA"/);
});
