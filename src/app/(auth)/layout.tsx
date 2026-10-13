/** Mise en page commune des écrans d'authentification (mobile d'abord). */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main className="mx-auto w-full max-w-md px-4 py-10">{children}</main>;
}
