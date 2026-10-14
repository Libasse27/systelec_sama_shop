/** État renvoyé par les actions serveur de l'administration aux formulaires. */
export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: string;
  /** Change à chaque succès : permet de vider un formulaire d'ajout. */
  doneAt?: number;
}

export const initialActionState: ActionState = {};
