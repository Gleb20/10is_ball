import {
  Alert,
  Autocomplete,
  Avatar,
  Button as IcButton,
  ButtonGroup,
  Chip,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Skeleton,
  Text,
  type ButtonGroupOption,
  type ButtonProps as IcButtonProps,
} from "ic-kit";

export {
  Alert,
  Autocomplete,
  Avatar,
  ButtonGroup,
  Chip,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Skeleton,
  Text,
};
export type { ButtonGroupOption };

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
