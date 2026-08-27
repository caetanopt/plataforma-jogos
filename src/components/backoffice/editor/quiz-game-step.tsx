import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import {
  addAnswerAction,
  addQuestionAction,
  addResultProfileAction,
  moveQuestionAction,
  removeAnswerAction,
  removeQuestionAction,
  removeResultProfileAction,
  toggleAnswerCorrectAction,
  updateQuestionAction,
  updateQuizConfigAction,
} from "@/features/quiz-game/actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

const QUESTION_TYPE_LABELS = {
  SINGLE_CHOICE: "Escolha única",
  MULTIPLE_CHOICE: "Escolha múltipla",
  TRUE_FALSE: "Verdadeiro ou falso",
  IMAGE_CHOICE: "Respostas com imagem",
};

export async function QuizGameStep({ campaignId }: { campaignId: string }) {
  const context = await requireOrgContext();
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId, type: "QUIZ" },
    include: {
      quizConfig: {
        include: {
          questions: { include: { answers: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          resultProfiles: { orderBy: { minPercentage: "asc" } },
        },
      },
    },
  });
  if (!campaign?.quizConfig) notFound();

  const quizConfig = campaign.quizConfig;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-caetano-anthracite">Configuração do Quiz Interativo</h2>
          <p className="mt-1 text-sm text-caetano-medium-gray">
            Defina as perguntas, a pontuação e os perfis de resultado.
          </p>
        </div>
        <Link
          href={`/apps/${campaignId}/preview`}
          className="shrink-0 rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-neutral-100"
        >
          Pré-visualizar
        </Link>
      </div>

      <AutoSaveForm
        action={updateQuizConfigAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="questionsPerParticipation">Perguntas por participação</Label>
            <Input id="questionsPerParticipation" name="questionsPerParticipation" type="number" min={1} defaultValue={quizConfig.questionsPerParticipation ?? ""} />
          </div>
          <div>
            <Label htmlFor="totalTimeLimitSeconds">Tempo total (s)</Label>
            <Input id="totalTimeLimitSeconds" name="totalTimeLimitSeconds" type="number" min={0} defaultValue={quizConfig.totalTimeLimitSeconds ?? ""} />
          </div>
          <div>
            <Label htmlFor="perQuestionTimeLimitSeconds">Tempo por pergunta (s)</Label>
            <Input id="perQuestionTimeLimitSeconds" name="perQuestionTimeLimitSeconds" type="number" min={0} defaultValue={quizConfig.perQuestionTimeLimitSeconds ?? ""} />
          </div>
          <div>
            <Label htmlFor="penaltyPerWrong">Penalização por erro</Label>
            <Input id="penaltyPerWrong" name="penaltyPerWrong" type="number" min={0} defaultValue={quizConfig.penaltyPerWrong} />
          </div>
          <div>
            <Label htmlFor="minPassPercentage">Aprovação mínima (%)</Label>
            <Input id="minPassPercentage" name="minPassPercentage" type="number" min={0} max={100} defaultValue={quizConfig.minPassPercentage ?? ""} />
          </div>
          <div>
            <Label htmlFor="maxAttempts">Máx. tentativas</Label>
            <Input id="maxAttempts" name="maxAttempts" type="number" min={0} defaultValue={quizConfig.maxAttempts ?? ""} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["randomizeQuestionOrder", "Ordem aleatória das perguntas", quizConfig.randomizeQuestionOrder],
              ["randomizeAnswerOrder", "Ordem aleatória das respostas", quizConfig.randomizeAnswerOrder],
              ["speedBonusEnabled", "Bónus por rapidez", quizConfig.speedBonusEnabled],
              ["allowGoBack", "Permitir voltar atrás", quizConfig.allowGoBack],
              ["showProgress", "Mostrar progresso", quizConfig.showProgress],
              ["showCorrectAnswer", "Mostrar resposta correta", quizConfig.showCorrectAnswer],
              ["showExplanation", "Mostrar explicação", quizConfig.showExplanation],
            ] as const
          ).map(([name, label, checked]) => (
            <label key={name} className="flex items-center gap-2 text-sm text-caetano-anthracite">
              <input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4 rounded border-caetano-medium-gray" />
              {label}
            </label>
          ))}
        </div>
        <SaveStatus />
      </AutoSaveForm>

      <section className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-caetano-anthracite">
          Perguntas ({quizConfig.questions.length})
        </h3>

        {quizConfig.questions.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-medium-gray">
            Ainda não há perguntas. Adicione a primeira abaixo.
          </p>
        )}

        <ul className="space-y-3">
          {quizConfig.questions.map((question, index) => (
            <li key={question.id} className="rounded-lg border border-caetano-medium-gray/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-caetano-anthracite">{question.title}</span>
                  <span className="ml-2 text-xs text-caetano-medium-gray">
                    {QUESTION_TYPE_LABELS[question.type]} · {question.points} pts
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <form action={moveQuestionAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit" disabled={index === 0} className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30" aria-label="Mover para cima">↑</button>
                  </form>
                  <form action={moveQuestionAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button type="submit" disabled={index === quizConfig.questions.length - 1} className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30" aria-label="Mover para baixo">↓</button>
                  </form>
                  <form action={removeQuestionAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <ConfirmSubmitButton confirmMessage="Remover esta pergunta?" size="sm">
                      Remover
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-caetano-cyan">Editar pergunta e respostas</summary>

                <form action={updateQuestionAction} className="mt-2 space-y-2">
                  <input type="hidden" name="campaignId" value={campaignId} />
                  <input type="hidden" name="questionId" value={question.id} />
                  <Input name="title" defaultValue={question.title} required placeholder="Título" />
                  <Input name="supportText" defaultValue={question.supportText ?? ""} placeholder="Texto de apoio" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="points" type="number" min={0} defaultValue={question.points} placeholder="Pontos" />
                    <Input name="timeLimitSeconds" type="number" min={0} defaultValue={question.timeLimitSeconds ?? ""} placeholder="Tempo limite (s)" />
                  </div>
                  <textarea name="explanation" defaultValue={question.explanation ?? ""} placeholder="Explicação" rows={2} className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm" />
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="required" defaultChecked={question.required} className="h-4 w-4 rounded border-caetano-medium-gray" />
                      Obrigatória
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="immediateFeedback" defaultChecked={question.immediateFeedback} className="h-4 w-4 rounded border-caetano-medium-gray" />
                      Feedback imediato
                    </label>
                  </div>
                  <Button type="submit" size="sm" variant="outline">Guardar pergunta</Button>
                </form>

                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-caetano-anthracite">Respostas</p>
                  <ul className="space-y-1">
                    {question.answers.map((answer) => (
                      <li key={answer.id} className="flex items-center justify-between gap-2 text-sm">
                        <form action={toggleAnswerCorrectAction} className="flex items-center gap-2">
                          <input type="hidden" name="campaignId" value={campaignId} />
                          <input type="hidden" name="questionId" value={question.id} />
                          <input type="hidden" name="answerId" value={answer.id} />
                          <button
                            type="submit"
                            disabled={question.type === "TRUE_FALSE"}
                            aria-label={answer.isCorrect ? "Resposta correta" : "Marcar como correta"}
                            className={`h-5 w-5 rounded-full border ${answer.isCorrect ? "border-caetano-eco-green bg-caetano-eco-green" : "border-caetano-medium-gray"}`}
                          />
                          <span>{answer.text}</span>
                        </form>
                        {question.type !== "TRUE_FALSE" && (
                          <form action={removeAnswerAction}>
                            <input type="hidden" name="campaignId" value={campaignId} />
                            <input type="hidden" name="questionId" value={question.id} />
                            <input type="hidden" name="answerId" value={answer.id} />
                            <button type="submit" className="text-xs text-red-600 hover:underline">
                              Remover
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>

                  {question.type !== "TRUE_FALSE" && (
                    <form
                      key={`add-answer-${question.answers.length}`}
                      action={addAnswerAction}
                      className="mt-2 flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="questionId" value={question.id} />
                      <Input name="text" placeholder="Nova resposta" className="h-8" required />
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="isCorrect" className="h-4 w-4 rounded border-caetano-medium-gray" />
                        Correta
                      </label>
                      <Button type="submit" size="sm" variant="outline">
                        Adicionar resposta
                      </Button>
                    </form>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>

        <form action={addQuestionAction} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="campaignId" value={campaignId} />
          <div>
            <Label htmlFor="type">Tipo</Label>
            <select id="type" name="type" className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
              {(Object.entries(QUESTION_TYPE_LABELS) as [string, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="title">Título</Label>
            <Input id="title" name="title" required />
          </div>
          <Button type="submit" variant="outline">
            Adicionar pergunta
          </Button>
        </form>
      </section>

      <section className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-caetano-anthracite">
          Perfis de resultado ({quizConfig.resultProfiles.length})
        </h3>

        {quizConfig.resultProfiles.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-medium-gray">
            Ainda não há perfis de resultado (opcional).
          </p>
        )}

        <ul className="space-y-2">
          {quizConfig.resultProfiles.map((profile) => (
            <li key={profile.id} className="flex items-center justify-between gap-2 rounded-lg border border-caetano-medium-gray/20 p-3">
              <div>
                <span className="font-medium text-caetano-anthracite">{profile.title}</span>
                <span className="ml-2 text-xs text-caetano-medium-gray">
                  {profile.minPercentage}%–{profile.maxPercentage}%
                </span>
              </div>
              <form action={removeResultProfileAction}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="profileId" value={profile.id} />
                <ConfirmSubmitButton confirmMessage={`Remover o perfil "${profile.title}"?`} size="sm">
                  Remover
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-caetano-cyan">Adicionar perfil de resultado</summary>
          <form action={addResultProfileAction} className="mt-2 max-w-md space-y-2">
            <input type="hidden" name="campaignId" value={campaignId} />
            <div className="grid grid-cols-2 gap-2">
              <Input name="minPercentage" type="number" min={0} max={100} placeholder="% mínima" required />
              <Input name="maxPercentage" type="number" min={0} max={100} placeholder="% máxima" required />
            </div>
            <Input name="title" placeholder="Título" required />
            <textarea name="description" placeholder="Descrição" rows={2} className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <Input name="ctaLabel" placeholder="Texto do botão (opcional)" />
              <Input name="ctaUrl" placeholder="Link (opcional)" />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Adicionar perfil
            </Button>
          </form>
        </details>
      </section>
    </div>
  );
}
