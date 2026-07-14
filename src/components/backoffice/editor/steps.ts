export interface EditorStep {
  slug: string;
  label: string;
}

export const EDITOR_STEPS: EditorStep[] = [
  { slug: "informacoes", label: "Informações do projeto" },
  { slug: "ecra-inicial", label: "Ecrã inicial" },
  { slug: "marca", label: "Marca e design" },
  { slug: "formulario", label: "Formulário de leads" },
  { slug: "ecra-intermedio", label: "Ecrã intermédio" },
  { slug: "jogo", label: "Configuração do jogo" },
  { slug: "ecra-final", label: "Resultado e ecrã final" },
  { slug: "regras", label: "Regras de participação" },
  { slug: "agenda", label: "Agenda" },
  { slug: "publicar", label: "Publicação" },
];
