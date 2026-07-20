import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { api } from "../api";

export function OnboardingPage() {
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="stack">
      <h1 className="page-title">Онбординг</h1>
      <div className="card stack">
        <p>
          Tab-10 помогает быстро создавать матчи, вести счёт и проводить
          турниры по настольному теннису.
        </p>
        <p className="muted">
          Потренируйтесь с «Призрачным Олегом» — учебный матч не влияет на
          рейтинг.
        </p>
        <Button
          onClick={() =>
            api.tutorial().then((r) => {
              navigate(`/matches/${r.match.id}/judge`);
            })
          }
        >
          Матч с Призрачным Олегом
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            api.completeOnboarding().then(() => {
              setDone(true);
              navigate("/");
            })
          }
        >
          Пропустить
        </Button>
        {done && <p role="status">Готово</p>}
      </div>
    </div>
  );
}
