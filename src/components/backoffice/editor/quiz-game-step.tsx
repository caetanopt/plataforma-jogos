import Link from "next/link";
import { notFound } from "next/navigation";
import type { QuestionType } from "@/generated/prisma/client";
import { requirePagePermission } from "@/server/auth/page-guard";
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
import {
  QUIZ_ANSWER_LIMITS,
  QUIZ_CONFIG_LIMITS,
  QUIZ_QUESTION_LIMITS,
  RESULT_PROFILE_LIMITS,
  allowsSeveralCorrectAnswers,
} from "@/lib/validation/quiz-game";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Escolha única",
  MULTIPLE_CHOICE: "Escolha múltipla",
  TRUE_FALSE: "Verdadeiro ou falso",
  IMAGE_CHOICE: "Respostas com imagem",
};

// O jogo mostra estas imagens com `<img>`: sem vídeo.
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/svg+xml";

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-caetano-medium-gray bg-white px-3 text-sm text-caetano-anthracite focus-visible:border-caetano-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan aria-invalid:border-danger";
const TEXTAREA_CLASS =
  "w-full rounded-lg border border-caetano-medium-gray bg-white px-3 py-2 text-sm text-caetano-anthracite focus-visible:border-caetano-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan aria-invalid:border-danger";
const HELP_CLASS = "mt-1 text-xs text-caetano-anthracite-80";
const ICON_BUTTON_CLASS =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded text-caetano-anthracite-80 transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40 disabled:pointer-events-none disabled:cursor-default disabled:opacity-30";

/** Input numérico com label e, opcionalmente, uma linha de ajuda ligada por aria-describedby. */
function NumberField({
  id,
  name,
  label,
  min,
  max,
  defaultValue,
  help,
  required,
}: {
  id: string;
  name: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number | null;
  help?: string;
  required?: boolean;
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        required={required}
        defaultValue={defaultValue ?? ""}
        aria-describedby={helpId}
      />
      {help && (
        <p id={helpId} className={HELP_CLASS}>
          {help}
        </p>
      )}
    </div>
  );
}

export async function QuizGameStep({ campaignId }: { campaignId: string }) {
  // Mostra códigos de vouchers, pesos e respostas certas: a permissão é
  // verificada aqui também, e não só na página que o inclui.
  const context = await requirePagePermission("campaign:edit");
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

  // Imagens das perguntas e das respostas, só da própria organização.
  const mediaIds = [
    ...new Set(
      quizConfig.questions
        .flatMap((question) => [question.imageMediaId, ...question.answers.map((answer) => answer.imageMediaId)])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const media =
    mediaIds.length > 0
      ? await prisma.mediaAsset.findMany({
          where: { id: { in: mediaIds }, organizationId: context.organizationId },
          select: { id: true, url: true, kind: true, altText: true },
        })
      : [];
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-caetano-anthracite">Configuração do Quiz Interativo</h2>
          <p className="mt-1 text-sm text-caetano-anthracite-80">
            Defina as perguntas, a pontuação e os perfis de resultado.
          </p>
        </div>
        <Link
          href={`/apps/${campaignId}/preview`}
          className="shrink-0 rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-caetano-medium-gray-20"
        >
          Pré-visualizar
        </Link>
      </div>

      <AutoSaveForm
        action={updateQuizConfigAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            id="questionsPerParticipation"
            name="questionsPerParticipation"
            label="Perguntas por participação"
            min={1}
            max={QUIZ_CONFIG_LIMITS.questionsPerParticipationMax}
            defaultValue={quizConfig.questionsPerParticipation}
            help="Vazio = todas."
          />
          <NumberField
            id="totalTimeLimitSeconds"
            name="totalTimeLimitSeconds"
            label="Tempo total (s)"
            min={1}
            max={QUIZ_CONFIG_LIMITS.timeLimitMaxSeconds}
            defaultValue={quizConfig.totalTimeLimitSeconds}
            help="Vazio = sem limite."
          />
          <NumberField
            id="perQuestionTimeLimitSeconds"
            name="perQuestionTimeLimitSeconds"
            label="Tempo por pergunta (s)"
            min={1}
            max={QUIZ_CONFIG_LIMITS.timeLimitMaxSeconds}
            defaultValue={quizConfig.perQuestionTimeLimitSeconds}
            help="Vazio = sem limite. Não pode passar o tempo total."
          />
          <NumberField
            id="penaltyPerWrong"
            name="penaltyPerWrong"
            label="Penalização por erro"
            min={0}
            max={QUIZ_CONFIG_LIMITS.penaltyPerWrongMax}
            defaultValue={quizConfig.penaltyPerWrong}
            help="Pontos retirados por resposta errada."
            required
          />
          <NumberField
            id="minPassPercentage"
            name="minPassPercentage"
            label="Aprovação mínima (%)"
            min={0}
            max={100}
            defaultValue={quizConfig.minPassPercentage}
            help="Vazio = sem aprovado ou não aprovado."
          />
          <NumberField
            id="maxAttempts"
            name="maxAttempts"
            label="Máx. tentativas"
            min={QUIZ_CONFIG_LIMITS.maxAttemptsMin}
            max={QUIZ_CONFIG_LIMITS.maxAttemptsMax}
            defaultValue={quizConfig.maxAttempts}
            help="Vazio = ilimitadas."
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
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
            <CheckboxField key={name} name={name} defaultChecked={checked}>
              {label}
            </CheckboxField>
          ))}
        </div>
      </AutoSaveForm>

      <section className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-caetano-anthracite">
          Perguntas ({quizConfig.questions.length})
        </h3>

        {quizConfig.questions.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-anthracite-80">
            Ainda não há perguntas. Adicione a primeira abaixo.
          </p>
        )}

        <ul className="space-y-3">
          {quizConfig.questions.map((question, index) => {
            // Há um formulário de edição por pergunta: os ids levam o id dela.
            const fieldId = (name: string) => `question-${question.id}-${name}`;
            const image = question.imageMediaId ? mediaById.get(question.imageMediaId) : undefined;
            const severalCorrect = allowsSeveralCorrectAnswers(question.type);
            const hasCorrect = question.answers.some((answer) => answer.isCorrect);

            return (
              <li key={question.id} className="rounded-lg border border-caetano-medium-gray-20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="break-words font-medium text-caetano-anthracite">{question.title}</span>
                    <span className="ml-2 text-xs text-caetano-anthracite-80">
                      {QUESTION_TYPE_LABELS[question.type]} · {question.points} pts
                    </span>
                    {question.answers.length === 0 ? (
                      <p className="mt-0.5 text-xs text-caetano-anthracite-80">Ainda sem respostas.</p>
                    ) : (
                      !hasCorrect && (
                        <p className="mt-0.5 text-xs text-danger-strong">Falta indicar a resposta correta.</p>
                      )
                    )}
                  </div>
                  <div className="flex items-start gap-1">
                    {/* Um só formulário: o botão premido leva a direção no envio. */}
                    <ActionForm action={moveQuestionAction} resetOnSuccess={false} className="flex items-center gap-1">
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="questionId" value={question.id} />
                      <button
                        type="submit"
                        name="direction"
                        value="up"
                        disabled={index === 0}
                        className={ICON_BUTTON_CLASS}
                        aria-label={`Mover «${question.title}» para cima`}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="submit"
                        name="direction"
                        value="down"
                        disabled={index === quizConfig.questions.length - 1}
                        className={ICON_BUTTON_CLASS}
                        aria-label={`Mover «${question.title}» para baixo`}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                    </ActionForm>
                    <ActionForm action={removeQuestionAction} resetOnSuccess={false}>
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="questionId" value={question.id} />
                      <ConfirmSubmitButton confirmMessage="Remover esta pergunta e as respostas?" size="sm">
                        Remover
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer list-none select-none rounded text-xs text-caetano-deep-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan">
                    Editar pergunta e respostas
                  </summary>

                  <ActionForm action={updateQuestionAction} resetOnSuccess={false} className="mt-2 space-y-3">
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <div>
                      <Label htmlFor={fieldId("title")}>Título</Label>
                      <Input
                        id={fieldId("title")}
                        name="title"
                        maxLength={QUIZ_QUESTION_LIMITS.title}
                        defaultValue={question.title}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={fieldId("supportText")}>Texto de apoio (opcional)</Label>
                      <Input
                        id={fieldId("supportText")}
                        name="supportText"
                        maxLength={QUIZ_QUESTION_LIMITS.supportText}
                        defaultValue={question.supportText ?? ""}
                      />
                    </div>
                    <MediaUploadField
                      name="imageMediaId"
                      label="Imagem da pergunta (opcional)"
                      defaultMediaId={question.imageMediaId}
                      defaultUrl={image?.url}
                      defaultKind={image?.kind}
                      accept={IMAGE_ACCEPT}
                      helpText="A imagem fica associada quando guardar a pergunta."
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NumberField
                        id={fieldId("points")}
                        name="points"
                        label="Pontos"
                        min={0}
                        max={QUIZ_QUESTION_LIMITS.pointsMax}
                        defaultValue={question.points}
                        required
                      />
                      <NumberField
                        id={fieldId("timeLimitSeconds")}
                        name="timeLimitSeconds"
                        label="Tempo limite (s)"
                        min={1}
                        max={QUIZ_QUESTION_LIMITS.timeLimitMaxSeconds}
                        defaultValue={question.timeLimitSeconds}
                        help="Vazio = sem limite."
                      />
                    </div>
                    <div>
                      <Label htmlFor={fieldId("explanation")}>Explicação (opcional)</Label>
                      <textarea
                        id={fieldId("explanation")}
                        name="explanation"
                        maxLength={QUIZ_QUESTION_LIMITS.explanation}
                        defaultValue={question.explanation ?? ""}
                        rows={2}
                        className={TEXTAREA_CLASS}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <CheckboxField name="required" defaultChecked={question.required}>
                        Obrigatória
                      </CheckboxField>
                      <CheckboxField name="immediateFeedback" defaultChecked={question.immediateFeedback}>
                        Feedback imediato
                      </CheckboxField>
                    </div>
                    <SubmitButton size="sm" variant="outline">
                      Guardar pergunta
                    </SubmitButton>
                  </ActionForm>

                  <div className="mt-4">
                    <p className="text-xs font-medium text-caetano-anthracite">Respostas</p>
                    <p className="mb-1 text-xs text-caetano-anthracite-80">
                      {severalCorrect
                        ? "Marque no círculo todas as respostas corretas."
                        : "Marque no círculo a resposta correta."}
                    </p>
                    <ul className="space-y-1">
                      {question.answers.map((answer, answerIndex) => {
                        const answerImage = answer.imageMediaId ? mediaById.get(answer.imageMediaId) : undefined;
                        const answerName = answer.text ?? `Resposta ${answerIndex + 1} (imagem)`;
                        const toggleLabel = answer.isCorrect
                          ? severalCorrect
                            ? `«${answerName}» é uma resposta correta`
                            : `«${answerName}» é a resposta correta`
                          : `Marcar «${answerName}» como correta`;

                        return (
                          <li key={answer.id} className="flex items-start justify-between gap-2 text-sm">
                            <ActionForm
                              action={toggleAnswerCorrectAction}
                              resetOnSuccess={false}
                              className="flex min-w-0 flex-wrap items-center gap-2"
                            >
                              <input type="hidden" name="campaignId" value={campaignId} />
                              <input type="hidden" name="questionId" value={question.id} />
                              <input type="hidden" name="answerId" value={answer.id} />
                              <button
                                type="submit"
                                aria-pressed={answer.isCorrect}
                                aria-label={toggleLabel}
                                // A área de toque passa a 24x24 (WCAG 2.2 2.5.8);
                                // o círculo visível continua com 20px, centrado.
                                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
                              >
                                <span
                                  aria-hidden="true"
                                  className={`block h-5 w-5 rounded-full border transition-colors ${
                                    answer.isCorrect
                                      ? "border-caetano-eco-green bg-caetano-eco-green"
                                      : "border-caetano-medium-gray"
                                  }`}
                                />
                              </button>
                              {answerImage && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={answerImage.url}
                                  // Com texto ao lado, a imagem é decorativa aqui.
                                  alt={answer.text ? "" : (answerImage.altText ?? answerName)}
                                  className="h-10 w-10 rounded border border-caetano-medium-gray-40 object-cover"
                                />
                              )}
                              {answer.text && <span className="min-w-0 break-words">{answer.text}</span>}
                            </ActionForm>
                            {question.type !== "TRUE_FALSE" && (
                              <ActionForm action={removeAnswerAction} resetOnSuccess={false}>
                                <input type="hidden" name="campaignId" value={campaignId} />
                                <input type="hidden" name="questionId" value={question.id} />
                                <input type="hidden" name="answerId" value={answer.id} />
                                <button
                                  type="submit"
                                  aria-label={`Remover «${answerName}»`}
                                  className="min-h-6 cursor-pointer rounded px-1 text-xs text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
                                >
                                  Remover
                                </button>
                              </ActionForm>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {question.type !== "TRUE_FALSE" && (
                      <ActionForm action={addAnswerAction} className="mt-3 space-y-2">
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="questionId" value={question.id} />
                        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                          <div className="min-w-0 flex-1 basis-48">
                            <Label htmlFor={fieldId("new-answer")}>Nova resposta</Label>
                            <Input
                              id={fieldId("new-answer")}
                              name="text"
                              maxLength={QUIZ_ANSWER_LIMITS.text}
                              // Com imagem, o texto é opcional (basta um dos dois).
                              required={question.type !== "IMAGE_CHOICE"}
                            />
                          </div>
                          <CheckboxField name="isCorrect" labelClassName="flex h-10 items-center gap-2 text-sm text-caetano-anthracite">
                            Correta
                          </CheckboxField>
                          <SubmitButton size="md" variant="outline">
                            Adicionar resposta
                          </SubmitButton>
                        </div>
                        {question.type === "IMAGE_CHOICE" && (
                          <MediaUploadField
                            name="imageMediaId"
                            label="Imagem da resposta"
                            accept={IMAGE_ACCEPT}
                            helpText="Indique um texto, uma imagem ou os dois."
                          />
                        )}
                      </ActionForm>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>

        <ActionForm action={addQuestionAction} className="mt-4 space-y-2">
          <input type="hidden" name="campaignId" value={campaignId} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-auto">
              <Label htmlFor="type">Tipo</Label>
              <select id="type" name="type" className={SELECT_CLASS}>
                {(Object.entries(QUESTION_TYPE_LABELS) as [QuestionType, string][]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1 basis-56">
              <Label htmlFor="title">Título</Label>
              <Input id="title" name="title" maxLength={QUIZ_QUESTION_LIMITS.title} required />
            </div>
            <SubmitButton variant="outline">Adicionar pergunta</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-caetano-anthracite">
          Perfis de resultado ({quizConfig.resultProfiles.length})
        </h3>

        {quizConfig.resultProfiles.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-anthracite-80">
            Ainda não há perfis de resultado (opcional).
          </p>
        )}

        <ul className="space-y-2">
          {quizConfig.resultProfiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-caetano-medium-gray-20 p-3"
            >
              <div className="min-w-0">
                <span className="break-words font-medium text-caetano-anthracite">{profile.title}</span>
                <span className="ml-2 text-xs text-caetano-anthracite-80">
                  {profile.minPercentage}%–{profile.maxPercentage}%
                </span>
              </div>
              <ActionForm action={removeResultProfileAction} resetOnSuccess={false}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="profileId" value={profile.id} />
                <ConfirmSubmitButton confirmMessage={`Remover o perfil "${profile.title}"?`} size="sm">
                  Remover
                </ConfirmSubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>

        <details className="mt-4">
          <summary className="cursor-pointer list-none select-none rounded text-sm text-caetano-deep-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan">
            Adicionar perfil de resultado
          </summary>
          <ActionForm action={addResultProfileAction} className="mt-2 max-w-md space-y-3">
            <input type="hidden" name="campaignId" value={campaignId} />
            <div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="profile-minPercentage">Percentagem mínima</Label>
                  <Input
                    id="profile-minPercentage"
                    name="minPercentage"
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={0}
                    max={100}
                    required
                    aria-describedby="profile-range-help"
                  />
                </div>
                <div>
                  <Label htmlFor="profile-maxPercentage">Percentagem máxima</Label>
                  <Input
                    id="profile-maxPercentage"
                    name="maxPercentage"
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={0}
                    max={100}
                    required
                    aria-describedby="profile-range-help"
                  />
                </div>
              </div>
              <p id="profile-range-help" className={HELP_CLASS}>
                Os dois extremos contam. O intervalo não pode sobrepor-se ao de outro perfil.
              </p>
            </div>
            <div>
              <Label htmlFor="profile-title">Título</Label>
              <Input id="profile-title" name="title" maxLength={RESULT_PROFILE_LIMITS.title} required />
            </div>
            <div>
              <Label htmlFor="profile-description">Descrição (opcional)</Label>
              <textarea
                id="profile-description"
                name="description"
                maxLength={RESULT_PROFILE_LIMITS.description}
                rows={2}
                className={TEXTAREA_CLASS}
              />
            </div>
            <MediaUploadField name="imageMediaId" label="Imagem (opcional)" accept={IMAGE_ACCEPT} />
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="profile-ctaLabel">Texto do botão (opcional)</Label>
                <Input id="profile-ctaLabel" name="ctaLabel" maxLength={RESULT_PROFILE_LIMITS.ctaLabel} />
              </div>
              <div>
                <Label htmlFor="profile-ctaUrl">Link do botão (opcional)</Label>
                <Input
                  id="profile-ctaUrl"
                  name="ctaUrl"
                  type="url"
                  inputMode="url"
                  maxLength={RESULT_PROFILE_LIMITS.ctaUrl}
                  placeholder="https://"
                />
              </div>
            </div>
            <SubmitButton variant="outline" size="sm">
              Adicionar perfil
            </SubmitButton>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
