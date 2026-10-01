import type { ReactNode } from "react";
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
import { buttonVariants } from "@/components/ui/button";
import {
  ADD_PANEL_CLASS,
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_LABEL_CLASS,
  CHECKBOX_TILE_CLASS,
  FieldGroup,
  HELP_CLASS,
  ICON_BUTTON_CLASS,
  LIST_ITEM_CLASS,
  ListEmpty,
  SectionHeading,
  SELECT_CLASS,
  SelectShell,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  SUMMARY_CLASS,
  SummaryChevron,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Check, CircleHelp, Plus, TriangleAlert, Trophy } from "lucide-react";

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Escolha única",
  MULTIPLE_CHOICE: "Escolha múltipla",
  TRUE_FALSE: "Verdadeiro ou falso",
  IMAGE_CHOICE: "Respostas com imagem",
};

// O jogo mostra estas imagens com `<img>`: sem vídeo.
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/svg+xml";

/** "Remover" numa linha: discreto até ao rato, sempre no vermelho funcional de destruição. */
const REMOVE_BUTTON_CLASS = "text-danger hover:bg-danger-surface hover:text-danger-strong active:bg-danger-surface";

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

/** `notice`: um aviso da página, por baixo do título da etapa. */
export async function QuizGameStep({ campaignId, notice }: { campaignId: string; notice?: ReactNode }) {
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
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Configuração do Quiz Interativo"
        description="Defina as perguntas, a pontuação e os perfis de resultado."
      />

      {notice}

      <AutoSaveForm action={updateQuizConfigAction} className={cn(STEP_CARD_CLASS, "space-y-6")}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <FieldGroup title="Tempo e pontuação">
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
        </FieldGroup>
        <FieldGroup title="Comportamento">
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
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
              <CheckboxField
                key={name}
                name={name}
                defaultChecked={checked}
                className={CHECKBOX_INPUT_CLASS}
                labelClassName={CHECKBOX_TILE_CLASS}
              >
                {label}
              </CheckboxField>
            ))}
          </div>
        </FieldGroup>
      </AutoSaveForm>

      <section aria-labelledby="quiz-questions-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
        <SectionHeading id="quiz-questions-heading" title={`Perguntas (${quizConfig.questions.length})`} />

        {quizConfig.questions.length === 0 ? (
          <ListEmpty icon={<CircleHelp size={20} />}>Ainda não há perguntas. Adicione a primeira abaixo.</ListEmpty>
        ) : (
          <ul className="space-y-3">
            {quizConfig.questions.map((question, index) => {
              // Há um formulário de edição por pergunta: os ids levam o id dela.
              const fieldId = (name: string) => `question-${question.id}-${name}`;
              const image = question.imageMediaId ? mediaById.get(question.imageMediaId) : undefined;
              const severalCorrect = allowsSeveralCorrectAnswers(question.type);
              const hasCorrect = question.answers.some((answer) => answer.isCorrect);

              return (
                <li key={question.id} className={LIST_ITEM_CLASS}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-caetano-deep-blue text-xs font-bold text-white"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 pt-1">
                        <span className="break-words font-medium text-caetano-anthracite">{question.title}</span>
                        <span className="ml-2 inline-flex rounded-full bg-caetano-medium-gray-20 px-2 py-0.5 text-xs text-caetano-anthracite-80">
                          {QUESTION_TYPE_LABELS[question.type]} · {question.points} pts
                        </span>
                        {question.answers.length === 0 ? (
                          <p className="mt-1 text-xs text-caetano-anthracite-80">Ainda sem respostas.</p>
                        ) : (
                          !hasCorrect && (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs text-danger-strong">
                              <TriangleAlert size={12} aria-hidden="true" />
                              Falta indicar a resposta correta.
                            </p>
                          )
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex items-start gap-1">
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
                          <ArrowUp size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="submit"
                          name="direction"
                          value="down"
                          disabled={index === quizConfig.questions.length - 1}
                          className={ICON_BUTTON_CLASS}
                          aria-label={`Mover «${question.title}» para baixo`}
                        >
                          <ArrowDown size={16} aria-hidden="true" />
                        </button>
                      </ActionForm>
                      <ActionForm action={removeQuestionAction} resetOnSuccess={false}>
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="questionId" value={question.id} />
                        <ConfirmSubmitButton
                          confirmMessage="Remover esta pergunta e as respostas?"
                          variant="ghost"
                          size="md"
                          className={REMOVE_BUTTON_CLASS}
                        >
                          Remover
                        </ConfirmSubmitButton>
                      </ActionForm>
                    </div>
                  </div>

                  <details className="group mt-2 border-t border-caetano-medium-gray-20 pt-1">
                    <summary className={SUMMARY_CLASS}>
                      <SummaryChevron />
                      Editar pergunta e respostas
                    </summary>

                    <div className="mt-2 space-y-4">
                      <ActionForm
                        action={updateQuestionAction}
                        resetOnSuccess={false}
                        className={cn(ADD_PANEL_CLASS, "space-y-4")}
                      >
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
                        <div className="grid gap-4 sm:grid-cols-2">
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
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                          <CheckboxField
                            name="required"
                            defaultChecked={question.required}
                            className={CHECKBOX_INPUT_CLASS}
                            labelClassName={CHECKBOX_LABEL_CLASS}
                          >
                            Obrigatória
                          </CheckboxField>
                          <CheckboxField
                            name="immediateFeedback"
                            defaultChecked={question.immediateFeedback}
                            className={CHECKBOX_INPUT_CLASS}
                            labelClassName={CHECKBOX_LABEL_CLASS}
                          >
                            Feedback imediato
                          </CheckboxField>
                        </div>
                        <SubmitButton variant="outline">Guardar pergunta</SubmitButton>
                      </ActionForm>

                      <div className="rounded-xl border border-caetano-medium-gray-40 p-3 sm:p-4">
                        <p className="text-sm font-bold text-caetano-deep-blue">Respostas</p>
                        <p className="mb-2 text-xs text-caetano-anthracite-80">
                          {severalCorrect
                            ? "Marque no círculo todas as respostas corretas."
                            : "Marque no círculo a resposta correta."}
                        </p>
                        <ul className="divide-y divide-caetano-medium-gray-20">
                          {question.answers.map((answer, answerIndex) => {
                            const answerImage = answer.imageMediaId ? mediaById.get(answer.imageMediaId) : undefined;
                            const answerName = answer.text ?? `Resposta ${answerIndex + 1} (imagem)`;
                            const toggleLabel = answer.isCorrect
                              ? severalCorrect
                                ? `«${answerName}» é uma resposta correta`
                                : `«${answerName}» é a resposta correta`
                              : `Marcar «${answerName}» como correta`;

                            return (
                              <li key={answer.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
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
                                    // A área de toque é de 40x40 (WCAG 2.2 2.5.8);
                                    // o círculo visível tem 22px, centrado.
                                    className="group/answer flex h-10 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className={cn(
                                        "flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-200",
                                        answer.isCorrect
                                          ? "border-caetano-eco-green bg-caetano-eco-green text-caetano-deep-blue"
                                          : "border-caetano-anthracite-60 bg-white group-hover/answer:border-caetano-deep-blue-60",
                                      )}
                                    >
                                      {answer.isCorrect && <Check size={13} strokeWidth={3} />}
                                    </span>
                                  </button>
                                  {answerImage && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={answerImage.url}
                                      // Com texto ao lado, a imagem é decorativa aqui.
                                      alt={answer.text ? "" : (answerImage.altText ?? answerName)}
                                      className="h-10 w-10 rounded-lg border border-caetano-medium-gray-40 object-cover"
                                    />
                                  )}
                                  {answer.text && (
                                    <span className="min-w-0 break-words text-caetano-anthracite">{answer.text}</span>
                                  )}
                                </ActionForm>
                                {question.type !== "TRUE_FALSE" && (
                                  <ActionForm action={removeAnswerAction} resetOnSuccess={false}>
                                    <input type="hidden" name="campaignId" value={campaignId} />
                                    <input type="hidden" name="questionId" value={question.id} />
                                    <input type="hidden" name="answerId" value={answer.id} />
                                    <button
                                      type="submit"
                                      aria-label={`Remover «${answerName}»`}
                                      className={buttonVariants({ variant: "ghost", size: "sm", className: REMOVE_BUTTON_CLASS })}
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
                          <ActionForm action={addAnswerAction} className={cn(ADD_PANEL_CLASS, "mt-3 space-y-3")}>
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
                              <CheckboxField
                                name="isCorrect"
                                className={CHECKBOX_INPUT_CLASS}
                                labelClassName={CHECKBOX_LABEL_CLASS}
                              >
                                Correta
                              </CheckboxField>
                              <SubmitButton size="md" variant="outline">
                                <Plus size={16} aria-hidden="true" />
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
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <ActionForm action={addQuestionAction} className={cn(ADD_PANEL_CLASS, "space-y-2")}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-auto sm:min-w-52">
              <Label htmlFor="type">Tipo</Label>
              <SelectShell>
                <select id="type" name="type" className={SELECT_CLASS}>
                  {(Object.entries(QUESTION_TYPE_LABELS) as [QuestionType, string][]).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </div>
            <div className="min-w-0 flex-1 basis-56">
              <Label htmlFor="title">Título</Label>
              <Input id="title" name="title" maxLength={QUIZ_QUESTION_LIMITS.title} required />
            </div>
            <SubmitButton variant="outline">
              <Plus size={16} aria-hidden="true" />
              Adicionar pergunta
            </SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="quiz-profiles-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
        <SectionHeading
          id="quiz-profiles-heading"
          title={`Perfis de resultado (${quizConfig.resultProfiles.length})`}
        />

        {quizConfig.resultProfiles.length === 0 ? (
          <ListEmpty icon={<Trophy size={20} />}>Ainda não há perfis de resultado (opcional).</ListEmpty>
        ) : (
          <ul className="space-y-2">
            {quizConfig.resultProfiles.map((profile) => (
              <li key={profile.id} className={cn(LIST_ITEM_CLASS, "flex flex-wrap items-center justify-between gap-2")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-caetano-cyan-20 text-caetano-deep-blue"
                  >
                    <Trophy size={16} />
                  </span>
                  <div className="min-w-0">
                    <span className="break-words font-medium text-caetano-anthracite">{profile.title}</span>
                    <span className="ml-2 inline-flex rounded-full bg-caetano-medium-gray-20 px-2 py-0.5 text-xs tabular-nums text-caetano-anthracite-80">
                      {profile.minPercentage}%–{profile.maxPercentage}%
                    </span>
                  </div>
                </div>
                <ActionForm action={removeResultProfileAction} resetOnSuccess={false}>
                  <input type="hidden" name="campaignId" value={campaignId} />
                  <input type="hidden" name="profileId" value={profile.id} />
                  <ConfirmSubmitButton
                    confirmMessage={`Remover o perfil "${profile.title}"?`}
                    variant="ghost"
                    size="md"
                    className={REMOVE_BUTTON_CLASS}
                  >
                    Remover
                  </ConfirmSubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <details className="group rounded-xl border border-dashed border-caetano-medium-gray-60 bg-white transition-colors duration-200 open:border-solid open:border-caetano-medium-gray-40 open:bg-caetano-medium-gray-20 hover:border-caetano-deep-blue-40">
          <summary className={cn(SUMMARY_CLASS, "flex w-full justify-center px-4 py-2 group-open:justify-start")}>
            <Plus size={16} aria-hidden="true" className="shrink-0" />
            Adicionar perfil de resultado
          </summary>
          <ActionForm action={addResultProfileAction} className="max-w-md space-y-4 px-3 pb-4 sm:px-4">
            <input type="hidden" name="campaignId" value={campaignId} />
            <div>
              <div className="grid grid-cols-2 gap-3">
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
            <div className="grid gap-3 sm:grid-cols-2">
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
            <SubmitButton variant="outline">
              <Plus size={16} aria-hidden="true" />
              Adicionar perfil
            </SubmitButton>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
