import { Logo } from "@/components/brand/logo";

/** Centred card on a dark teal background with the Prospector logo (SRS screen 1). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand-900 px-4 py-8">
      <Logo light />
      <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-float">{children}</div>
      <p className="text-helper text-[#9fb5b2]">Internal system for Classwell, Vetlin and Postwala</p>
    </main>
  );
}
