import type { CSSProperties } from "react";

type IconProps = {
  name: string;
  size?: number;
  filled?: boolean;
  weight?: number;
  className?: string;
  style?: CSSProperties;
};

export default function Icon({
  name,
  size = 22,
  filled = false,
  weight = 450,
  className = "",
  style,
}: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded shrink-0 select-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" ${weight}, "GRAD" 0, "opsz" ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
