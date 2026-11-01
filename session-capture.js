/* Session analysis: saves the charts as a PNG, painted from the page's own layout so it matches what is on screen. */
const CAPTURE_SKIP = '.tooltip,input:not([type="color"]),.visually-hidden,[hidden]';
const CAPTURE_MIN_SCALE = 2;
const CAPTURE_PAD = 16;
const CAPTURE_TITLE = 76;

function captureRadius(value, width, height) {
  const size = parseFloat(value) || 0;
  return String(value).endsWith('%') ? size * Math.min(width, height) / 100 : size;
}

function captureBoxPath(ctx, box, style, grow = 0) {
  const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner =>
    Math.max(0, captureRadius(style[`border${corner}Radius`], box.width, box.height) * box.zoom + grow));
  ctx.beginPath();
  ctx.roundRect(box.left - grow, box.top - grow, box.width + grow * 2, box.height + grow * 2, radii);
}

// "rgb(0 0 0) 0px 1px 2px 0px, ..." with its colour first, as browsers report it.
function captureShadows(value) {
  if (!value || value === 'none') return [];
  return value.split(/,(?![^(]*\))/).map(part => {
    const colour = part.match(/^\s*((?:[a-z-]+\([^)]*\))|#[0-9a-f]+|[a-z]+)/i)?.[1];
    const [x = 0, y = 0, blur = 0, spread = 0] = (part.replace(colour, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
    return {colour, x, y, blur, spread, inset: /\binset\b/.test(part)};
  });
}

// Boxes land on whole device pixels, as the browser places them.
function captureSnap(box) {
  const snap = value => Math.round(value * box.scale) / box.scale;
  const left = snap(box.left), top = snap(box.top);
  return {...box, left, top, width: snap(box.left + box.width) - left, height: snap(box.top + box.height) - top};
}

function capturePaintBox(ctx, unsnapped, style) {
  const box = captureSnap(unsnapped);
  const shadows = captureShadows(style.boxShadow);
  for (const shadow of shadows.filter(item => !item.inset)) {
    ctx.save();
    const clipped = new Path2D();
    clipped.rect(-1e5, -1e5, 2e5, 2e5);
    const inner = new Path2D();
    inner.roundRect(box.left, box.top, box.width, box.height, captureRadius(style.borderTopLeftRadius, box.width, box.height) * box.zoom);
    clipped.addPath(inner);
    ctx.clip(clipped, 'evenodd');
    ctx.shadowColor = shadow.colour;
    ctx.shadowBlur = shadow.blur * box.zoom * box.scale;
    ctx.shadowOffsetX = shadow.x * box.zoom * box.scale;
    ctx.shadowOffsetY = shadow.y * box.zoom * box.scale;
    ctx.fillStyle = shadow.blur ? '#000' : shadow.colour;
    if (!shadow.blur) ctx.shadowColor = 'transparent';
    captureBoxPath(ctx, box, style, shadow.spread * box.zoom);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = style.backgroundColor;
  captureBoxPath(ctx, box, style);
  ctx.fill();
  for (const shadow of shadows.filter(item => item.inset)) {
    ctx.save();
    captureBoxPath(ctx, box, style);
    ctx.clip();
    ctx.strokeStyle = shadow.colour;
    ctx.lineWidth = Math.max(shadow.spread, Math.abs(shadow.y), Math.abs(shadow.x)) * 2 * box.zoom;
    captureBoxPath(ctx, {...box, left: box.left + shadow.x * box.zoom, top: box.top + shadow.y * box.zoom}, style);
    ctx.stroke();
    ctx.restore();
  }
  const widths = ['Top', 'Right', 'Bottom', 'Left'].map(side => (parseFloat(style[`border${side}Width`]) || 0) * box.zoom);
  const colours = ['Top', 'Right', 'Bottom', 'Left'].map(side => style[`border${side}Color`]);
  if (widths.every(width => width === widths[0]) && colours.every(colour => colour === colours[0]) && widths[0] > 0) {
    ctx.strokeStyle = colours[0];
    ctx.lineWidth = widths[0];
    captureBoxPath(ctx, box, style, -widths[0] / 2);
    ctx.stroke();
    return;
  }
  const [top, right, bottom, left] = widths;
  const edges = [[box.left, box.top, box.width, top], [box.left + box.width - right, box.top, right, box.height],
    [box.left, box.top + box.height - bottom, box.width, bottom], [box.left, box.top, left, box.height]];
  edges.forEach((edge, index) => {
    if (!widths[index]) return;
    ctx.fillStyle = colours[index];
    ctx.fillRect(...edge);
  });
}

function capturePaintPseudo(ctx, element, box, pseudo) {
  const style = getComputedStyle(element, pseudo);
  if (style.content === 'none' || style.display === 'none' || style.position !== 'absolute') return;
  const outer = getComputedStyle(element);
  const borderLeft = (parseFloat(outer.borderLeftWidth) || 0) * box.zoom, borderTop = (parseFloat(outer.borderTopWidth) || 0) * box.zoom;
  const part = {
    left: box.left + borderLeft + (parseFloat(style.left) || 0) * box.zoom,
    top: box.top + borderTop + (parseFloat(style.top) || 0) * box.zoom,
    width: (parseFloat(style.width) || 0) * box.zoom,
    height: (parseFloat(style.height) || 0) * box.zoom,
    zoom: box.zoom,
    scale: box.scale,
  };
  if (part.width > 0 && part.height > 0) capturePaintBox(ctx, part, style);
}

// One grapheme at a time, each where the page placed it: canvas text has no tabular figures, and this keeps columns exact.
function capturePaintText(ctx, node, style, origin, zoom) {
  const text = node.textContent;
  if (!text.trim()) return;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * zoom}px ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText('Hg');
  const range = document.createRange();
  const segments = new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text);
  for (const {segment, index} of segments) {
    if (!segment.trim()) continue;
    range.setStart(node, index);
    range.setEnd(node, index + segment.length);
    const rect = range.getBoundingClientRect();
    if (!rect.width) continue;
    const glyph = style.textTransform === 'uppercase' ? segment.toUpperCase() : style.textTransform === 'lowercase' ? segment.toLowerCase() : segment;
    const x = rect.left - origin.x + (rect.width - ctx.measureText(glyph).width) / 2;
    // The browser rounds a font's ascent when it sets the baseline.
    const y = rect.top - origin.y + Math.round(metrics.fontBoundingBoxAscent / zoom) * zoom;
    ctx.fillText(glyph, x, y);
  }
}

async function captureSvgImage(svg, box) {
  const copy = svg.cloneNode(true);
  const originals = [svg, ...svg.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((item, index) => {
    const style = getComputedStyle(item);
    for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight', 'color', 'opacity']) copies[index].style.setProperty(prop, style.getPropertyValue(prop));
  });
  copy.querySelectorAll('title').forEach(title => title.remove());
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', box.width);
  copy.setAttribute('height', box.height);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await image.decode();
  return image;
}

async function capturePaint(ctx, element, origin, zoom, scale, isRoot = false) {
  if (!isRoot && element.matches(CAPTURE_SKIP)) return;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
  const rect = element.getBoundingClientRect();
  const box = {left: rect.left - origin.x, top: rect.top - origin.y, width: rect.width, height: rect.height, zoom, scale};
  ctx.save();
  ctx.globalAlpha *= parseFloat(style.opacity);
  if (style.display !== 'contents' && rect.width && rect.height) capturePaintBox(ctx, box, style);
  capturePaintPseudo(ctx, element, box, '::before');
  if (element.tagName === 'CANVAS') {
    ctx.drawImage(element, box.left, box.top, box.width, box.height);
  } else if (element.tagName === 'INPUT') {
    // A trace's colour swatch: what ties each driver in the legend to their line.
    ctx.fillStyle = element.value;
    captureBoxPath(ctx, box, style);
    ctx.fill();
  } else if (element.tagName === 'IMG') {
    if (element.naturalWidth) {
      const fit = Math.min(box.width / element.naturalWidth, box.height / element.naturalHeight);
      const width = element.naturalWidth * fit, height = element.naturalHeight * fit;
      ctx.drawImage(element, box.left + (box.width - width) / 2, box.top + (box.height - height) / 2, width, height);
    }
  } else if (element.tagName === 'svg') {
    ctx.drawImage(await captureSvgImage(element, box), box.left, box.top, box.width, box.height);
  } else {
    if (!isRoot && ['hidden', 'clip'].includes(style.overflowX)) {
      captureBoxPath(ctx, box, style);
      ctx.clip();
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) capturePaintText(ctx, child, style, origin, zoom);
      else if (child.nodeType === Node.ELEMENT_NODE) await capturePaint(ctx, child, origin, zoom, scale);
    }
  }
  capturePaintPseudo(ctx, element, box, '::after');
  ctx.restore();
}

// The image's own heading: which session on the left, where it came from and the distance shown on the right.
function capturePaintHeader(ctx, width, zoom, family) {
  const root = getComputedStyle(document.documentElement);
  const label = root.getPropertyValue('--ui-label').trim() || '#fff';
  const secondary = root.getPropertyValue('--ui-secondary').trim() || '#999';
  const right = width - CAPTURE_PAD * zoom;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = label;
  ctx.font = `600 ${20 * zoom}px ${family}`;
  ctx.fillText(sessionEventName || 'Lap telemetry', CAPTURE_PAD * zoom, 36 * zoom);
  ctx.fillStyle = secondary;
  ctx.font = `400 ${13 * zoom}px ${family}`;
  ctx.fillText([loadedSessionName, sessionYear].filter(Boolean).join(' · '), CAPTURE_PAD * zoom, 56 * zoom);
  ctx.textAlign = 'right';
  ctx.fillStyle = label;
  ctx.font = `600 ${14 * zoom}px ${family}`;
  ctx.fillText('F1 Apex Data', right, 36 * zoom);
  const icon = $('.brand-icon');
  if (icon?.naturalWidth) ctx.drawImage(icon, right - ctx.measureText('F1 Apex Data').width - 26 * zoom, 21 * zoom, 20 * zoom, 20 * zoom);
  ctx.fillStyle = secondary;
  ctx.font = `400 ${13 * zoom}px ${family}`;
  ctx.fillText($('#traceZoomReadout')?.textContent || 'Full lap', right, 56 * zoom);
  ctx.textAlign = 'left';
}

function captureFileName(kind) {
  const context = $('#loadedSessionContext')?.textContent || '';
  const laps = loaded.map(lap => `${lap.code}-L${lap.lap}`).join('-');
  const name = [`apex ${context}`, laps, kind === 'all' ? 'all-charts' : 'speed-delta'].join(' ');
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
}

function captureDownload(canvas, name) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) return reject(new Error('The image could not be created'));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    resolve();
  }, 'image/png'));
}

// The page's backdrop, drawn by the browser from the page's own background, behind the translucent cards.
async function capturePaintBackdrop(ctx, width, height) {
  const style = getComputedStyle(document.documentElement);
  ctx.fillStyle = style.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  try {
    // Faded out at the foot of the window, so the page's gradients don't end in a hard edge on a longer image.
    const [w, h] = [innerWidth, innerHeight];
    const layer = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;-webkit-mask-image:linear-gradient(#000 60%,transparent);mask-image:linear-gradient(#000 60%,transparent);background-image:${style.backgroundImage.replace(/"/g, "'")}"></div></foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(layer)}`;
    await image.decode();
    // A browser that treats this as unsafe to export keeps the plain colour instead of losing the screenshot.
    const probe = document.createElement('canvas');
    probe.getContext('2d').drawImage(image, 0, 0);
    probe.toDataURL();
    ctx.drawImage(image, 0, 0, w, h);
  } catch (error) {
    console.debug('Screenshot backdrop kept plain', error);
  }
}

async function buildChartCapture(kind) {
  const content = $('#telemetryContent');
  const scroller = $('#telemetryCard');
  const opened = kind === 'all' && !document.body.classList.contains('trace-focus');
  const view = {...traceZoom};
  if (opened) {
    setTraceFocus(true);
    traceZoom = view;
    updateZoomReadout();
  }
  const scrolled = scroller.scrollTop;
  // Controls leave the layout rather than leaving holes, so headings and charts settle as they would without them.
  document.body.classList.add('chart-capturing');
  try {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    scroller.scrollTop = 0;
    const scale = Math.max(CAPTURE_MIN_SCALE, window.devicePixelRatio || 1);
    hoverFraction = null;
    chartCaptureScale = scale;
    await drawAll();
    await document.fonts.ready;
    const zoom = document.documentElement.getBoundingClientRect().width / document.documentElement.offsetWidth || 1;
    const sources = kind === 'all' ? [content] : ['Speed trace', 'Timing delta'].map(name => $(`canvas[data-chart="${name}"]`).closest('.chart'));
    const first = sources[0].getBoundingClientRect();
    const pad = CAPTURE_PAD * zoom;
    const width = first.width + pad * 2;
    // Ends just below the last chart, whatever spare height the window had.
    const last = [...sources.at(-1).querySelectorAll('canvas')].at(-1).closest('.chart').getBoundingClientRect();
    const height = CAPTURE_TITLE * zoom + last.bottom - first.top + pad;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d', {alpha: false});
    ctx.scale(scale, scale);
    ctx.textRendering = 'geometricPrecision';
    await capturePaintBackdrop(ctx, width, height);
    capturePaintHeader(ctx, width, zoom, getComputedStyle(content).fontFamily);
    const origin = {x: first.left - pad, y: first.top - CAPTURE_TITLE * zoom};
    for (const source of sources) await capturePaint(ctx, source, origin, zoom, scale, true);
    return canvas;
  } finally {
    chartCaptureScale = null;
    document.body.classList.remove('chart-capturing');
    scroller.scrollTop = scrolled;
    if (opened) setTraceFocus(false);
    else await drawAll();
  }
}

async function saveChartCapture(kind, summary) {
  const label = summary.textContent;
  summary.textContent = 'Saving…';
  try {
    await captureDownload(await buildChartCapture(kind), captureFileName(kind));
    summary.textContent = 'Saved';
  } catch (error) {
    console.warn('Screenshot failed', error);
    summary.textContent = 'Not saved';
  }
  summary.focus();
  setTimeout(() => { if (summary.isConnected) summary.textContent = label; }, 1800);
}

function bindChartCapture() {
  const menu = $('.trace-capture-menu');
  menu?.querySelectorAll('[data-capture]').forEach(button => button.addEventListener('click', () => {
    menu.open = false;
    saveChartCapture(button.dataset.capture, menu.querySelector('summary'));
  }));
}
