import {
  useCallback,
  useLayoutEffect,
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
  type BracketMatchLike,
  type PlayerFate,
} from "../bracketViewModel";
import { Avatar, Button } from "../ui";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";

type Props = {
  names: Map<string, string> | Record<string, string>;
  matches: BracketMatchLike[];
  avatars?: Map<string, string | null> | Record<string, string | null>;
  seeds?: Map<string, number | null> | Record<string, number | null>;
} & (
  | { bracket: Bracket; graph?: undefined }
  | { graph: BracketGraphV2; bracket?: undefined }
);

type ConnectorPath = {
  key: string;
  d: string;
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
  return null;
}

function PlayerRow({
  card,
  side,
  scoreDigit,
}: {
  card: BracketCard;
  side: "a" | "b";
  scoreDigit: string | null;
}) {
  const slot = side === "a" ? card.slotA : card.slotB;
  return (
    <div
      className={[
        "tournament-bracket__player",
        slot.isBye ? "tournament-bracket__player--bye" : "",
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
          alt={slot.displayName}
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
  registerCard,
}: {
  card: BracketCard;
  registerCard: (key: string, el: HTMLElement | null) => void;
}) {
  const navigate = useNavigate();
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
        } as CSSProperties
      }
    >
      <PlayerRow
        card={card}
        side="a"
        scoreDigit={scoreParts?.[0] ?? null}
      />
      <PlayerRow
        card={card}
        side="b"
        scoreDigit={scoreParts?.[1] ?? null}
      />
      <div className="tournament-bracket__cta">
        {card.cta === "bye" ? (
          <span className="muted">
            {card.autoAdvanceName
              ? `Автопроход: ${card.autoAdvanceName}`
              : "Автопроход"}
          </span>
        ) : null}
        {card.cta === "pending" ? (
          <span className="muted">Ожидает игроков</span>
        ) : null}
        {card.cta === "judge" && card.matchId ? (
          <Button
            size="sm"
            onClick={() => navigate(`/matches/${card.matchId}/judge`)}
          >
            Судить
          </Button>
        ) : null}
        {card.cta === "open" && card.matchId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/matches/${card.matchId}`)}
          >
            Открыть
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function BandConnectors({
  band,
  containerRef,
  cardEls,
  revision,
}: {
  band: BracketBand;
  containerRef: RefObject<HTMLDivElement | null>;
  cardEls: Map<string, HTMLElement>;
  revision: number;
}) {
  const [paths, setPaths] = useState<ConnectorPath[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) {
      setPaths([]);
      return;
    }
    const rootBox = root.getBoundingClientRect();
    setSize({ w: root.scrollWidth, h: root.scrollHeight });

    const next: ConnectorPath[] = [];
    for (const col of band.columns) {
      for (const card of col.cards) {
        if (!card.feedsToCardKey || !card.winnerSide) continue;
        const fromCard = cardEls.get(card.key);
        const toCard = cardEls.get(card.feedsToCardKey);
        if (!fromCard || !toCard) continue;

        const winnerEl = fromCard.querySelector(
          `[data-bracket-player="${card.key}:${card.winnerSide}"]`,
        ) as HTMLElement | null;
        if (!winnerEl) continue;

        const fromBox = winnerEl.getBoundingClientRect();
        const toBox = toCard.getBoundingClientRect();

        const x1 = fromBox.right - rootBox.left + root.scrollLeft;
        const y1 =
          fromBox.top +
          fromBox.height / 2 -
          rootBox.top +
          root.scrollTop;
        const x2 = toBox.left - rootBox.left + root.scrollLeft;
        const y2 =
          toBox.top + toBox.height / 2 - rootBox.top + root.scrollTop;

        // Horizontal-ish cubic: leave winner row, curve into next card mid
        const dx = Math.max(24, (x2 - x1) * 0.55);
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        next.push({ key: `${card.key}->${card.feedsToCardKey}`, d });
      }
    }
    setPaths(next);
  }, [band, containerRef, cardEls, revision]);

  if (paths.length === 0 || size.w === 0) return null;

  return (
    <svg
      className="tournament-bracket__connectors"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
    >
      {paths.map((p) => (
        <path
          key={p.key}
          className="tournament-bracket__connector-path"
          d={p.d}
          fill="none"
        />
      ))}
    </svg>
  );
}

function BracketBandView({ band }: { band: BracketBand }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLElement>()).current;
  const [revision, setRevision] = useState(0);

  const registerCard = useCallback(
    (key: string, el: HTMLElement | null) => {
      if (el) cardEls.set(key, el);
      else cardEls.delete(key);
    },
    [cardEls],
  );

  useLayoutEffect(() => {
    const root = columnsRef.current;
    if (!root) return;
    const bump = () => setRevision((n) => n + 1);
    bump();
    const ro = new ResizeObserver(bump);
    ro.observe(root);
    for (const el of cardEls.values()) ro.observe(el);
    const scroll = scrollRef.current;
    scroll?.addEventListener("scroll", bump, { passive: true });
    window.addEventListener("resize", bump);
    return () => {
      ro.disconnect();
      scroll?.removeEventListener("scroll", bump);
      window.removeEventListener("resize", bump);
    };
  }, [band, cardEls]);

  return (
    <section
      className={`tournament-bracket__band tournament-bracket__band--${band.id}`}
    >
      <h3 className="tournament-bracket__band-title">{band.title}</h3>
      <div className="tournament-bracket__scroll" ref={scrollRef}>
        <div className="tournament-bracket__columns" ref={columnsRef}>
          <BandConnectors
            band={band}
            containerRef={columnsRef}
            cardEls={cardEls}
            revision={revision}
          />
          {band.columns.map((col) => {
            const unit = 118;
            const gap = 28;
            const padTop =
              col.round === 0
                ? 0
                : ((2 ** col.round - 1) / 2) * (unit + gap);
            return (
              <div
                key={col.key}
                className="tournament-bracket__column"
                style={
                  {
                    "--round": col.round,
                    "--pairs": col.cards.length,
                  } as CSSProperties
                }
              >
                <h4 className="tournament-bracket__round-title">
                  {col.label}
                </h4>
                <div
                  className="tournament-bracket__cards"
                  style={
                    {
                      "--card-gap": `${gap + col.round * 8}px`,
                      paddingTop: padTop,
                    } as CSSProperties
                  }
                >
                  {col.cards.map((card) => (
                    <MatchCard
                      key={card.key}
                      card={card}
                      registerCard={registerCard}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function TournamentBracket(props: Props) {
  const { names, matches, avatars, seeds } = props;
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
            alt={vm.championName}
          />
          <span>
            Чемпион: <strong>{vm.championName}</strong>
          </span>
        </div>
      ) : null}

      {vm.bands.map((band) => (
        <BracketBandView key={band.id} band={band} />
      ))}
    </div>
  );
}
