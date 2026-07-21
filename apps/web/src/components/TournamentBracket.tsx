import { useNavigate } from "react-router-dom";
import type { Bracket } from "@tab10/shared";
import {
  buildBracketViewModel,
  type BracketMatchLike,
} from "../bracketViewModel";
import { Avatar, Button } from "../ui";
import { initialsFromName } from "../rankingUi";
import { avatarSrc } from "../avatarSrc";

type Props = {
  bracket: Bracket;
  names: Map<string, string> | Record<string, string>;
  matches: BracketMatchLike[];
  avatars?: Map<string, string | null> | Record<string, string | null>;
  seeds?: Map<string, number | null> | Record<string, number | null>;
};

export function TournamentBracket({
  bracket,
  names,
  matches,
  avatars,
  seeds,
}: Props) {
  const navigate = useNavigate();
  const vm = buildBracketViewModel(bracket, names, matches, {
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
        <section
          key={band.id}
          className={`tournament-bracket__band tournament-bracket__band--${band.id}`}
        >
          <h3 className="tournament-bracket__band-title">{band.title}</h3>
          <div className="tournament-bracket__scroll">
            <div className="tournament-bracket__columns">
              {band.columns.map((col) => (
                <div key={col.key} className="tournament-bracket__column">
                  <h4 className="tournament-bracket__round-title">
                    {col.label}
                  </h4>
                  <div className="tournament-bracket__cards">
                    {col.cards.map((card) => (
                      <article
                        key={card.key}
                        className="tournament-bracket__card"
                        data-status={card.status ?? "pending"}
                      >
                        {[card.slotA, card.slotB].map((slot, idx) => (
                          <div
                            key={idx}
                            className={[
                              "tournament-bracket__player",
                              slot.isBye
                                ? "tournament-bracket__player--bye"
                                : "",
                              slot.isWinner
                                ? "tournament-bracket__player--winner"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {!slot.isBye ? (
                              <Avatar
                                size="sm"
                                variant="tonal"
                                src={avatarSrc(slot.avatarKey)}
                                initials={initialsFromName(
                                  slot.displayName,
                                )}
                                alt={slot.displayName}
                              />
                            ) : (
                              <span className="tournament-bracket__bye-mark">
                                BYE
                              </span>
                            )}
                            <span className="tournament-bracket__name">
                              {slot.seed != null ? (
                                <span className="tournament-bracket__seed">
                                  #{slot.seed}
                                </span>
                              ) : null}
                              {slot.isBye ? "—" : slot.displayName}
                            </span>
                            {card.scoreLabel ? (
                              <span className="tournament-bracket__score">
                                {card.scoreLabel.split(":")[idx]}
                              </span>
                            ) : null}
                          </div>
                        ))}
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
                              onClick={() =>
                                navigate(
                                  `/matches/${card.matchId}/judge`,
                                )
                              }
                            >
                              Судить
                            </Button>
                          ) : null}
                          {card.cta === "open" && card.matchId ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                navigate(`/matches/${card.matchId}`)
                              }
                            >
                              Открыть
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
