import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { PageLayout } from "../layout";
import { api } from "../api";

export function OnboardingPage() {
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  return (
    <PageLayout title="Онбординг">
      <div className="card stack">
        <p>
          Tab-10 помогает быстро создавать матчи, вести счёт и проводить
          турниры по настольному теннису.
        </p>
        <p className="muted">
          Потренируйтесь с «Призрачным Олегом» — учебный матч не влияет на
          рейтинг.
        </p>
        <div className="stack stack--actions">
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
        </div>
        {done && <p role="status">Готово</p>}
      </div>
    </PageLayout>
  );
}
