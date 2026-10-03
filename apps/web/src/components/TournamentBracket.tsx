import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import type { Bracket, BracketGraphV2 } from "@tab10/shared";
import {
  buildBracketViewModel,
  buildBracketViewModelV2,
  type BracketBand,
  type BracketCard,
  type BracketEdge,
  type BracketMatchLike,
  type BracketViewModel,
  type PlayerFate,
} from "../bracketViewModel";
import { Avatar, Button } from "../ui";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";

type Props = {
  tournamentId?: string;
  userId?: string;
  names: Map<string, string> | Record<string, string>;
  matches: BracketMatchLike[];
  avatars?: Map<string, string | null> | Record<string, string | null>;
  seeds?: Map<string, number | null> | Record<string, number | null>;
  highlightedParticipantIds?: ReadonlySet<string>;
} & (
  | { bracket: Bracket; graph?: undefined }
  | { graph: BracketGraphV2; bracket?: undefined }
);

type ConnectorPath = {
  key: string;
  d: string;
  outcome: BracketEdge["outcome"];
  sourceSide: BracketEdge["resolvedSourceSide"];
  sourceCardKey: string;
  destinationCardKey: string;
  destinationSide: BracketEdge["destinationSide"];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function FateBadge({ fate }: { fate: PlayerFate }) {
  if (fate === "drop") {
    return (
      <span
        className="tournament-bracket__fate tournament-bracket__fate--drop"
        title="В сетку проигравших"
        aria-label="В сетку проигравших"
      >
        ↓
      </span>
    );
  }
  if (fate === "eliminated") {
    return (
      <span
        className="tournament-bracket__fate tournament-bracket__fate--out"
        title="Выбыл"
        aria-label="Выбыл"
      >
        ✕
      </span>
    );
  }
  return (
    <span
      className="tournament-bracket__fate tournament-bracket__fate--empty"
      aria-hidden="true"
    />
  );
}

function PlayerRow({
  card,
  side,
  scoreDigit,
  highlightedParticipantIds,
}: {
  card: BracketCard;
  side: "a" | "b";
  scoreDigit: string | null;
  highlightedParticipantIds?: ReadonlySet<string>;
}) {
  const slot = side === "a" ? card.slotA : card.slotB;
  return (
    <div
      className={[
        "tournament-bracket__player",
        slot.isBye ? "tournament-bracket__player--bye" : "",
        slot.participantId && highlightedParticipantIds?.has(slot.participantId)
          ? "tournament-bracket__player--current"
          : "",
        slot.isWinner ? "tournament-bracket__player--winner" : "",
        card.decided && !slot.isWinner && !slot.isBye
          ? "tournament-bracket__player--loser"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-bracket-player={`${card.key}:${side}`}
    >
      {!slot.isBye ? (
        <Avatar
          size="sm"
          variant="tonal"
          src={avatarSrc(slot.avatarKey)}
          initials={initialsFromName(slot.displayName)}
          alt=""
          aria-hidden="true"
        />
      ) : (
        <span className="tournament-bracket__bye-mark">BYE</span>
      )}
      <span className="tournament-bracket__name">
        {slot.seed != null ? (
          <span className="tournament-bracket__seed">#{slot.seed}</span>
        ) : null}
        {slot.isBye ? "—" : slot.displayName}
      </span>
      {scoreDigit != null ? (
        <span className="tournament-bracket__score">{scoreDigit}</span>
      ) : null}
      <FateBadge fate={slot.fate} />
    </div>
  );
}

function MatchCard({
  card,
  layoutSlot,
  registerCard,
  highlightedParticipantIds,
  onOpen,
}: {
  card: BracketCard;
  layoutSlot: number;
  registerCard: (key: string, el: HTMLElement | null) => void;
  highlightedParticipantIds?: ReadonlySet<string>;
  onOpen: (matchId: string, judge: boolean, cardKey: string) => void;
}) {
  const scoreParts = card.scoreLabel?.split(":") ?? null;

  return (
    <article
      ref={(el) => registerCard(card.key, el)}
      className={[
        "tournament-bracket__card",
        card.decided ? "tournament-bracket__card--decided" : "",
        card.feedsToCardKey ? "tournament-bracket__card--feeds" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-status={card.status ?? "pending"}
      data-bracket-card={card.key}
      style={
        {
          "--pair-index": card.pairIndex,
          "--pairs-in-round": card.pairsInRound,
          "--bracket-grid-row": layoutSlot + 2,
        } as CSSProperties
      }
    >
      <PlayerRow
        card={card}
        side="a"
        scoreDigit={scoreParts?.[0] ?? null}
        highlightedParticipantIds={highlightedParticipantIds}
      />
      <PlayerRow
        card={card}
        side="b"
        scoreDigit={scoreParts?.[1] ?? null}
        highlightedParticipantIds={highlightedParticipantIds}
      />
      <div className="tournament-bracket__cta">
        {card.cta === "bye" ? (
          <span className="muted">
            {card.autoAdvanceName
              ? `${card.autoAdvanceName} · Проходит дальше без матча`
              : "Проходит дальше без матча"}
          </span>
        ) : null}
        {card.cta === "pending" ? (
          <span className="muted">Ожидает игроков</span>
        ) : null}
        {card.cta === "judge" && card.matchId ? (
          <Button
            size="sm"
            aria-label={`Судить: ${card.slotA.displayName} — ${card.slotB.displayName}`}
            onClick={() => onOpen(card.matchId!, true, card.key)}
          >
            Судить
          </Button>
        ) : null}
        {card.cta === "open" && card.matchId ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Открыть: ${card.slotA.displayName} — ${card.slotB.displayName}`}
            onClick={() => onOpen(card.matchId!, false, card.key)}
          >
            Открыть
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function BracketConnectors({
  edges,
  containerRef,
  cardEls,
  revision,
  layoutZoom,
}: {
  edges: BracketEdge[];
  containerRef: RefObject<HTMLDivElement | null>;
  cardEls: Map<string, HTMLElement>;
  revision: number;
  layoutZoom: number;
}) {
  const [paths, setPaths] = useState<ConnectorPath[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    // Keep the last complete connections while the browser settles its SVG viewport.
    // Clearing them here produces empty frames on resize and background refresh.
    let measureFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      measureFrame = window.requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) return;
      const svg = svgRef.current;
      const screenMatrix = svg?.getScreenCTM();
      const scaleX = screenMatrix ? Math.hypot(screenMatrix.a, screenMatrix.b) : 0;
      const scaleY = screenMatrix ? Math.hypot(screenMatrix.c, screenMatrix.d) : 0;
      const rootBox = root.getBoundingClientRect();
      const nextSize = scaleX > 0 && scaleY > 0
        ? { w: rootBox.width / scaleX, h: rootBox.height / scaleY }
        : { w: root.clientWidth, h: root.clientHeight };
      if (Math.abs(size.w - nextSize.w) > 0.001 || Math.abs(size.h - nextSize.h) > 0.001) {
        setSize(nextSize);
        return;
      }
      if (!svg || !screenMatrix) return;
      const screenToSvg = screenMatrix.inverse();
      const toSvgPoint = (x: number, y: number) =>
        new DOMPoint(x, y).matrixTransform(screenToSvg);

      const next: ConnectorPath[] = [];
      const renderedCards = Array.from(
        root.querySelectorAll<HTMLElement>("[data-bracket-card]"),
      );
      const renderedCardByKey = new Map(
        renderedCards.map((card) => [card.dataset.bracketCard, card]),
      );
      for (const edge of edges) {
        const fromCard = cardEls.get(edge.sourceCardKey) ?? renderedCardByKey.get(edge.sourceCardKey);
        const toCard = cardEls.get(edge.destinationCardKey) ?? renderedCardByKey.get(edge.destinationCardKey);
        if (!fromCard || !toCard) continue;
        const resolvedSource = edge.resolvedSourceSide
          ? fromCard.querySelector<HTMLElement>(
              `[data-bracket-player="${edge.sourceCardKey}:${edge.resolvedSourceSide}"]`,
            )
          : null;
        const destination = toCard.querySelector<HTMLElement>(
          `[data-bracket-player="${edge.destinationCardKey}:${edge.destinationSide}"]`,
        );
        if (!destination) continue;

        const sourceBox = (resolvedSource ?? fromCard).getBoundingClientRect();
        const destinationBox = destination.getBoundingClientRect();
        const sourcePoint = toSvgPoint(
          sourceBox.right,
          resolvedSource
            ? sourceBox.top + sourceBox.height / 2
            : sourceBox.top + sourceBox.height * (edge.outcome === "winner" ? 0.36 : 0.64),
        );
        const destinationPoint = toSvgPoint(
          destinationBox.left,
          destinationBox.top + destinationBox.height / 2,
        );
        const x1 = sourcePoint.x;
        const y1 = sourcePoint.y;
        const x2 = destinationPoint.x;
        const y2 = destinationPoint.y;
        const turnX = x2 > x1 + 48
          ? x1 + (x2 - x1) / 2
          : Math.max(x1, x2) + 32;
        const d = `M ${x1} ${y1} C ${turnX} ${y1}, ${turnX} ${y2}, ${x2} ${y2}`;
        next.push({
          key: edge.key,
          d,
          outcome: edge.outcome,
          sourceSide: edge.resolvedSourceSide,
          sourceCardKey: edge.sourceCardKey,
          destinationCardKey: edge.destinationCardKey,
          destinationSide: edge.destinationSide,
          x1,
          y1,
          x2,
          y2,
        });
      }
      setPaths(next);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(measureFrame);
    };
  }, [edges, containerRef, cardEls, layoutZoom, revision, size.h, size.w]);

  if (size.w === 0 || size.h === 0) return null;

  return (
    <svg
      ref={svgRef}
      className="tournament-bracket__connectors"
      data-layout-zoom={layoutZoom}
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      style={{ width: size.w, height: size.h }}
      aria-hidden="true"
    >
      {paths.map((p) => (
        <path
          key={p.key}
          className={`tournament-bracket__connector-path tournament-bracket__connector-path--${p.outcome}`}
          d={p.d}
          fill="none"
          data-edge-key={p.key}
          data-edge-outcome={p.outcome}
          data-source-side={p.sourceSide ?? ""}
          data-source-card={p.sourceCardKey}
          data-destination-card={p.destinationCardKey}
          data-destination-side={p.destinationSide}
          data-x1={p.x1}
          data-y1={p.y1}
          data-x2={p.x2}
          data-y2={p.y2}
        />
      ))}
    </svg>
  );
}

function BracketBandView({
  band,
  registerCard,
  highlightedParticipantIds,
  onOpen,
}: {
  band: BracketBand;
  registerCard: (key: string, el: HTMLElement | null) => void;
  highlightedParticipantIds?: ReadonlySet<string>;
  onOpen: (matchId: string, judge: boolean, cardKey: string) => void;
}) {
  const headingId = useId();
  const slotCount = Math.max(
    1,
    ...band.columns.map((column) => column.cards.length),
  );

  return (
    <section
      className={`tournament-bracket__band tournament-bracket__band--${band.id}`}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className="tournament-bracket__band-title">{band.title}</h3>
      <div
        className="tournament-bracket__columns"
        style={{
          "--bracket-column-count": band.columns.length,
          "--bracket-slot-count": slotCount,
        } as CSSProperties}
      >
        {band.columns.map((col, columnIndex) => (
          <div
            key={col.key}
            className="tournament-bracket__column"
            style={{
              "--bracket-column": columnIndex + 1,
              "--bracket-grid-span": slotCount + 1,
            } as CSSProperties}
          >
            <h4 className="tournament-bracket__round-title">{col.label}</h4>
            <div className="tournament-bracket__cards">
              {col.cards.map((card, cardIndex) => (
                <MatchCard
                  key={card.key}
                  card={card}
                  layoutSlot={Math.floor(cardIndex * slotCount / Math.max(1, col.cards.length))}
                  registerCard={registerCard}
                  highlightedParticipantIds={highlightedParticipantIds}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type ReturnState = {
  tournamentId: string;
  userId: string;
  bandId: BracketBand["id"];
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  windowY: number;
  cardKey: string;
};

function BracketView({
  vm,
  highlightedParticipantIds,
  tournamentId,
  userId,
}: {
  vm: BracketViewModel;
  highlightedParticipantIds?: ReadonlySet<string>;
  tournamentId?: string;
  userId?: string;
}) {
  const navigate = useNavigate();
  const headingId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const initialViewportApplied = useRef(false);
  const cardEls = useRef(new Map<string, HTMLElement>()).current;
  const [revision, setRevision] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [returnState] = useState<ReturnState | null>(() => {
    if (!tournamentId || !userId) return null;
    try {
      const raw = window.sessionStorage.getItem("tab10.bracket.return");
      const saved = raw ? JSON.parse(raw) as ReturnState : null;
      return saved?.tournamentId === tournamentId && saved.userId === userId ? saved : null;
    } catch {
      return null;
    }
  });
  const initialZoom = returnState && [75, 100, 125, 150].includes(returnState.zoom)
    ? returnState.zoom
    : 100;
  const [zoom, setZoom] = useState(initialZoom);
  const [scrollEdges, setScrollEdges] = useState({ start: true, end: false });
  const columnWidth = 220 * zoom / 100;

  const updateScrollEdges = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    setScrollEdges({
      start: scroll.scrollLeft <= 1,
      end: scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1,
    });
  }, []);
  const registerCard = useCallback((key: string, el: HTMLElement | null) => {
    if (el) cardEls.set(key, el);
    else cardEls.delete(key);
  }, [cardEls]);
  const scrollRound = useCallback((direction: number) => {
    scrollRef.current?.scrollBy({ left: direction * (columnWidth + 48), behavior: "auto" });
  }, [columnWidth]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bump = () => {
      setRevision((value) => value + 1);
      updateScrollEdges();
    };
    bump();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(bump);
    observer?.observe(canvas);
    for (const card of cardEls.values()) observer?.observe(card);
    window.addEventListener("resize", bump);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", bump);
    };
  }, [cardEls, updateScrollEdges, vm]);

  useLayoutEffect(() => {
    if (!returnState) return;
    try { window.sessionStorage.removeItem("tab10.bracket.return"); } catch { /* optional return context */ }
    const frame = window.requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (scroll) {
        scroll.scrollLeft = returnState.scrollLeft;
        scroll.scrollTop = returnState.scrollTop;
      }
      window.scrollTo(0, returnState.windowY);
      cardEls.get(returnState.cardKey)?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      updateScrollEdges();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cardEls, returnState, updateScrollEdges]);

  useLayoutEffect(() => {
    if (initialViewportApplied.current || returnState) return;
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    if (!scroll || !canvas) return;
    const cardKey = vm.workingMatchCardKey;
    if (!cardKey) {
      initialViewportApplied.current = true;
      return;
    }
    const card = cardEls.get(cardKey) ?? Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-bracket-card]"),
    ).find((item) => item.dataset.bracketCard === cardKey);
    if (!card) return;
    const scrollBox = scroll.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const left = Math.max(
      0,
      scroll.scrollLeft + cardBox.left - scrollBox.left - (scroll.clientWidth - cardBox.width) / 2,
    );
    const top = Math.max(0, scroll.scrollTop + cardBox.top - scrollBox.top - 16);
    if (typeof scroll.scrollTo === "function") {
      scroll.scrollTo({ left, top, behavior: "auto" });
    } else {
      scroll.scrollLeft = left;
      scroll.scrollTop = top;
    }
    initialViewportApplied.current = true;
    updateScrollEdges();
  }, [cardEls, returnState, revision, updateScrollEdges, vm.workingMatchCardKey]);

  useEffect(() => {
    if (!isFullscreen) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsFullscreen(false);
      window.requestAnimationFrame(() => fullscreenButtonRef.current?.focus());
    };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [isFullscreen]);

  function openMatch(matchId: string, judge: boolean, cardKey: string) {
    if (tournamentId && userId) {
      const scroll = scrollRef.current;
      const bandId = vm.bands.find((band) => band.columns.some((column) => column.cards.some((card) => card.key === cardKey)))?.id ?? "winners";
      try {
        window.sessionStorage.setItem("tab10.bracket.return", JSON.stringify({
          tournamentId,
          userId,
          bandId,
          zoom,
          scrollLeft: scroll?.scrollLeft ?? 0,
          scrollTop: scroll?.scrollTop ?? 0,
          windowY: window.scrollY,
          cardKey,
          matchId,
        }));
      } catch { /* navigation does not depend on saved position */ }
    }
    navigate(`/matches/${matchId}${judge ? "/judge" : ""}`, {
      state: tournamentId ? { returnTo: `/tournaments/${tournamentId}`, returnLabel: "К сетке" } : undefined,
    });
  }

  return (
    <div className={`tournament-bracket__viewport${isFullscreen ? " tournament-bracket__viewport--fullscreen" : ""}`}>
      <h2 id={headingId} className="visually-hidden">Турнирная сетка</h2>
      <div className="row tournament-bracket__navigation" role="group" aria-label="Навигация по турнирной сетке">
        <Button variant="secondary" disabled={scrollEdges.start} onClick={() => scrollRound(-1)} aria-label="Предыдущий раунд">←</Button>
        <Button variant="secondary" disabled={scrollEdges.end} onClick={() => scrollRound(1)} aria-label="Следующий раунд">→</Button>
        <Button variant="secondary" disabled={zoom === 75} onClick={() => setZoom((value) => Math.max(75, value - 25))} aria-label="Уменьшить сетку">−</Button>
        <output aria-label="Масштаб сетки">{zoom}%</output>
        <Button variant="secondary" disabled={zoom === 150} onClick={() => setZoom((value) => Math.min(150, value + 25))} aria-label="Увеличить сетку">+</Button>
        <Button
          ref={fullscreenButtonRef}
          variant="secondary"
          aria-pressed={isFullscreen}
          onClick={() => setIsFullscreen((value) => !value)}
        >
          {isFullscreen ? "Закрыть полный экран" : "На весь экран"}
        </Button>
      </div>
      <div className="tournament-bracket__legend" aria-label="Обозначения переходов">
        <span><i className="tournament-bracket__legend-line" aria-hidden="true" />Победитель</span>
        <span><i className="tournament-bracket__legend-line tournament-bracket__legend-line--loser" aria-hidden="true" />Проигравший</span>
      </div>
      <div
        className="tournament-bracket__scroll"
        ref={scrollRef}
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        style={{ "--bracket-column-width": `${columnWidth}px` } as CSSProperties}
        onScroll={updateScrollEdges}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            scrollRound(event.key === "ArrowRight" ? 1 : -1);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            event.currentTarget.scrollLeft = event.key === "Home" ? 0 : event.currentTarget.scrollWidth;
          }
        }}
      >
        <div className="tournament-bracket__canvas" ref={canvasRef}>
          <BracketConnectors
            edges={vm.edges}
            containerRef={canvasRef}
            cardEls={cardEls}
            revision={revision}
            layoutZoom={zoom}
          />
          {vm.bands.map((band) => (
            <BracketBandView
              key={band.id}
              band={band}
              registerCard={registerCard}
              highlightedParticipantIds={highlightedParticipantIds}
              onOpen={openMatch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TournamentBracket(props: Props) {
  const { names, matches, avatars, seeds, highlightedParticipantIds, tournamentId, userId } = props;
  const vm =
    "graph" in props && props.graph
      ? buildBracketViewModelV2(props.graph, names, matches, {
          avatars,
          seeds,
        })
      : buildBracketViewModel(props.bracket!, names, matches, {
          avatars,
          seeds,
        });

  return (
    <div className="tournament-bracket stack">
      {vm.championName ? (
        <div className="tournament-bracket__champion" role="status">
          <Avatar
            size="sm"
            variant="contained"
            color="primary"
            src={avatarSrc(vm.championAvatarKey)}
            initials={initialsFromName(vm.championName)}
            alt=""
            aria-hidden="true"
          />
          <span>
            Чемпион: <strong>{vm.championName}</strong>
          </span>
        </div>
      ) : null}

      <BracketView
        vm={vm}
        highlightedParticipantIds={highlightedParticipantIds}
        tournamentId={tournamentId}
        userId={userId}
      />
    </div>
  );
}
