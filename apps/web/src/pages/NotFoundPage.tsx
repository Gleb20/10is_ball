import { useNavigate } from "react-router-dom";
import { Button, EmptyState } from "../ui";
import { PageLayout } from "../layout";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <PageLayout title="Страница не найдена">
      <EmptyState
        title="Такой страницы нет"
        description="Проверьте адрес или вернитесь на главную."
        action={
          <div className="stack stack--actions">
            <Button onClick={() => navigate("/")}>На главную</Button>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Назад
            </Button>
          </div>
        }
      />
    </PageLayout>
  );
}
