import { URL } from 'url';

export interface PreviewTransformOptions {
  cspTag: string;
  documentUrl: string;
  html: string;
  rewriteLocalUri: (uri: string) => string;
}

export function preparePreviewHtml(options: PreviewTransformOptions): string {
  const withCsp = injectIntoHead(options.html, options.cspTag);
  return rewriteHtmlForPreview(
    withCsp,
    options.documentUrl,
    options.rewriteLocalUri,
  );
}

export function injectIntoHead(html: string, tag: string): string {
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${tag}`);
  }

  return `<!DOCTYPE html><html><head>${tag}</head><body>${html}</body></html>`;
}

export function wrapBodyContent(
  html: string,
  prefix: string,
  suffix: string,
): string {
  if (/<body(\s[^>]*)?>/i.test(html)) {
    const withPrefix = html.replace(
      /<body(\s[^>]*)?>/i,
      (match) => `${match}${prefix}`,
    );

    if (/<\/body>/i.test(withPrefix)) {
      return withPrefix.replace(/<\/body>/i, `${suffix}</body>`);
    }

    return `${withPrefix}${suffix}`;
  }

  return `<!DOCTYPE html><html><head></head><body>${prefix}${html}${suffix}</body></html>`;
}

function rewriteHtmlForPreview(
  html: string,
  documentUrl: string,
  rewriteLocalUri: (uri: string) => string,
): string {
  const lowerHtml = html.toLowerCase();
  let index = 0;
  let result = '';
  let currentBaseUrl = documentUrl;

  while (index < html.length) {
    const nextTagStart = html.indexOf('<', index);
    if (nextTagStart === -1) {
      result += html.slice(index);
      break;
    }

    result += html.slice(index, nextTagStart);

    if (lowerHtml.startsWith('<!--', nextTagStart)) {
      const commentEnd = html.indexOf('-->', nextTagStart + 4);
      if (commentEnd === -1) {
        result += html.slice(nextTagStart);
        break;
      }

      result += html.slice(nextTagStart, commentEnd + 3);
      index = commentEnd + 3;
      continue;
    }

    if (lowerHtml.startsWith('<![cdata[', nextTagStart)) {
      const cdataEnd = html.indexOf(']]>', nextTagStart + 9);
      if (cdataEnd === -1) {
        result += html.slice(nextTagStart);
        break;
      }

      result += html.slice(nextTagStart, cdataEnd + 3);
      index = cdataEnd + 3;
      continue;
    }

    if (lowerHtml.startsWith('</', nextTagStart)) {
      const closingTagEnd = findTagEnd(html, nextTagStart);
      if (closingTagEnd === -1) {
        result += html.slice(nextTagStart);
        break;
      }

      result += html.slice(nextTagStart, closingTagEnd + 1);
      index = closingTagEnd + 1;
      continue;
    }

    if (
      lowerHtml.startsWith('<!', nextTagStart) ||
      lowerHtml.startsWith('<?', nextTagStart)
    ) {
      const declarationEnd = html.indexOf('>', nextTagStart + 2);
      if (declarationEnd === -1) {
        result += html.slice(nextTagStart);
        break;
      }

      result += html.slice(nextTagStart, declarationEnd + 1);
      index = declarationEnd + 1;
      continue;
    }

    const tagEnd = findTagEnd(html, nextTagStart);
    if (tagEnd === -1) {
      result += html.slice(nextTagStart);
      break;
    }

    const tagSource = html.slice(nextTagStart, tagEnd + 1);
    const rewrittenTag = rewriteOpenTagForPreview(
      tagSource,
      currentBaseUrl,
      rewriteLocalUri,
    );
    result += rewrittenTag.html;
    currentBaseUrl = rewrittenTag.baseUrl;
    index = tagEnd + 1;

    if (isRawTextElement(rewrittenTag.tagName) && !rewrittenTag.selfClosing) {
      const closingTagStart = lowerHtml.indexOf(
        `</${rewrittenTag.tagName}`,
        index,
      );

      if (closingTagStart === -1) {
        result += html.slice(index);
        break;
      }

      result += html.slice(index, closingTagStart);
      index = closingTagStart;
    }
  }

  return result;
}

function rewriteOpenTagForPreview(
  tagSource: string,
  currentBaseUrl: string,
  rewriteLocalUri: (uri: string) => string,
): {
  html: string;
  tagName: string;
  selfClosing: boolean;
  baseUrl: string;
} {
  const tagNameMatch = tagSource.match(/^<\s*([^\s/>]+)/);
  if (!tagNameMatch) {
    return {
      html: tagSource,
      tagName: '',
      selfClosing: false,
      baseUrl: currentBaseUrl,
    };
  }

  const tagName = tagNameMatch[1].toLowerCase();
  const selfClosing = /\/\s*>$/.test(tagSource);
  const tagContentEnd = tagSource.length - (selfClosing ? 2 : 1);
  let cursor = 1;
  let rewrittenTag = '<';
  let nextBaseUrl = currentBaseUrl;

  while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
    rewrittenTag += tagSource[cursor];
    cursor += 1;
  }

  rewrittenTag += tagSource.slice(cursor, cursor + tagNameMatch[1].length);
  cursor += tagNameMatch[1].length;

  while (cursor < tagContentEnd) {
    const whitespaceStart = cursor;
    while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
      cursor += 1;
    }
    rewrittenTag += tagSource.slice(whitespaceStart, cursor);

    if (cursor >= tagContentEnd) {
      break;
    }

    if (tagSource[cursor] === '/') {
      rewrittenTag += tagSource.slice(cursor, tagContentEnd);
      cursor = tagContentEnd;
      break;
    }

    const attrNameStart = cursor;
    while (cursor < tagContentEnd && !/[\s=/>]/.test(tagSource[cursor])) {
      cursor += 1;
    }

    const attrNameSource = tagSource.slice(attrNameStart, cursor);
    const attrName = attrNameSource.toLowerCase();
    rewrittenTag += attrNameSource;

    const whitespaceAfterNameStart = cursor;
    while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
      cursor += 1;
    }
    rewrittenTag += tagSource.slice(whitespaceAfterNameStart, cursor);

    if (cursor >= tagContentEnd || tagSource[cursor] !== '=') {
      continue;
    }

    rewrittenTag += '=';
    cursor += 1;

    const whitespaceAfterEqualsStart = cursor;
    while (cursor < tagContentEnd && /\s/.test(tagSource[cursor])) {
      cursor += 1;
    }
    rewrittenTag += tagSource.slice(whitespaceAfterEqualsStart, cursor);

    if (cursor >= tagContentEnd) {
      break;
    }

    const quote =
      tagSource[cursor] === '"' || tagSource[cursor] === "'"
        ? tagSource[cursor]
        : '';
    let attrValue = '';

    if (quote) {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < tagContentEnd && tagSource[cursor] !== quote) {
        cursor += 1;
      }
      attrValue = tagSource.slice(valueStart, cursor);
      const rewrittenValue = rewriteAttributeValueForPreview(
        tagName,
        attrName,
        attrValue,
        currentBaseUrl,
        rewriteLocalUri,
      );
      rewrittenTag += `${quote}${rewrittenValue}${quote}`;
      if (cursor < tagContentEnd && tagSource[cursor] === quote) {
        cursor += 1;
      }
    } else {
      const valueStart = cursor;
      while (cursor < tagContentEnd && !/[\s>]/.test(tagSource[cursor])) {
        cursor += 1;
      }
      attrValue = tagSource.slice(valueStart, cursor);
      const rewrittenValue = rewriteAttributeValueForPreview(
        tagName,
        attrName,
        attrValue,
        currentBaseUrl,
        rewriteLocalUri,
      );
      rewrittenTag += `"${rewrittenValue}"`;
    }

    if (tagName === 'base' && attrName === 'href') {
      nextBaseUrl =
        resolveUrlAgainstBase(currentBaseUrl, attrValue) ?? currentBaseUrl;
    }
  }

  rewrittenTag += selfClosing ? '/>' : '>';

  return {
    html: rewrittenTag,
    tagName,
    selfClosing,
    baseUrl: nextBaseUrl,
  };
}

function rewriteAttributeValueForPreview(
  tagName: string,
  attrName: string,
  value: string,
  currentBaseUrl: string,
  rewriteLocalUri: (uri: string) => string,
): string {
  const normalizedValue = normalizeAttributeValueForPreview(
    tagName,
    attrName,
    value,
  );

  if (attrName === 'srcset') {
    return rewriteSrcsetForPreview(
      normalizedValue,
      currentBaseUrl,
      rewriteLocalUri,
    );
  }

  if (!shouldRewriteAttribute(attrName)) {
    return normalizedValue;
  }

  return rewriteUrlForPreview(currentBaseUrl, normalizedValue, rewriteLocalUri);
}

function normalizeAttributeValueForPreview(
  _tagName: string,
  attrName: string,
  value: string,
): string {
  if (attrName !== 'class') {
    return value;
  }

  const classNames = value.split(/\s+/).filter(Boolean);
  if (
    !classNames.includes('html-widget') ||
    !classNames.includes('html-widget-static-bound')
  ) {
    return value;
  }

  return classNames
    .filter((className) => className !== 'html-widget-static-bound')
    .join(' ');
}

function shouldRewriteAttribute(attrName: string): boolean {
  return (
    attrName === 'href' ||
    attrName === 'src' ||
    attrName === 'srcset' ||
    attrName === 'poster' ||
    attrName === 'data' ||
    attrName === 'action' ||
    attrName === 'formaction' ||
    attrName === 'xlink:href'
  );
}

function rewriteSrcsetForPreview(
  srcset: string,
  currentBaseUrl: string,
  rewriteLocalUri: (uri: string) => string,
): string {
  if (!srcset || srcset.includes('data:')) {
    return srcset;
  }

  return srcset
    .split(',')
    .map((candidate) => {
      const trimmedCandidate = candidate.trim();
      if (!trimmedCandidate) {
        return candidate;
      }

      const separatorIndex = trimmedCandidate.search(/\s/);
      if (separatorIndex === -1) {
        return rewriteUrlForPreview(
          currentBaseUrl,
          trimmedCandidate,
          rewriteLocalUri,
        );
      }

      const urlPart = trimmedCandidate.slice(0, separatorIndex);
      const descriptorPart = trimmedCandidate.slice(separatorIndex);
      return `${rewriteUrlForPreview(currentBaseUrl, urlPart, rewriteLocalUri)}${descriptorPart}`;
    })
    .join(', ');
}

function rewriteUrlForPreview(
  currentBaseUrl: string,
  value: string,
  rewriteLocalUri: (uri: string) => string,
): string {
  if (!shouldRewriteResourceUrl(value)) {
    return value;
  }

  const resolvedUrl = resolveUrlAgainstBase(currentBaseUrl, value);
  if (!resolvedUrl) {
    return value;
  }

  if (isRemoteResourceUrl(resolvedUrl)) {
    return resolvedUrl;
  }

  return rewriteLocalUri(resolvedUrl);
}

function resolveUrlAgainstBase(
  currentBaseUrl: string,
  value: string,
): string | undefined {
  try {
    return new URL(value, currentBaseUrl).toString();
  } catch {
    return undefined;
  }
}

function shouldRewriteResourceUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  return !(
    value.startsWith('#') ||
    value.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
  );
}

function isRemoteResourceUrl(value: string): boolean {
  return /^(https?|data|blob):/i.test(value);
}

function isRawTextElement(tagName: string): boolean {
  return (
    tagName === 'script' ||
    tagName === 'style' ||
    tagName === 'textarea' ||
    tagName === 'title'
  );
}

function findTagEnd(html: string, startIndex: number): number {
  let quote: '"' | "'" | undefined;

  for (let index = startIndex + 1; index < html.length; index += 1) {
    const character = html[index];

    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '>') {
      return index;
    }
  }

  return -1;
}
