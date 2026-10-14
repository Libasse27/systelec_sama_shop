"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { initialActionState, type ActionState } from "@/app/admin/_lib/form-state";
import { cn } from "@/lib/utils";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const noSubscription = () => () => {};

/**
 * Vrai une fois la page hydratée. Avant, un envoi partirait en GET natif (valeurs dans l'URL)
 * au lieu de l'action serveur : les boutons restent désactivés jusque-là.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

const FormStateContext = createContext<{ state: ActionState; pending: boolean }>({ state: initialActionState, pending: false });

/** Erreurs du champ et de ses sous-champs (« specs » couvre « specs.0.label »). */
function useFieldErrors(name: string): string[] | undefined {
  const { fieldErrors } = useContext(FormStateContext).state;
  if (!fieldErrors) return undefined;
  const errors = Object.entries(fieldErrors)
    .filter(([key]) => key === name || key.startsWith(`${name}.`))
    .flatMap(([, messages]) => messages ?? []);
  return errors.length > 0 ? errors : undefined;
}

interface ActionFormProps {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  /** Vide le formulaire après un succès (formulaires d'ajout). */
  resetOnSuccess?: boolean;
  /** Message de confirmation avant envoi (actions destructrices). */
  confirm?: string;
}

/**
 * Formulaire relié à une action serveur. La soumission est faite à la main pour que les
 * saisies restent en place quand le serveur signale une erreur (pas de remise à zéro auto).
 */
export function ActionForm({ action, children, className, resetOnSuccess = false, confirm }: ActionFormProps) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.doneAt) formRef.current?.reset();
  }, [resetOnSuccess, state.doneAt]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const question = submitter?.dataset.confirm ?? confirm;
    if (question && !window.confirm(question)) return;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className={cn("flex flex-col gap-4", className)} aria-busy={pending}>
      <FormStateContext value={{ state, pending }}>
        <FormMessages state={state} />
        {children}
      </FormStateContext>
    </form>
  );
}

export function FormMessages({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        {state.success}
      </p>
    );
  }
  return null;
}

interface FieldShellProps {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}

function FieldShell({ name, label, required, hint, children, className }: FieldShellProps) {
  const errors = useFieldErrors(name);
  const id = `champ-${name.replace(/\W/g, "-")}`;
  const describedBy = [hint && `${id}-aide`, errors && `${id}-erreur`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {!required && <span className="font-normal text-ink-muted"> (facultatif)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(errors) })}
      {hint && (
        <p id={`${id}-aide`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {errors && (
        <p id={`${id}-erreur`} className="text-sm text-red-700">
          {errors[0]}
        </p>
      )}
    </div>
  );
}

const inputClass = (invalid: boolean) =>
  cn("rounded-lg border border-line bg-surface px-3 py-2 text-base", invalid && "border-red-600");

interface TextFieldProps {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  hint?: string;
  type?: "text" | "number" | "search";
  inputMode?: "numeric" | "text";
  className?: string;
}

export function TextField({ name, label, defaultValue, required = true, hint, type = "text", inputMode, className }: TextFieldProps) {
  return (
    <FieldShell name={name} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name={name}
          type={type}
          inputMode={inputMode}
          defaultValue={defaultValue ?? ""}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputClass(invalid)}
        />
      )}
    </FieldShell>
  );
}

/** Montant ou quantité entière (clavier numérique sur mobile). */
export function IntegerField(props: Omit<TextFieldProps, "type" | "inputMode">) {
  return <TextField {...props} inputMode="numeric" />;
}

export function TextAreaField({
  name,
  label,
  defaultValue,
  required = true,
  hint,
  rows = 4,
  className,
}: Omit<TextFieldProps, "type" | "inputMode"> & { rows?: number }) {
  return (
    <FieldShell name={name} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          name={name}
          rows={rows}
          defaultValue={defaultValue ?? ""}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputClass(invalid)}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  required = true,
  hint,
  className,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  required?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <FieldShell name={name} label={label} required={required} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputClass(invalid)}
        >
          {!required && <option value="">—</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function CheckboxField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  const id = `champ-${name.replace(/\W/g, "-")}`;
  return (
    <div className="flex items-center gap-2">
      <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} className="size-4" />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

export function FileField({ name, label, accept, hint }: { name: string; label: string; accept: string; hint?: string }) {
  return (
    <FieldShell name={name} label={label} required hint={hint}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name={name}
          type="file"
          accept={accept}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-2"
        />
      )}
    </FieldShell>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-brand-blue text-white hover:bg-brand-blue-dark",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-muted",
  danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50",
} as const;

export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
  confirm,
}: {
  children: React.ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  name?: string;
  value?: string;
  /** Confirmation demandée avant d'envoyer avec ce bouton. */
  confirm?: string;
}) {
  const { pending } = useContext(FormStateContext);
  const hydrated = useHydrated();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      data-confirm={confirm}
      disabled={pending || !hydrated}
      className={cn("rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60", BUTTON_VARIANTS[variant])}
    >
      {children}
    </button>
  );
}
