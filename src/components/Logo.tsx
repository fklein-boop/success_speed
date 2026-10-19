/**
 * Logotype provisoire (texte). À remplacer par les fichiers vectoriels officiels fournis
 * par le marketing — la charte interdit de redessiner le logo.
 */
export function Logo({ inverse = false, className = "" }: { inverse?: boolean; className?: string }) {
  return (
    <span className={`font-titres text-xl font-bold tracking-tight ${inverse ? "text-white" : "text-minuit"} ${className}`} aria-label="SpeedResa">
      speed<span className={inverse ? "text-lagon" : "text-horizon"}>resa</span>
    </span>
  );
}
