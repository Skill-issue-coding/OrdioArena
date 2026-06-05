import type { MotionProps } from "framer-motion";

export type PopInMotion = Pick<MotionProps, "initial" | "animate" | "transition">;

export type PopInOptions = {
  delay?: number;
  strength?: number;
  y?: number;
  duration?: number;
  ease?: NonNullable<MotionProps["transition"]>["ease"];
};

export type SnapInOptions = PopInOptions & {
  x?: number;
  rotate?: number;
};

const resolvePopInOptions = (delayOrOptions?: number | PopInOptions, strength?: number): Required<PopInOptions> => {
  if (typeof delayOrOptions === "number") {
    return {
      delay: delayOrOptions,
      strength: strength ?? 1,
      y: 14,
      duration: 0.55,
      ease: "easeOut",
    };
  }

  return {
    delay: delayOrOptions?.delay ?? 0,
    strength: delayOrOptions?.strength ?? 1,
    y: delayOrOptions?.y ?? 14,
    duration: delayOrOptions?.duration ?? 0.55,
    ease: delayOrOptions?.ease ?? "easeOut",
  };
};

export const popIn = (delayOrOptions?: number | PopInOptions, strength?: number): PopInMotion => {
  const { delay, strength: resolvedStrength, y, duration, ease } = resolvePopInOptions(delayOrOptions, strength);

  return {
    initial: { opacity: 0, scale: 0.85, y },
    animate: { opacity: 1, scale: [0.85, resolvedStrength * 1.08, 1], y: [y, -4, 0] },
    transition: { delay, duration, ease },
  };
};

export const snapIn = (options: SnapInOptions = {}): PopInMotion => {
  const { delay, strength, y, duration, ease } = resolvePopInOptions(options);
  const x = options.x ?? 0;
  const rotate = options.rotate ?? -2;

  return {
    initial: { opacity: 0, scale: 0.9, y, x, rotate },
    animate: {
      opacity: 1,
      scale: [0.9, strength * 1.04, 1],
      y: [y, -2, 0],
      x: [x, 0, 0],
      rotate: [rotate, rotate * -0.3, 0],
    },
    transition: { delay, duration: duration * 0.75, ease },
  };
};

export type GameResultCardOptions = {
  delay?: number;
  isWinner?: boolean;
  index?: number;
};

export const gameResultCardPopIn = ({ delay = 0, isWinner = false, index = 0 }: GameResultCardOptions): PopInMotion => {
  const yBounce = isWinner ? [0, -8, 0] : [0, -4, 0];

  const floatDuration = isWinner ? 2.5 : 3 + (index % 3) * 0.2;

  return {
    initial: { opacity: 0, scale: 0.4 },
    animate: {
      opacity: 1,
      scale: 1,
      y: yBounce,
    },
    transition: {
      // 1. Entrance Transitions
      opacity: { delay, duration: 0.3, ease: "easeOut" },
      scale: {
        delay,
        type: "spring",
        stiffness: isWinner ? 350 : 250, // Winner pops in sharper
        damping: isWinner ? 12 : 16,
      },
      // 2. Continuous Idle Transition
      y: {
        delay: delay + 0.4, // Wait for the entrance pop to mostly finish
        duration: floatDuration,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };
};
