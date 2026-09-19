/** Browser-only function. Pass the FUNCTION and config to page.addInitScript. */
export function installTab10Gap012PassiveCapture(config: {
  inputLabel: string;
  expectedOptionLabel: string;
  maxEvents?: 200 | 400;
}) {
  const host = window as unknown as { __tab10Gap012Passive?: unknown };
  try {
    const cap = config.maxEvents === 200 ? 200 : 400;
    const events: Array<Record<string, unknown>> = [];
    const tokens = new WeakMap<Node, number>();
    const knownInputs = new WeakSet<Element>();
    const controlIds = new Set<string>();
    const listeners: Array<[EventTarget, string, EventListener]> = [];
    let nextToken = 1, dropped = 0, diagnosticErrors = 0, stopped = false;
    let observer: MutationObserver | undefined;
    let resources: PerformanceObserver | undefined;
    let safeProbe: HTMLDivElement | undefined;
    let lastDOMSignature = "";
    const token = (node: Node | null) => {
      if (!node) return null;
      let value = tokens.get(node);
      if (!value) { value = nextToken++; tokens.set(node, value); }
      return value;
    };
    const describe = (value: EventTarget | null) => value instanceof Element
      ? { token: token(value), tag: value.tagName.toLowerCase(), role: value.getAttribute("role") }
      : { kind: value === document ? "document" : value === window ? "window" : value === window.visualViewport ? "visualViewport" : "other" };
    const rect = (node: Element | null) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
    };
    const input = () => {
      for (const node of document.querySelectorAll<HTMLInputElement>('input[role="combobox"]')) {
        const ids = (node.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
        const label = ids.map((id) => document.getElementById(id)?.textContent?.trim() || "").join(" ").trim();
        if (label !== config.inputLabel && node.getAttribute("aria-label") !== config.inputLabel) continue;
        knownInputs.add(node);
        const controls = node.getAttribute("aria-controls");
        if (controls) controlIds.add(controls);
        return node;
      }
      return null;
    };
    const safeBottom = () => {
      if (!safeProbe && document.body) {
        safeProbe = document.createElement("div");
        safeProbe.setAttribute("aria-hidden", "true");
        safeProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;left:0;bottom:0;margin:0;border:0;padding:0;padding-bottom:env(safe-area-inset-bottom)";
        document.body.appendChild(safeProbe);
      }
      return safeProbe?.isConnected ? parseFloat(getComputedStyle(safeProbe).paddingBottom) || 0 : null;
    };
    const snapshot = () => {
      const field = input();
      if (!field) return { inputPresent: false, active: describe(document.activeElement) };
      const fieldRect = rect(field)!;
      // Frozen h$ DOM: input -> x1 control -> S/controlRef -> y1 root.
      const control = field.parentElement;
      const controlRef = control?.parentElement ?? null;
      const root = controlRef?.parentElement ?? null;
      const labelIds = (field.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
      const shapeMatches = Boolean(
        control && controlRef && root &&
        field.parentElement === control &&
        control.parentElement === controlRef &&
        controlRef.parentElement === root &&
        root.contains(field) &&
        labelIds.length > 0 &&
        labelIds.every((id) => {
          const label = document.getElementById(id);
          return Boolean(label && root.contains(label));
        }),
      );
      const viewport = window.visualViewport;
      const inset = safeBottom();
      const visualTop = viewport?.offsetTop ?? 0;
      const visualBottom = visualTop + (viewport?.height ?? innerHeight) - (inset ?? 0);
      let clipTop = visualTop, clipBottom = visualBottom;
      let scrollContainer: HTMLElement | null = null;
      const clipping: Array<Record<string, unknown>> = [];
      // h$ starts at root.parentElement, and tests ONLY computed overflowY.
      for (let node = root?.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (!/(auto|scroll|hidden|clip)/.test(overflowY)) continue;
        const bounds = rect(node)!;
        clipTop = Math.max(clipTop, bounds.top);
        clipBottom = Math.min(clipBottom, bounds.bottom);
        if (!scrollContainer && /(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) scrollContainer = node;
        clipping.push({ node: describe(node), overflowY, rect: bounds, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
      }
      const listId = field.getAttribute("aria-controls");
      const list = listId ? document.getElementById(listId) : null;
      const options = list ? Array.from(list.querySelectorAll('[role="option"]')) : [];
      const exact = options.filter((node) => node.textContent?.trim() === config.expectedOptionLabel);
      const option = exact[0] ?? null;
      const suggestion = document.querySelector('section[aria-label="Быстрый выбор игроков"]');
      const groupCount = (heading: string) => {
        const title = suggestion ? Array.from(suggestion.querySelectorAll("h3")).find((node) => node.textContent?.trim() === heading) : null;
        return title?.parentElement?.querySelectorAll("button").length ?? 0;
      };
      const loading = Array.from(document.querySelectorAll('[role="status"]')).some((node) => node.textContent?.trim() === "Загружаем список игроков…");
      return {
        inputPresent: true, inputToken: token(field), inputConnected: field.isConnected,
        inputActive: document.activeElement === field, active: describe(document.activeElement),
        queryLength: field.value.length, queryMatchesExpected: field.value === config.expectedOptionLabel,
        expanded: field.getAttribute("aria-expanded"), inputRect: fieldRect,
        geometry: { vendorDOMShapeMatches: shapeMatches, safeBottom: inset, rootRect: rect(root), visualTop, visualBottom, clipTop, clipBottom,
          outsideMargin12: fieldRect.bottom > clipBottom - 12 || fieldRect.top < clipTop + 12,
          scrollTarget: describe(scrollContainer ?? window), clipping },
        scroll: { x: scrollX, y: scrollY },
        viewport: { offsetTop: viewport?.offsetTop ?? 0, offsetLeft: viewport?.offsetLeft ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight },
        listToken: token(list), listRect: rect(list), optionCount: options.length, exactOptionCount: exact.length,
        exactOptionToken: token(option), exactOptionRect: rect(option),
        optionStyle: option ? { display: getComputedStyle(option).display, visibility: getComputedStyle(option).visibility } : null,
        directoryDOM: { loading, suggestionsPresent: Boolean(suggestion), suggestionsToken: token(suggestion), suggestionsRect: rect(suggestion),
          groups: { frequentButtons: groupCount("Частые соперники"), recentButtons: groupCount("Недавние соперники"), teamButtons: groupCount("Команды") } },
      };
    };
    const guard = (run: () => void) => { try { run(); } catch { diagnosticErrors++; } };
    const push = (type: string, details: Record<string, unknown> = {}, withState = true) => {
      if (stopped) return;
      if (events.length >= cap) { dropped++; return; }
      events.push({ at: performance.now(), type, ...details, ...(withState ? { state: snapshot() } : {}) });
    };
    const roleChanges = (nodes: NodeList, parent: Node) => {
      const lists = new Set<Element>(), options = new Set<Element>();
      const parentList = parent instanceof Element ? parent.closest('[role="listbox"]') : null;
      for (const node of Array.from(nodes)) {
        if (!(node instanceof Element)) continue;
        const found = [node, ...Array.from(node.querySelectorAll('[role="listbox"], [role="option"]'))];
        for (const item of found) {
          const role = item.getAttribute("role");
          if (role === "listbox" && controlIds.has(item.id)) lists.add(item);
          if (role === "option") {
            const owner = item.closest('[role="listbox"]') ?? parentList;
            if (owner && controlIds.has(owner.id)) options.add(item);
          }
        }
      }
      return { listTokens: Array.from(lists, (node) => token(node)), optionCount: options.size,
        exactOptionTokens: Array.from(options).filter((node) => node.textContent?.trim() === config.expectedOptionLabel).map((node) => token(node)) };
    };
    const processMutations = (records: MutationRecord[]) => {
      if (stopped) return;
      const field = input(); // Remember controls before processing added/removed lists.
      for (let index = 0; index < records.length; index++) {
        const record = records[index]!;
        if (record.type === "attributes" && record.target instanceof Element && knownInputs.has(record.target)) {
          const next = records.slice(index + 1).find((r) => r.type === "attributes" && r.target === record.target && r.attributeName === record.attributeName);
          push("aria-expanded", { node: describe(record.target), oldValue: record.oldValue,
            valueAfterMutation: next ? next.oldValue : record.target.getAttribute("aria-expanded"),
            currentValueAtDelivery: record.target.getAttribute("aria-expanded") });
        }
        if (record.type !== "childList") continue;
        const added = roleChanges(record.addedNodes, record.target), removed = roleChanges(record.removedNodes, record.target);
        if (added.listTokens.length || removed.listTokens.length || added.optionCount || removed.optionCount) push("options-mutation", { added, removed });
      }
      if (!field && !lastDOMSignature) return;
      const state = snapshot();
      const signature = JSON.stringify({ inputPresent: state.inputPresent, inputToken: "inputToken" in state ? state.inputToken : null,
        directoryDOM: "directoryDOM" in state ? state.directoryDOM : null });
      if (signature !== lastDOMSignature) {
        lastDOMSignature = signature;
        push("target-dom-commit-observed", { state, note: "MutationObserver delivery time, not the exact mutation instant" }, false);
      }
    };
    const listen = (target: EventTarget, type: string, callback: (event: Event) => void) => {
      const handler: EventListener = (event) => guard(() => callback(event));
      target.addEventListener(type, handler, { capture: true, passive: true });
      listeners.push([target, type, handler]);
    };
    for (const type of ["focus", "blur", "beforeinput", "input", "pointerdown", "mousedown", "scroll", "resize"]) {
      listen(window, type, (event) => {
        const field = input();
        const knownTarget = event.target instanceof Element && knownInputs.has(event.target);
        if (!field && !knownTarget) return;
        if (["focus", "blur", "beforeinput", "input"].includes(type) && !knownTarget) return;
        push(type, { target: describe(event.target), eventTimeStamp: event.timeStamp,
          targetIsInput: event.target === field, targetInsideControlRef: event.target instanceof Node && Boolean(field?.parentElement?.parentElement?.contains(event.target)) });
      });
    }
    if (window.visualViewport) for (const type of ["scroll", "resize"]) {
      listen(window.visualViewport, type, (event) => { if (input()) push("visualViewport-" + type, { eventTimeStamp: event.timeStamp }); });
    }
    observer = new MutationObserver((records) => guard(() => processMutations(records)));
    // Document is always a valid Node at document-start; documentElement/body need not exist.
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded"], attributeOldValue: true });
    if (typeof PerformanceObserver !== "undefined") guard(() => {
      resources = new PerformanceObserver((list) => guard(() => {
        for (const entry of list.getEntries()) {
          if (new URL(entry.name, location.href).pathname !== "/api/v1/matches/create-options") continue;
          const resource = entry as PerformanceResourceTiming & { responseStatus?: number };
          push("create-options-resource", { startTime: resource.startTime, responseStart: resource.responseStart,
            responseEnd: resource.responseEnd, duration: resource.duration, responseStatus: resource.responseStatus ?? null }, false);
        }
      }));
      resources.observe({ type: "resource", buffered: true });
    });
    const stopAndRead = () => {
      let finalState: unknown = null;
      guard(() => processMutations(observer?.takeRecords() ?? []));
      guard(() => { finalState = snapshot(); });
      stopped = true;
      observer?.disconnect();
      resources?.disconnect();
      for (const [target, type, handler] of listeners) guard(() => target.removeEventListener(type, handler, true));
      guard(() => safeProbe?.remove());
      return { version: 1, timeOrigin: performance.timeOrigin, cap, dropped, diagnosticErrors, events, finalState };
    };
    host.__tab10Gap012Passive = { stopAndRead };
  } catch {
    // Diagnostics must not create an application pageerror, even at document-start.
    host.__tab10Gap012Passive = { stopAndRead: () => ({ version: 1, installationFailed: true, diagnosticErrors: 1, events: [] }) };
  }
}
