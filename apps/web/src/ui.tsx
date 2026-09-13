import { useCallback, useId, useLayoutEffect, useRef, type KeyboardEvent, type ComponentProps } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Button as IcButton,
  ButtonGroup,
  Chip,
  Dialog as IcDialog,
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

// Opacity-zero radio inputs remain keyboard controls; display:none ancestors do not.
function isRendered(element: HTMLElement) {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const visibility = getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

function dialogControls(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]',
  )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && isRendered(element));
}

// Keep ic-kit presentation/portal, but use current callbacks and focusable nodes.
export function Dialog({ onClose, onKeyDownCapture, className, ...props }: ComponentProps<typeof IcDialog>) {
  const panelId = useId();
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  const close = useCallback(() => closeRef.current?.(), []);

  useLayoutEffect(() => {
    if (!props.open) return;
    const panel = document.querySelector<HTMLElement>(`[data-app-dialog-id="${panelId}"]`);
    if (!panel) return;
    // Native disable/remove can move focus to body, outside the panel's key handler.
    const observer = new MutationObserver(() => {
      if (!isRendered(panel)) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel) return;
      const controls = dialogControls(panel);
      const active = document.activeElement;
      const focusIsUsable = active instanceof HTMLElement && panel.contains(active) &&
        !active.matches(":disabled") && isRendered(active);
      if (!focusIsUsable) {
        (controls[0] ?? panel).focus();
      }
    });
    observer.observe(panel, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["disabled", "hidden", "inert", "style", "class", "tabindex", "aria-hidden"],
    });
    return () => observer.disconnect();
  }, [props.open, panelId]);

  return <IcDialog
    {...props}
    data-app-dialog-id={panelId}
    className={["app-dialog", className].filter(Boolean).join(" ")}
    onClose={onClose ? close : undefined}
    onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDownCapture?.(event);
      if (event.defaultPrevented || event.key !== "Tab") return;
      const panel = event.currentTarget;
      const controls = dialogControls(panel);
      // Prevent the vendored snapshot-based listener from handling the same Tab.
      event.stopPropagation();
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); panel.focus(); }
      else if (!controls.some(element => element === document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }}
  />;
}
