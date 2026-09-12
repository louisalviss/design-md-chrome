(function installExtractor() {
  const MESSAGE_TYPE = "TYPEUI_EXTRACT_STYLES";

  if (window.__typeuiStyleExtractorInstalled) {
    return;
  }

  window.__typeuiStyleExtractorInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPE) {
      return;
    }

    try {
      const payload = extractStylesFromPage();
      sendResponse({ ok: true, payload });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown extraction error";
      sendResponse({ ok: false, error: text });
    }
  });

  function extractStylesFromPage() {
    const sampledElements = collectSampledElements(400);
    const typography = [];
    const colors = [];
    const spacing = [];
    const radius = [];
    const shadows = [];
    const motion = [];
    const layouts = [];

    for (const el of sampledElements) {
      const style = window.getComputedStyle(el);
      typography.push({
        fontFamily: normalizeWhitespace(style.fontFamily),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing
      });

      colors.push({
        textColor: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        outlineColor: style.outlineColor
      });

      spacing.push({
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft
      });

      radius.push(style.borderRadius);
      shadows.push(style.boxShadow);
      motion.push({
        transitionDuration: style.transitionDuration,
        transitionTimingFunction: style.transitionTimingFunction,
        animationDuration: style.animationDuration,
        animationTimingFunction: style.animationTimingFunction
      });

      layouts.push(snapshotLayout(el, style));
    }

    const spatialGraph = collectSpatialGraph(sampledElements, layouts);
    const mediaMap = collectMediaMap(180);

    return {
      source: {
        url: window.location.href,
        title: document.title || "Untitled page"
      },
      sampledAt: new Date().toISOString(),
      totalElements: document.querySelectorAll("*").length,
      sampledElements: sampledElements.length,
      typography,
      colors,
      spacing,
      radius,
      shadows,
      motion,
      layouts,
      spatialGraph,
      mediaMap,
      cssVariables: collectCssVariables(180),
      breakpoints: collectBreakpoints(80),
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      scroll: {
        x: round2(window.scrollX || 0),
        y: round2(window.scrollY || 0),
        documentWidth: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0),
        documentHeight: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0)
      },
      evidence: {
        defaultComputedStyleObserved: true,
        layoutGeometryObserved: true,
        spatialRelationshipsObserved: true,
        mediaCompositionObserved: true,
        cssVariablesObserved: true,
        mediaQueriesObservedWhenReadable: true,
        hoverStateObserved: false,
        focusStateObserved: false,
        activeStateObserved: false
      },
      components: collectComponentCounts(),
      siteSignals: collectSiteSignals()
    };
  }

  function collectSampledElements(limit) {
    const selectors = [
      "body",
      "h1,h2,h3,h4,h5,h6",
      "p",
      "a",
      "button",
      "input,textarea,select",
      "label",
      "nav,header,footer,main,section,article,aside",
      "ul li,ol li",
      "table,th,td",
      "[role='button']",
      "[class*='card']",
      "[class*='btn']",
      "[tabindex]",
      "div[class],span[class]"
    ];

    const seen = new Set();
    const output = [];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (seen.has(node)) {
          continue;
        }
        if (!isVisible(node)) {
          continue;
        }
        seen.add(node);
        output.push(node);
        if (output.length >= limit) {
          return output;
        }
      }
    }

    if (output.length === 0 && document.body) {
      output.push(document.body);
    }

    return output;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return true;
  }


  function snapshotLayout(el, style) {
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX || 0;
    const scrollY = window.scrollY || 0;
    return {
      key: stableElementKey(el),
      element: {
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        classes: Array.from(el.classList || []).slice(0, 5),
        role: el.getAttribute("role") || ""
      },
      rect: rectSnapshot(rect),
      documentRect: {
        x: round2(rect.x + scrollX),
        y: round2(rect.y + scrollY),
        width: round2(rect.width),
        height: round2(rect.height)
      },
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      transform: style.transform,
      opacity: style.opacity,
      overflow: style.overflow,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      flexDirection: style.flexDirection,
      justifyContent: style.justifyContent,
      alignItems: style.alignItems,
      gridTemplateColumns: style.gridTemplateColumns,
      gridTemplateRows: style.gridTemplateRows,
      gap: style.gap,
      width: style.width,
      maxWidth: style.maxWidth
    };
  }

  function rectSnapshot(rect) {
    return {
      x: round2(rect.x),
      y: round2(rect.y),
      width: round2(rect.width),
      height: round2(rect.height)
    };
  }

  function stableElementKey(el) {
    if (!(el instanceof Element)) return "unknown";
    if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
    const attrs = ["data-testid", "data-component", "name", "aria-label"];
    for (const attr of attrs) {
      const value = normalizeWhitespace(el.getAttribute(attr) || "");
      if (value && value.length <= 80) return `${el.tagName.toLowerCase()}[${attr}=${value}]`;
    }
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 7; depth += 1) {
      const tag = node.tagName.toLowerCase();
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
      if (tag === "body" || tag === "html") break;
      node = node.parentElement;
    }
    return parts.join(">");
  }

  function collectSpatialGraph(elements, layouts) {
    const elementToKey = new Map();
    const keyToLayout = new Map();
    elements.forEach((el, index) => {
      const key = layouts[index]?.key || stableElementKey(el);
      elementToKey.set(el, key);
      if (layouts[index]) keyToLayout.set(key, layouts[index]);
    });

    const relations = [];
    const addRelation = (relation) => {
      if (relations.length < 900) relations.push(relation);
    };

    for (const el of elements) {
      const key = elementToKey.get(el);
      let parent = el.parentElement;
      while (parent && !elementToKey.has(parent)) parent = parent.parentElement;
      if (parent && key) addRelation({ type: "contained-by", from: key, to: elementToKey.get(parent) });
    }

    const pairLayouts = layouts.filter((row) => row?.key && row.documentRect?.width > 0 && row.documentRect?.height > 0);
    for (let i = 0; i < pairLayouts.length && relations.length < 900; i += 1) {
      const a = pairLayouts[i];
      const ar = a.documentRect;
      let nearest = null;
      let nearestDistance = Infinity;
      for (let j = i + 1; j < pairLayouts.length; j += 1) {
        const b = pairLayouts[j];
        const br = b.documentRect;
        const ix = Math.max(0, Math.min(ar.x + ar.width, br.x + br.width) - Math.max(ar.x, br.x));
        const iy = Math.max(0, Math.min(ar.y + ar.height, br.y + br.height) - Math.max(ar.y, br.y));
        const intersection = ix * iy;
        const minArea = Math.max(1, Math.min(ar.width * ar.height, br.width * br.height));
        if (intersection / minArea >= 0.08) {
          addRelation({ type: "overlaps", from: a.key, to: b.key, ratio: round2(intersection / minArea) });
        }
        const verticalGap = Math.max(0, Math.max(ar.y, br.y) - Math.min(ar.y + ar.height, br.y + br.height));
        const horizontalGap = Math.max(0, Math.max(ar.x, br.x) - Math.min(ar.x + ar.width, br.x + br.width));
        const distance = Math.hypot(horizontalGap, verticalGap);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = b;
        }
        if (verticalGap <= 160) {
          if (Math.abs(ar.x - br.x) <= 3) addRelation({ type: "align-left", from: a.key, to: b.key });
          const ac = ar.x + ar.width / 2;
          const bc = br.x + br.width / 2;
          if (Math.abs(ac - bc) <= 3) addRelation({ type: "align-center-x", from: a.key, to: b.key });
        }
      }
      if (nearest && nearestDistance <= 240) addRelation({ type: "near", from: a.key, to: nearest.key, distance: round2(nearestDistance) });
    }

    const viewportAnchors = layouts
      .filter((row) => row.position === "fixed" || row.position === "sticky")
      .slice(0, 80)
      .map((row) => ({
        key: row.key,
        position: row.position,
        top: round2(row.rect.y),
        left: round2(row.rect.x),
        right: round2(window.innerWidth - (row.rect.x + row.rect.width)),
        bottom: round2(window.innerHeight - (row.rect.y + row.rect.height)),
        zIndex: row.zIndex
      }));

    const sections = [];
    for (const el of document.querySelectorAll("header,nav,main,section,article,aside,footer")) {
      if (!(el instanceof Element) || !isVisible(el) || sections.length >= 120) continue;
      const rect = el.getBoundingClientRect();
      sections.push({
        key: stableElementKey(el),
        tag: el.tagName.toLowerCase(),
        documentRect: {
          x: round2(rect.x + (window.scrollX || 0)),
          y: round2(rect.y + (window.scrollY || 0)),
          width: round2(rect.width),
          height: round2(rect.height)
        }
      });
    }

    return {
      schema: "design-spatial-v1",
      coordinateSpace: "document-css-px",
      relations,
      viewportAnchors,
      sections
    };
  }

  function collectMediaMap(limit) {
    const items = [];
    const nodes = document.querySelectorAll("img,picture,video,svg,canvas");
    for (const el of nodes) {
      if (!(el instanceof Element) || items.length >= limit || !isVisible(el)) continue;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      let naturalWidth = 0;
      let naturalHeight = 0;
      if (el instanceof HTMLImageElement) {
        naturalWidth = el.naturalWidth || 0;
        naturalHeight = el.naturalHeight || 0;
      } else if (el instanceof HTMLVideoElement) {
        naturalWidth = el.videoWidth || 0;
        naturalHeight = el.videoHeight || 0;
      }
      items.push({
        key: stableElementKey(el),
        kind: el.tagName.toLowerCase(),
        rect: rectSnapshot(rect),
        documentRect: {
          x: round2(rect.x + (window.scrollX || 0)),
          y: round2(rect.y + (window.scrollY || 0)),
          width: round2(rect.width),
          height: round2(rect.height)
        },
        naturalSize: naturalWidth && naturalHeight ? { width: naturalWidth, height: naturalHeight } : null,
        aspectRatio: rect.height ? round2(rect.width / rect.height) : null,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        borderRadius: style.borderRadius,
        opacity: style.opacity,
        transform: style.transform,
        position: style.position,
        zIndex: style.zIndex,
        clipPath: style.clipPath,
        overflow: style.overflow,
        loading: el instanceof HTMLImageElement ? (el.loading || "auto") : null,
        autoplay: el instanceof HTMLVideoElement ? Boolean(el.autoplay) : null,
        loop: el instanceof HTMLVideoElement ? Boolean(el.loop) : null,
        muted: el instanceof HTMLVideoElement ? Boolean(el.muted) : null
      });
    }

    for (const el of elementsWithBackgroundImages(limit - items.length)) {
      if (items.length >= limit) break;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const bg = style.backgroundImage || "none";
      items.push({
        key: stableElementKey(el),
        kind: "css-background",
        rect: rectSnapshot(rect),
        documentRect: {
          x: round2(rect.x + (window.scrollX || 0)),
          y: round2(rect.y + (window.scrollY || 0)),
          width: round2(rect.width),
          height: round2(rect.height)
        },
        naturalSize: null,
        aspectRatio: rect.height ? round2(rect.width / rect.height) : null,
        backgroundKind: bg.includes("gradient(") ? (bg.includes("url(") ? "mixed" : "gradient") : "image",
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
        borderRadius: style.borderRadius,
        opacity: style.opacity,
        transform: style.transform,
        position: style.position,
        zIndex: style.zIndex,
        clipPath: style.clipPath,
        overflow: style.overflow
      });
    }

    return { schema: "design-media-map-v1", items };
  }

  function elementsWithBackgroundImages(limit) {
    if (limit <= 0) return [];
    const output = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof Element) || output.length >= limit || !isVisible(el)) continue;
      const backgroundImage = window.getComputedStyle(el).backgroundImage || "none";
      if (backgroundImage !== "none") output.push(el);
    }
    return output;
  }

  function collectCssVariables(limit) {
    const output = [];
    const seen = new Set();
    const add = (name, value) => {
      if (!name || !name.startsWith("--") || seen.has(name) || output.length >= limit) return;
      const normalized = normalizeWhitespace(value);
      if (!normalized) return;
      seen.add(name);
      output.push({ name, value: normalized });
    };

    for (const target of [document.documentElement, document.body].filter(Boolean)) {
      const style = window.getComputedStyle(target);
      for (let i = 0; i < style.length && output.length < limit; i += 1) {
        const name = style[i];
        if (name && name.startsWith("--")) add(name, style.getPropertyValue(name));
      }
    }

    const visitRules = (rules) => {
      if (!rules) return;
      for (const rule of Array.from(rules)) {
        if (output.length >= limit) return;
        if (rule?.style) {
          for (let i = 0; i < rule.style.length && output.length < limit; i += 1) {
            const name = rule.style[i];
            if (name && name.startsWith("--")) add(name, rule.style.getPropertyValue(name));
          }
        }
        if (rule?.cssRules) {
          try { visitRules(rule.cssRules); } catch (_error) {}
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets || [])) {
      if (output.length >= limit) break;
      try { visitRules(sheet.cssRules); } catch (_error) {}
    }

    return output;
  }

  function collectBreakpoints(limit) {
    const values = new Set();
    let unreadableStylesheets = 0;
    const visitRules = (rules) => {
      if (!rules) return;
      for (const rule of Array.from(rules)) {
        if (values.size >= limit) return;
        if (rule && rule.media && rule.media.mediaText) values.add(normalizeWhitespace(rule.media.mediaText));
        if (rule && rule.cssRules) {
          try { visitRules(rule.cssRules); } catch (_error) {}
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets || [])) {
      if (values.size >= limit) break;
      try { visitRules(sheet.cssRules); } catch (_error) { unreadableStylesheets += 1; }
    }
    return { queries: Array.from(values), unreadableStylesheets };
  }

  function round2(value) {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }

  function collectComponentCounts() {
    const map = {
      buttons: "button, [role='button'], .btn, [class*='button']",
      links: "a[href]",
      inputs: "input, textarea, select",
      cards: ".card, [class*='card'], article",
      navigation: "nav, header",
      lists: "ul, ol",
      tables: "table"
    };

    return Object.entries(map).map(([type, selector]) => ({
      type,
      count: document.querySelectorAll(selector).length
    }));
  }

  function collectSiteSignals() {
    const title = document.title || "";
    const description = getMetaContent("description");
    const keywords = getMetaContent("keywords");
    const ogType = getMetaContent("og:type", true);
    const ogSiteName = getMetaContent("og:site_name", true);
    const appName = getMetaContent("application-name");

    const headings = collectTexts("h1, h2", 10, 120);
    const navTexts = collectTexts("nav a, nav button, header a, header button", 24, 50);
    const ctaTexts = collectTexts(
      "button, [role='button'], a[class*='button'], a[class*='btn'], input[type='submit']",
      24,
      40
    );

    const bodyText = normalizeWhitespace((document.body?.innerText || "").slice(0, 14000));

    return {
      title,
      description,
      keywords,
      ogType,
      ogSiteName,
      appName,
      pathname: window.location.pathname || "/",
      hostname: window.location.hostname || "",
      headings,
      navTexts,
      ctaTexts,
      textSample: bodyText,
      elementCounts: {
        forms: document.querySelectorAll("form").length,
        inputs: document.querySelectorAll("input, textarea, select").length,
        tables: document.querySelectorAll("table").length,
        codeBlocks: document.querySelectorAll("pre, code").length,
        articles: document.querySelectorAll("article").length,
        pricingSections: countNodesByText("section, div, article", ["pricing", "plans"]),
        productMarkers: document.querySelectorAll(
          "[itemtype*='Product'], [class*='product'], [id*='product'], [data-product]"
        ).length,
        authMarkers: countNodesByText("a, button, label, span", [
          "sign in",
          "log in",
          "login",
          "register",
          "dashboard",
          "workspace"
        ]),
        checkoutMarkers: countNodesByText("a, button, span", [
          "add to cart",
          "checkout",
          "buy now",
          "cart"
        ])
      }
    };
  }

  function getMetaContent(name, property = false) {
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    const value = document.querySelector(selector)?.getAttribute("content");
    return normalizeWhitespace(value || "");
  }

  function collectTexts(selector, limit, maxLength) {
    const seen = new Set();
    const output = [];
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      const text = normalizeWhitespace(node.innerText || node.textContent || "");
      if (!text || text.length > maxLength) {
        continue;
      }
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);
      output.push(text);
      if (output.length >= limit) {
        break;
      }
    }
    return output;
  }

  function countNodesByText(selector, keywords) {
    const nodes = document.querySelectorAll(selector);
    let count = 0;
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      const text = normalizeWhitespace((node.innerText || node.textContent || "").toLowerCase());
      if (!text) {
        continue;
      }
      if (keywords.some((keyword) => text.includes(keyword))) {
        count += 1;
      }
    }
    return count;
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ");
  }
})();
