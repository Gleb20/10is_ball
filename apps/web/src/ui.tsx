import {
  Button as IcButton,
  Input,
  type ButtonProps as IcButtonProps,
} from "ic-kit";

export const TextField = Input;

type LegacyVariant = "primary" | "secondary";

export type ButtonProps = Omit<IcButtonProps, "variant"> & {
  variant?: LegacyVariant | IcButtonProps["variant"];
};

export function Button({ variant = "contained", ...props }: ButtonProps) {
  const mapped =
    variant === "primary"
      ? "contained"
      : variant === "secondary"
        ? "outlined"
        : variant;
  return <IcButton variant={mapped} {...props} />;
}
