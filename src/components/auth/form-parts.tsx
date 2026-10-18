"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

interface FieldProps {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  errors?: string[];
  defaultValue?: string;
}

/** Champ de formulaire accessible : libellé, aide et erreurs reliés à l'input. */
export function Field({ name, label, type = "text", autoComplete, required = true, hint, errors, defaultValue }: FieldProps) {
  const describedBy = [hint && `${name}-hint`, errors?.length && `${name}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {!required && <span className="font-normal text-ink-muted"> (facultatif)</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "rounded-lg border border-line bg-surface px-3 py-2.5 text-base",
          errors?.length && "border-red-600",
        )}
      />
      {hint && (
        <p id={`${name}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {errors?.length ? (
        <p id={`${name}-error`} className="text-sm text-red-700">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand-blue px-4 py-2.5 font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-60"
    >
      {pending ? "Veuillez patienter…" : children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}
