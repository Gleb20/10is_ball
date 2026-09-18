import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { PageLayout } from "../layout";

/** Start hub — ADR D5 / UX §1 «Начать». */
export function StartPage() {
  const navigate = useNavigate();

  return (
    <PageLayout title="Начать">
      <p className="muted">Выберите, что создать</p>
      <div className="stack stack--actions">
        <Button onClick={() => navigate("/matches/new")}>Матч</Button>
        <Button variant="secondary" onClick={() => navigate("/tournaments")}>
          Турнир
        </Button>
      </div>
    </PageLayout>
  );
}
